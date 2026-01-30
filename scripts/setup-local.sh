#!/bin/bash
# =============================================================================
# HRIS Filesystem - Local Setup Script
# =============================================================================
# Run this on your local laptop to initialize development environment
# Usage: ./scripts/setup-local.sh
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
echo -e "${BLUE}  HRIS Local Development Setup${NC}"
echo -e "${BLUE}========================================${NC}"

cd "$PROJECT_DIR"

# -----------------------------------------------------------------------------
# Step 1: Check prerequisites
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[1/6] Checking prerequisites...${NC}"

MISSING_DEPS=""

if ! command -v docker &> /dev/null; then
    MISSING_DEPS="${MISSING_DEPS}docker "
fi

if ! command -v node &> /dev/null; then
    MISSING_DEPS="${MISSING_DEPS}node "
fi

if ! command -v python3 &> /dev/null; then
    MISSING_DEPS="${MISSING_DEPS}python3 "
fi

if [ -n "$MISSING_DEPS" ]; then
    echo -e "${RED}✗ Missing dependencies: ${MISSING_DEPS}${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites installed${NC}"
echo -e "  Docker: $(docker --version | cut -d' ' -f3)"
echo -e "  Node: $(node --version)"
echo -e "  Python: $(python3 --version | cut -d' ' -f2)"

# -----------------------------------------------------------------------------
# Step 2: Create .env.local if not exists
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[2/6] Checking environment file...${NC}"

if [ ! -f .env.local ]; then
    echo -e "${YELLOW}Creating .env.local from example...${NC}"
    cp .env.local.example .env.local

    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    sed -i.bak "s|CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_64|${JWT_SECRET}|" .env.local
    rm -f .env.local.bak

    echo -e "${GREEN}✓ .env.local created${NC}"
    echo -e "${RED}⚠ IMPORTANT: Update HOME_SERVER_HOST in .env.local${NC}"
    echo -e "${RED}⚠ IMPORTANT: Add VAULT_ROLE_ID and VAULT_SECRET_ID${NC}"
    echo -e "${RED}⚠ IMPORTANT: Add POSTGRES_PASSWORD and FILE_STORAGE_API_KEY${NC}"
else
    echo -e "${GREEN}✓ .env.local already exists${NC}"
fi

# -----------------------------------------------------------------------------
# Step 3: Verify home server connection
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[3/6] Checking home server connection...${NC}"

# Source environment
set -a
source .env.local 2>/dev/null || true
set +a

if [ -z "$HOME_SERVER_HOST" ] || [ "$HOME_SERVER_HOST" = "192.168.1.100" ]; then
    echo -e "${RED}⚠ HOME_SERVER_HOST not configured${NC}"
    echo -e "${YELLOW}Please update HOME_SERVER_HOST in .env.local${NC}"
    SKIP_SERVER_CHECK=true
else
    # Try to ping the server
    if ping -c 1 -W 2 "$HOME_SERVER_HOST" &> /dev/null; then
        echo -e "${GREEN}✓ Home server reachable at $HOME_SERVER_HOST${NC}"

        # Check if Vault is accessible
        if curl -s --connect-timeout 3 "http://${HOME_SERVER_HOST}:${VAULT_PORT:-8200}/v1/sys/health" &> /dev/null; then
            echo -e "${GREEN}✓ Vault is accessible${NC}"
        else
            echo -e "${YELLOW}⚠ Vault is not accessible (may not be started yet)${NC}"
        fi

        # Check if PostgreSQL is accessible
        if nc -z -w 3 "$HOME_SERVER_HOST" "${POSTGRES_PORT:-5432}" 2>/dev/null; then
            echo -e "${GREEN}✓ PostgreSQL is accessible${NC}"
        else
            echo -e "${YELLOW}⚠ PostgreSQL is not accessible (may not be started yet)${NC}"
        fi
    else
        echo -e "${RED}✗ Cannot reach home server at $HOME_SERVER_HOST${NC}"
        echo -e "${YELLOW}Make sure your VPN/Tailscale is connected${NC}"
    fi
fi

# -----------------------------------------------------------------------------
# Step 4: Install service dependencies
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[4/6] Installing service dependencies...${NC}"

# app-client dependencies
if [ -d "./services/app-client" ]; then
    echo -e "${BLUE}Installing app-client dependencies...${NC}"
    cd ./services/app-client
    if [ -f "package.json" ]; then
        npm install --silent 2>/dev/null || echo "Creating package.json later..."
    fi
    cd "$PROJECT_DIR"
fi

# api-service dependencies
if [ -d "./services/api-service" ]; then
    echo -e "${BLUE}Installing api-service dependencies...${NC}"
    cd ./services/api-service
    if [ -f "package.json" ]; then
        npm install --silent 2>/dev/null || echo "Creating package.json later..."
    fi
    cd "$PROJECT_DIR"
fi

# encryption-service dependencies
if [ -d "./services/encryption-service" ]; then
    echo -e "${BLUE}Installing encryption-service dependencies...${NC}"
    cd ./services/encryption-service
    if [ -f "requirements.txt" ]; then
        python3 -m pip install -r requirements.txt --quiet 2>/dev/null || echo "Creating requirements.txt later..."
    fi
    cd "$PROJECT_DIR"
fi

echo -e "${GREEN}✓ Dependencies check complete${NC}"

# -----------------------------------------------------------------------------
# Step 5: Create Docker networks
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[5/6] Creating Docker networks...${NC}"

for network in hris-frontend-net hris-backend-net; do
    if ! docker network inspect "$network" &> /dev/null; then
        docker network create "$network" 2>/dev/null || true
        echo -e "${GREEN}✓ Network $network created${NC}"
    else
        echo -e "${GREEN}✓ Network $network already exists${NC}"
    fi
done

# -----------------------------------------------------------------------------
# Step 6: Build local services
# -----------------------------------------------------------------------------
echo -e "\n${YELLOW}[6/6] Building local services...${NC}"

# Check if Dockerfiles exist
DOCKERFILES_EXIST=true
for svc in app-client api-service encryption-service; do
    if [ ! -f "./services/$svc/Dockerfile" ]; then
        DOCKERFILES_EXIST=false
        echo -e "${YELLOW}⚠ Dockerfile not found for $svc${NC}"
    fi
done

if [ "$DOCKERFILES_EXIST" = true ]; then
    docker compose -f docker-compose.local.yml build
    echo -e "${GREEN}✓ Services built${NC}"
else
    echo -e "${YELLOW}⚠ Skipping build - Dockerfiles not yet created${NC}"
fi

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}  Local Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"

echo -e "\n${YELLOW}Configuration checklist:${NC}"
echo -e "  [ ] Update HOME_SERVER_HOST in .env.local"
echo -e "  [ ] Add POSTGRES_PASSWORD (from server .env.server)"
echo -e "  [ ] Add VAULT_ROLE_ID and VAULT_SECRET_ID (from init-vault.sh output)"
echo -e "  [ ] Add FILE_STORAGE_API_KEY (from server .env.server)"

echo -e "\n${YELLOW}To start services:${NC}"
echo -e "  ${BLUE}docker compose -f docker-compose.local.yml up -d${NC}"

echo -e "\n${YELLOW}Service URLs (after start):${NC}"
echo -e "  App Client:        ${BLUE}http://localhost:3000${NC}"
echo -e "  API Service:       ${BLUE}http://localhost:8080${NC}"
echo -e "  Encryption Service: ${BLUE}http://localhost:8081${NC}"
