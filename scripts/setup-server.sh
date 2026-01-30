#!/bin/bash
# =============================================================================
# HRIS Filesystem - Server Setup Script
# =============================================================================
# Run this on your home server to initialize all services
# Usage: ./scripts/setup-server.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  HRIS Server Setup${NC}"
echo -e "${BLUE}========================================${NC}"

cd "$PROJECT_DIR"

# -----------------------------------------------------------------------------
# Step 0: Create data directories on HDD
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[0/7] Creating data directories on HDD...${NC}"

DATA_DIR="/data/hris"
sudo mkdir -p ${DATA_DIR}/{postgres,vault,vault-logs,files}
sudo chown -R $USER:$USER ${DATA_DIR}
chmod 700 ${DATA_DIR}/postgres ${DATA_DIR}/vault

echo -e "${GREEN}✓ Data directories created at ${DATA_DIR}${NC}"

# -----------------------------------------------------------------------------
# Step 1: Check prerequisites
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[1/7] Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}✗ Docker Compose is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker and Docker Compose are installed${NC}"

# -----------------------------------------------------------------------------
# Step 2: Create .env.server if not exists
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/7] Checking environment file...${NC}"

if [ ! -f .env.server ]; then
    echo -e "${YELLOW}Creating .env.server from example...${NC}"
    cp .env.server.example .env.server

    # Generate random passwords
    POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
    API_KEY=$(openssl rand -hex 32)

    # Update .env.server with generated values
    sed -i.bak "s/CHANGE_ME_STRONG_PASSWORD_HERE/${POSTGRES_PASSWORD}/" .env.server
    sed -i.bak "s/CHANGE_ME_API_KEY_MIN_32_CHARS/${API_KEY}/" .env.server
    rm -f .env.server.bak

    echo -e "${GREEN}✓ .env.server created with generated secrets${NC}"
    echo -e "${YELLOW}⚠ Please review and adjust .env.server as needed${NC}"
else
    echo -e "${GREEN}✓ .env.server already exists${NC}"
fi

# -----------------------------------------------------------------------------
# Step 3: Generate SFTP keys
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/7] Generating SFTP keys...${NC}"

SFTP_KEY_DIR="./config/sftp/keys"
mkdir -p "$SFTP_KEY_DIR"

if [ ! -f "$SFTP_KEY_DIR/sftp_key" ]; then
    ssh-keygen -t ed25519 -f "$SFTP_KEY_DIR/sftp_key" -N "" -C "hris-file-storage"
    chmod 600 "$SFTP_KEY_DIR/sftp_key"
    chmod 644 "$SFTP_KEY_DIR/sftp_key.pub"
    echo -e "${GREEN}✓ SFTP keys generated${NC}"
else
    echo -e "${GREEN}✓ SFTP keys already exist${NC}"
fi

# -----------------------------------------------------------------------------
# Step 4: Generate PostgreSQL SSL certificates (self-signed for dev)
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/7] Generating PostgreSQL SSL certificates...${NC}"

PG_SSL_DIR="./config/postgres/ssl"
mkdir -p "$PG_SSL_DIR"

if [ ! -f "$PG_SSL_DIR/server.crt" ]; then
    # Generate self-signed certificate for PostgreSQL
    openssl req -new -x509 -days 365 -nodes \
        -out "$PG_SSL_DIR/server.crt" \
        -keyout "$PG_SSL_DIR/server.key" \
        -subj "/CN=hris-postgres/O=HRIS/C=ID" \
        2>/dev/null

    chmod 600 "$PG_SSL_DIR/server.key"
    chmod 644 "$PG_SSL_DIR/server.crt"

    # PostgreSQL requires specific ownership (will be handled by container)
    echo -e "${GREEN}✓ PostgreSQL SSL certificates generated${NC}"
else
    echo -e "${GREEN}✓ PostgreSQL SSL certificates already exist${NC}"
fi

# -----------------------------------------------------------------------------
# Step 5: Create Docker networks
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[5/7] Creating Docker networks...${NC}"

for network in hris-db-net hris-vault-net hris-storage-net; do
    if ! docker network inspect "$network" &> /dev/null; then
        docker network create "$network" 2>/dev/null || true
        echo -e "${GREEN}✓ Network $network created${NC}"
    else
        echo -e "${GREEN}✓ Network $network already exists${NC}"
    fi
done

# -----------------------------------------------------------------------------
# Step 6: Pull Docker images
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[6/7] Pulling Docker images...${NC}"

docker pull postgres:16-alpine
docker pull hashicorp/vault:1.15
docker pull atmoz/sftp:alpine

echo -e "${GREEN}✓ Docker images pulled${NC}"

# -----------------------------------------------------------------------------
# Step 7: Start services
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[7/7] Starting services...${NC}"

# Source environment
set -a
source .env.server
set +a

docker compose -f docker-compose.server.yml up -d

echo -e "${GREEN}✓ Services started${NC}"

# Wait for services to be healthy
echo -e "\n${YELLOW}Waiting for services to be healthy...${NC}"
sleep 10

# Check service health
echo -e "\n${BLUE}Service Status:${NC}"
docker compose -f docker-compose.server.yml ps

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}  Server Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"

echo -e "\n${YELLOW}Next steps:${NC}"
echo -e "1. Run ${BLUE}./scripts/init-vault.sh${NC} to initialize Vault"
echo -e "2. Save the VAULT_ROLE_ID and VAULT_SECRET_ID"
echo -e "3. Share connection details with local environment"
echo -e "\n${YELLOW}Server endpoints:${NC}"
echo -e "  PostgreSQL: ${BLUE}$(hostname -I | awk '{print $1}'):5432${NC}"
echo -e "  Vault:      ${BLUE}$(hostname -I | awk '{print $1}'):8200${NC}"
echo -e "  Storage API: ${BLUE}$(hostname -I | awk '{print $1}'):8082${NC}"
