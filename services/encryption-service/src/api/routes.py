"""
API routes for encryption operations.
"""

import base64
import structlog
from fastapi import APIRouter, HTTPException, status

from .schemas import (
    EncryptRequest,
    EncryptResponse,
    DecryptRequest,
    DecryptResponse,
    RewrapRequest,
    RewrapResponse,
    HealthResponse,
)
from ..core.encryption import encrypt_file, decrypt_file
from ..core.vault_client import get_vault_client

logger = structlog.get_logger()

router = APIRouter()


@router.post("/encrypt", response_model=EncryptResponse, tags=["Encryption"])
async def encrypt_data(request: EncryptRequest):
    """
    Encrypt file data using AES-256-GCM with Vault-managed keys.

    - Generates a new DEK from Vault
    - Encrypts data with the DEK
    - Returns encrypted data + wrapped DEK + nonce

    Store wrapped_dek, nonce, and vault_key_version in your database.
    Store encrypted_data in your file storage.
    """
    try:
        # Decode base64 input
        plaintext = base64.b64decode(request.data)

        logger.info("Encrypt request received", size=len(plaintext))

        # Encrypt
        result = encrypt_file(plaintext)

        return EncryptResponse(
            encrypted_data=base64.b64encode(result.encrypted_data).decode(),
            wrapped_dek=result.wrapped_dek,
            nonce=base64.b64encode(result.nonce).decode(),
            vault_key_version=result.vault_key_version,
            checksum_original=result.checksum_original,
            checksum_encrypted=result.checksum_encrypted,
        )

    except Exception as e:
        logger.error("Encryption failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Encryption failed: {str(e)}",
        )


@router.post("/decrypt", response_model=DecryptResponse, tags=["Encryption"])
async def decrypt_data(request: DecryptRequest):
    """
    Decrypt file data using stored wrapped DEK and nonce.

    - Decrypts the DEK using Vault
    - Decrypts data with the plaintext DEK
    - Optionally verifies checksum

    Provide the wrapped_dek and nonce from your database.
    Provide the encrypted_data from your file storage.
    """
    try:
        # Decode base64 inputs
        encrypted_data = base64.b64decode(request.encrypted_data)
        nonce = base64.b64decode(request.nonce)

        logger.info("Decrypt request received", size=len(encrypted_data))

        # Decrypt
        result = decrypt_file(encrypted_data, request.wrapped_dek, nonce)

        # Verify checksum if provided
        checksum_verified = True
        if request.expected_checksum:
            checksum_verified = result.checksum == request.expected_checksum
            if not checksum_verified:
                logger.warning(
                    "Checksum mismatch",
                    expected=request.expected_checksum,
                    actual=result.checksum,
                )

        return DecryptResponse(
            decrypted_data=base64.b64encode(result.decrypted_data).decode(),
            checksum=result.checksum,
            checksum_verified=checksum_verified,
        )

    except Exception as e:
        logger.error("Decryption failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Decryption failed: {str(e)}",
        )


@router.post("/rewrap", response_model=RewrapResponse, tags=["Key Management"])
async def rewrap_dek(request: RewrapRequest):
    """
    Re-wrap a DEK with the latest Vault key version.

    Use this after rotating the Vault transit key to update
    stored DEKs without re-encrypting the actual file data.
    """
    try:
        vault = get_vault_client()
        new_wrapped_dek, key_version = vault.rewrap_data_key(request.wrapped_dek)

        logger.info("DEK rewrapped", new_key_version=key_version)

        return RewrapResponse(
            wrapped_dek=new_wrapped_dek,
            vault_key_version=key_version,
        )

    except Exception as e:
        logger.error("Rewrap failed", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rewrap failed: {str(e)}",
        )


@router.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Check service health and Vault connectivity.
    """
    vault_connected = False

    try:
        vault = get_vault_client()
        vault_connected = vault.health_check()
    except Exception as e:
        logger.warning("Vault health check failed", error=str(e))

    return HealthResponse(
        status="healthy" if vault_connected else "degraded",
        vault_connected=vault_connected,
        version="1.0.0",
    )


@router.get("/key-info", tags=["Key Management"])
async def get_key_info():
    """
    Get information about the Vault transit key.
    """
    try:
        vault = get_vault_client()
        info = vault.get_key_info()

        return {
            "name": info.get("name"),
            "type": info.get("type"),
            "latest_version": info.get("latest_version"),
            "min_decryption_version": info.get("min_decryption_version"),
            "min_encryption_version": info.get("min_encryption_version"),
            "supports_encryption": info.get("supports_encryption"),
            "supports_decryption": info.get("supports_decryption"),
        }

    except Exception as e:
        logger.error("Failed to get key info", error=str(e))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get key info: {str(e)}",
        )
