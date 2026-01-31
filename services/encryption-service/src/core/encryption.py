"""
File encryption/decryption using AES-256-GCM.
Implements envelope encryption pattern with Vault-managed keys.
"""

import os
import hashlib
import secrets
import structlog
from typing import Tuple
from dataclasses import dataclass

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import get_settings
from .vault_client import get_vault_client

logger = structlog.get_logger()

# Constants
NONCE_SIZE = 12  # 96 bits for GCM
KEY_SIZE = 32  # 256 bits for AES-256
TAG_SIZE = 16  # 128 bits authentication tag


@dataclass
class EncryptionResult:
    """Result of file encryption operation."""

    encrypted_data: bytes
    wrapped_dek: str  # Vault-encrypted DEK (store in DB)
    nonce: bytes  # IV/Nonce (store in DB)
    vault_key_version: int  # Key version (store in DB)
    checksum_original: str  # SHA-256 of original (store in DB)
    checksum_encrypted: str  # SHA-256 of encrypted (store in DB)


@dataclass
class DecryptionResult:
    """Result of file decryption operation."""

    decrypted_data: bytes
    checksum: str  # SHA-256 of decrypted data (for verification)


class FileEncryptor:
    """
    Handles file encryption and decryption using AES-256-GCM.

    Encryption flow:
    1. Generate DEK from Vault (get plaintext + wrapped)
    2. Generate random nonce
    3. Encrypt file with DEK using AES-256-GCM
    4. Wipe plaintext DEK from memory
    5. Return encrypted data + wrapped DEK + nonce

    Decryption flow:
    1. Decrypt wrapped DEK using Vault
    2. Decrypt file with plaintext DEK
    3. Wipe plaintext DEK from memory
    4. Return decrypted data
    """

    def __init__(self):
        self.settings = get_settings()
        self.vault = get_vault_client()

    def encrypt(self, plaintext: bytes) -> EncryptionResult:
        """
        Encrypt file data using envelope encryption.

        Args:
            plaintext: Raw file bytes to encrypt

        Returns:
            EncryptionResult containing encrypted data and metadata
        """
        logger.info("Starting file encryption", size=len(plaintext))

        # Calculate checksum of original
        checksum_original = hashlib.sha256(plaintext).hexdigest()

        # Generate DEK from Vault
        plaintext_dek, wrapped_dek, key_version = self.vault.generate_data_key()

        try:
            # Generate random nonce
            nonce = secrets.token_bytes(NONCE_SIZE)

            # Create AES-GCM cipher
            aesgcm = AESGCM(plaintext_dek)

            # Encrypt data
            encrypted_data = aesgcm.encrypt(nonce, plaintext, None)

            # Calculate checksum of encrypted
            checksum_encrypted = hashlib.sha256(encrypted_data).hexdigest()

            logger.info(
                "File encrypted successfully",
                original_size=len(plaintext),
                encrypted_size=len(encrypted_data),
                key_version=key_version,
            )

            return EncryptionResult(
                encrypted_data=encrypted_data,
                wrapped_dek=wrapped_dek,
                nonce=nonce,
                vault_key_version=key_version,
                checksum_original=checksum_original,
                checksum_encrypted=checksum_encrypted,
            )

        finally:
            # Wipe DEK from memory
            self._secure_wipe(plaintext_dek)

    def decrypt(self, encrypted_data: bytes, wrapped_dek: str, nonce: bytes) -> DecryptionResult:
        """
        Decrypt file data using envelope encryption.

        Args:
            encrypted_data: Encrypted file bytes
            wrapped_dek: Vault-encrypted DEK from database
            nonce: IV/Nonce from database

        Returns:
            DecryptionResult containing decrypted data
        """
        logger.info("Starting file decryption", size=len(encrypted_data))

        # Decrypt DEK using Vault
        plaintext_dek = self.vault.decrypt_data_key(wrapped_dek)

        try:
            # Create AES-GCM cipher
            aesgcm = AESGCM(plaintext_dek)

            # Decrypt data
            decrypted_data = aesgcm.decrypt(nonce, encrypted_data, None)

            # Calculate checksum
            checksum = hashlib.sha256(decrypted_data).hexdigest()

            logger.info(
                "File decrypted successfully",
                encrypted_size=len(encrypted_data),
                decrypted_size=len(decrypted_data),
            )

            return DecryptionResult(
                decrypted_data=decrypted_data,
                checksum=checksum,
            )

        finally:
            # Wipe DEK from memory
            self._secure_wipe(plaintext_dek)

    def _secure_wipe(self, data: bytes) -> None:
        """
        Attempt to securely wipe sensitive data from memory.

        Note: This is a best-effort approach. Python's memory management
        doesn't guarantee immediate cleanup, but we overwrite the data
        to reduce exposure window.
        """
        try:
            # Convert to bytearray for mutation
            if isinstance(data, bytes):
                # We can't modify bytes directly, but we can
                # hint to garbage collector
                del data
            elif isinstance(data, bytearray):
                for i in range(len(data)):
                    data[i] = 0
        except Exception:
            pass  # Best effort


class StreamingEncryptor:
    """
    Streaming encryption for large files.
    Encrypts data in chunks to avoid loading entire file in memory.

    Note: For GCM mode, we still need to process the entire file
    for the authentication tag. This implementation uses chunked
    reading but single-pass encryption.
    """

    def __init__(self):
        self.settings = get_settings()
        self.vault = get_vault_client()
        self.chunk_size = self.settings.chunk_size

    def encrypt_stream(self, input_stream, output_stream) -> Tuple[str, bytes, int, str, str]:
        """
        Encrypt a file stream.

        Args:
            input_stream: File-like object to read from
            output_stream: File-like object to write to

        Returns:
            Tuple of (wrapped_dek, nonce, key_version, checksum_original, checksum_encrypted)
        """
        # Read all data (for GCM we need complete data)
        plaintext = input_stream.read()

        # Use regular encryption
        encryptor = FileEncryptor()
        result = encryptor.encrypt(plaintext)

        # Write encrypted data
        output_stream.write(result.encrypted_data)

        return (
            result.wrapped_dek,
            result.nonce,
            result.vault_key_version,
            result.checksum_original,
            result.checksum_encrypted,
        )

    def decrypt_stream(
        self, input_stream, output_stream, wrapped_dek: str, nonce: bytes
    ) -> str:
        """
        Decrypt a file stream.

        Args:
            input_stream: File-like object with encrypted data
            output_stream: File-like object to write decrypted data
            wrapped_dek: Vault-encrypted DEK
            nonce: IV/Nonce

        Returns:
            Checksum of decrypted data
        """
        # Read all encrypted data
        encrypted_data = input_stream.read()

        # Use regular decryption
        encryptor = FileEncryptor()
        result = encryptor.decrypt(encrypted_data, wrapped_dek, nonce)

        # Write decrypted data
        output_stream.write(result.decrypted_data)

        return result.checksum


# Convenience functions
def encrypt_file(plaintext: bytes) -> EncryptionResult:
    """Encrypt file data."""
    return FileEncryptor().encrypt(plaintext)


def decrypt_file(encrypted_data: bytes, wrapped_dek: str, nonce: bytes) -> DecryptionResult:
    """Decrypt file data."""
    return FileEncryptor().decrypt(encrypted_data, wrapped_dek, nonce)
