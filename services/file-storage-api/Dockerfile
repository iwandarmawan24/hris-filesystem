# =============================================================================
# HRIS File Storage API (Python + FastAPI)
# =============================================================================
# Lightweight service for storing/retrieving encrypted file blobs
# Direct filesystem access - no SFTP complexity
# =============================================================================

FROM python:3.12-slim AS base

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# -----------------------------------------------------------------------------
# Production Stage
# -----------------------------------------------------------------------------
FROM base AS production

# Create non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid appgroup --shell /bin/bash appuser

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./

# Create storage directory (will be mounted as volume)
RUN mkdir -p /data/files && \
    chown -R appuser:appgroup /data/files

# Set ownership
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Environment variables
ENV FILE_STORAGE_HOST=0.0.0.0 \
    FILE_STORAGE_PORT=8080 \
    FILE_STORAGE_STORAGE_PATH=/data/files

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

# Start server
CMD ["python", "main.py"]
