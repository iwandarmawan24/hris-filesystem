"""
Configuration management using pydantic-settings.
All config loaded from environment variables.
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server
    environment: str = "development"
    host: str = "0.0.0.0"
    port: int = 8081
    debug: bool = False

    # Vault
    vault_addr: str = "http://localhost:8200"
    vault_role_id: str = ""
    vault_secret_id: str = ""
    vault_mount_path: str = "transit"
    vault_key_name: str = "hris-file-key"

    # Encryption
    encryption_algorithm: str = "AES-256-GCM"
    chunk_size: int = 65536  # 64KB chunks for streaming

    # Logging
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
