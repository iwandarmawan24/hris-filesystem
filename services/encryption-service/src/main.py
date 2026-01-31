"""
HRIS Encryption Service - Main Application

This service handles file encryption/decryption using:
- AES-256-GCM for symmetric encryption
- HashiCorp Vault for key management
- Envelope encryption pattern

The service NEVER stores encryption keys - all keys are managed by Vault.
"""

import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .api.routes import router
from .core.vault_client import get_vault_client

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    settings = get_settings()
    logger.info(
        "Starting Encryption Service",
        environment=settings.environment,
        vault_addr=settings.vault_addr,
    )

    # Initialize Vault client on startup
    try:
        vault = get_vault_client()
        if vault.health_check():
            logger.info("Vault connection established")
        else:
            logger.warning("Vault connection failed - service will retry on requests")
    except Exception as e:
        logger.error("Failed to connect to Vault on startup", error=str(e))

    yield

    logger.info("Shutting down Encryption Service")


# Create FastAPI app
app = FastAPI(
    title="HRIS Encryption Service",
    description="""
    Secure file encryption service using AES-256-GCM and HashiCorp Vault.

    ## Features
    - **Encrypt**: Encrypt file data with Vault-managed keys
    - **Decrypt**: Decrypt file data using stored wrapped DEK
    - **Rewrap**: Re-encrypt DEKs after key rotation

    ## Security
    - Keys never leave Vault
    - Envelope encryption pattern
    - Per-file unique Data Encryption Keys (DEK)
    """,
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.environment == "development" else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(
        "Unhandled exception",
        path=request.url.path,
        method=request.method,
        error=str(exc),
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred",
        },
    )


# Include API routes
app.include_router(router, prefix="/api/v1")


# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "HRIS Encryption Service",
        "version": "1.0.0",
        "docs": "/docs",
    }


# Health check at root level (for Docker health checks)
@app.get("/health")
async def health():
    vault_connected = False
    try:
        vault = get_vault_client()
        vault_connected = vault.health_check()
    except Exception:
        pass

    return {
        "status": "healthy" if vault_connected else "degraded",
        "vault_connected": vault_connected,
    }


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "src.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.environment == "development",
    )
