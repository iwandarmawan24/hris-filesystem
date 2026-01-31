"""
Pydantic schemas for API request/response validation.
"""

from pydantic import BaseModel, Field
from typing import Optional


class EncryptRequest(BaseModel):
    """Request to encrypt data (base64 encoded)."""

    data: str = Field(..., description="Base64-encoded file data to encrypt")


class EncryptResponse(BaseModel):
    """Response containing encrypted data and metadata."""

    encrypted_data: str = Field(..., description="Base64-encoded encrypted data")
    wrapped_dek: str = Field(..., description="Vault-encrypted DEK (store in DB)")
    nonce: str = Field(..., description="Base64-encoded nonce/IV (store in DB)")
    vault_key_version: int = Field(..., description="Vault key version used")
    checksum_original: str = Field(..., description="SHA-256 of original data")
    checksum_encrypted: str = Field(..., description="SHA-256 of encrypted data")


class DecryptRequest(BaseModel):
    """Request to decrypt data."""

    encrypted_data: str = Field(..., description="Base64-encoded encrypted data")
    wrapped_dek: str = Field(..., description="Vault-encrypted DEK from DB")
    nonce: str = Field(..., description="Base64-encoded nonce/IV from DB")
    expected_checksum: Optional[str] = Field(
        None, description="Expected SHA-256 checksum for verification"
    )


class DecryptResponse(BaseModel):
    """Response containing decrypted data."""

    decrypted_data: str = Field(..., description="Base64-encoded decrypted data")
    checksum: str = Field(..., description="SHA-256 of decrypted data")
    checksum_verified: bool = Field(..., description="Whether checksum matches expected")


class RewrapRequest(BaseModel):
    """Request to re-wrap a DEK with latest key version."""

    wrapped_dek: str = Field(..., description="Current Vault-encrypted DEK")


class RewrapResponse(BaseModel):
    """Response containing re-wrapped DEK."""

    wrapped_dek: str = Field(..., description="DEK encrypted with latest key version")
    vault_key_version: int = Field(..., description="New key version")


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = Field(..., description="Service status")
    vault_connected: bool = Field(..., description="Vault connectivity status")
    version: str = Field(..., description="Service version")


class ErrorResponse(BaseModel):
    """Error response."""

    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Additional details")
