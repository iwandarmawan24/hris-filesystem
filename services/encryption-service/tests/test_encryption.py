"""
Tests for encryption service.

Run with: pytest tests/ -v
Note: Requires running Vault instance for integration tests.
"""

import base64
import pytest
from unittest.mock import Mock, patch


class TestEncryptionUnit:
    """Unit tests that don't require Vault."""

    def test_base64_encoding(self):
        """Test base64 encoding/decoding."""
        original = b"Hello, World!"
        encoded = base64.b64encode(original).decode()
        decoded = base64.b64decode(encoded)
        assert original == decoded

    def test_nonce_generation(self):
        """Test that nonces are unique."""
        import secrets

        nonces = [secrets.token_bytes(12) for _ in range(100)]
        assert len(set(nonces)) == 100  # All unique


class TestEncryptionIntegration:
    """Integration tests requiring Vault."""

    @pytest.fixture
    def mock_vault(self):
        """Mock Vault client."""
        with patch("src.core.vault_client.get_vault_client") as mock:
            vault = Mock()
            vault.generate_data_key.return_value = (
                b"0" * 32,  # 32-byte key
                "vault:v1:encrypted_dek",
                1,
            )
            vault.decrypt_data_key.return_value = b"0" * 32
            vault.health_check.return_value = True
            mock.return_value = vault
            yield vault

    def test_encrypt_decrypt_roundtrip(self, mock_vault):
        """Test that encrypt -> decrypt returns original data."""
        from src.core.encryption import FileEncryptor

        encryptor = FileEncryptor()
        original_data = b"This is a test file content."

        # Encrypt
        result = encryptor.encrypt(original_data)

        assert result.encrypted_data != original_data
        assert result.wrapped_dek == "vault:v1:encrypted_dek"
        assert len(result.nonce) == 12
        assert result.vault_key_version == 1

        # Decrypt
        decrypted = encryptor.decrypt(
            result.encrypted_data, result.wrapped_dek, result.nonce
        )

        assert decrypted.decrypted_data == original_data
        assert decrypted.checksum == result.checksum_original

    def test_checksum_verification(self, mock_vault):
        """Test checksum calculation."""
        import hashlib
        from src.core.encryption import FileEncryptor

        encryptor = FileEncryptor()
        data = b"Test data for checksum"

        result = encryptor.encrypt(data)

        expected_checksum = hashlib.sha256(data).hexdigest()
        assert result.checksum_original == expected_checksum
