"""
HashiCorp Vault client for key management operations.
Uses AppRole authentication and Transit secrets engine.
"""

import base64
import hvac
import structlog
from typing import Tuple, Optional

from ..config import get_settings

logger = structlog.get_logger()


class VaultClient:
    """
    Vault client for encryption key operations.

    This client:
    - Authenticates via AppRole
    - Generates Data Encryption Keys (DEK)
    - Decrypts wrapped DEKs
    - Never exposes the master key (KEK)
    """

    def __init__(self):
        self.settings = get_settings()
        self._client: Optional[hvac.Client] = None
        self._token: Optional[str] = None

    @property
    def client(self) -> hvac.Client:
        """Get or create authenticated Vault client."""
        if self._client is None or not self._client.is_authenticated():
            self._authenticate()
        return self._client

    def _authenticate(self) -> None:
        """Authenticate to Vault using AppRole."""
        logger.info("Authenticating to Vault", vault_addr=self.settings.vault_addr)

        self._client = hvac.Client(url=self.settings.vault_addr)

        # Authenticate with AppRole
        auth_response = self._client.auth.approle.login(
            role_id=self.settings.vault_role_id,
            secret_id=self.settings.vault_secret_id,
        )

        self._token = auth_response["auth"]["client_token"]
        self._client.token = self._token

        logger.info(
            "Vault authentication successful",
            token_ttl=auth_response["auth"]["lease_duration"],
        )

    def generate_data_key(self) -> Tuple[bytes, str, int]:
        """
        Generate a new Data Encryption Key (DEK) from Vault.

        Returns:
            Tuple of:
            - plaintext_key (bytes): Raw DEK for encryption (32 bytes)
            - wrapped_key (str): Encrypted DEK to store in DB
            - key_version (int): Vault key version used

        The plaintext_key should be used immediately and then wiped from memory.
        The wrapped_key is safe to store in the database.
        """
        logger.debug("Generating new data key from Vault")

        response = self.client.secrets.transit.generate_data_key(
            name=self.settings.vault_key_name,
            key_type="plaintext",  # Returns both plaintext and ciphertext
            mount_point=self.settings.vault_mount_path,
        )

        plaintext_b64 = response["data"]["plaintext"]
        wrapped_key = response["data"]["ciphertext"]
        key_version = response["data"]["key_version"]

        # Decode base64 to get raw bytes
        plaintext_key = base64.b64decode(plaintext_b64)

        logger.info(
            "Data key generated",
            key_version=key_version,
            key_length=len(plaintext_key),
        )

        return plaintext_key, wrapped_key, key_version

    def decrypt_data_key(self, wrapped_key: str) -> bytes:
        """
        Decrypt a wrapped DEK using Vault.

        Args:
            wrapped_key: The encrypted DEK from database (vault:v1:...)

        Returns:
            plaintext_key (bytes): Raw DEK for decryption
        """
        logger.debug("Decrypting wrapped data key")

        response = self.client.secrets.transit.decrypt_data(
            name=self.settings.vault_key_name,
            ciphertext=wrapped_key,
            mount_point=self.settings.vault_mount_path,
        )

        plaintext_b64 = response["data"]["plaintext"]
        plaintext_key = base64.b64decode(plaintext_b64)

        logger.debug("Data key decrypted", key_length=len(plaintext_key))

        return plaintext_key

    def rewrap_data_key(self, wrapped_key: str) -> Tuple[str, int]:
        """
        Re-wrap a DEK with the latest key version (for key rotation).

        Args:
            wrapped_key: The old encrypted DEK

        Returns:
            Tuple of:
            - new_wrapped_key (str): DEK encrypted with latest key version
            - key_version (int): New key version
        """
        logger.debug("Rewrapping data key with latest version")

        response = self.client.secrets.transit.rewrap_data(
            name=self.settings.vault_key_name,
            ciphertext=wrapped_key,
            mount_point=self.settings.vault_mount_path,
        )

        new_wrapped_key = response["data"]["ciphertext"]
        key_version = response["data"]["key_version"]

        logger.info("Data key rewrapped", new_key_version=key_version)

        return new_wrapped_key, key_version

    def get_key_info(self) -> dict:
        """Get information about the transit key."""
        response = self.client.secrets.transit.read_key(
            name=self.settings.vault_key_name,
            mount_point=self.settings.vault_mount_path,
        )
        return response["data"]

    def health_check(self) -> bool:
        """Check if Vault is accessible and authenticated."""
        try:
            return self.client.is_authenticated()
        except Exception as e:
            logger.error("Vault health check failed", error=str(e))
            return False


# Singleton instance
_vault_client: Optional[VaultClient] = None


def get_vault_client() -> VaultClient:
    """Get or create the Vault client singleton."""
    global _vault_client
    if _vault_client is None:
        _vault_client = VaultClient()
    return _vault_client
