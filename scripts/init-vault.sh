#!/bin/bash
# =============================================================================
# HRIS Filesystem - Vault Initialization Script
# =============================================================================
# Run this script after Vault container is running
# Usage: ./scripts/init-vault.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-devroot}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  HRIS Vault Initialization${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if Vault is accessible
echo -e "\n${YELLOW}[1/6] Checking Vault connection...${NC}"
until curl -s "${VAULT_ADDR}/v1/sys/health" > /dev/null 2>&1; do
    echo "Waiting for Vault to be ready..."
    sleep 2
done
echo -e "${GREEN}✓ Vault is ready${NC}"

# Set Vault token
export VAULT_ADDR="${VAULT_ADDR}"
export VAULT_TOKEN="${VAULT_TOKEN}"

# Enable Transit secrets engine
echo -e "\n${YELLOW}[2/6] Enabling Transit secrets engine...${NC}"
if vault secrets list | grep -q "^transit/"; then
    echo -e "${GREEN}✓ Transit engine already enabled${NC}"
else
    vault secrets enable transit
    echo -e "${GREEN}✓ Transit engine enabled${NC}"
fi

# Create encryption key for HRIS files
echo -e "\n${YELLOW}[3/6] Creating encryption key...${NC}"
if vault read transit/keys/hris-file-key > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Key 'hris-file-key' already exists${NC}"
else
    vault write -f transit/keys/hris-file-key \
        type=aes256-gcm96 \
        derived=false \
        exportable=false \
        allow_plaintext_backup=false \
        min_decryption_version=1 \
        min_encryption_version=1
    echo -e "${GREEN}✓ Key 'hris-file-key' created${NC}"
fi

# Load encryption-service policy
echo -e "\n${YELLOW}[4/6] Loading encryption-service policy...${NC}"
vault policy write encryption-service /vault/policies/encryption-service.hcl 2>/dev/null || \
vault policy write encryption-service ./config/vault/policies/encryption-service.hcl
echo -e "${GREEN}✓ Policy loaded${NC}"

# Enable AppRole auth method
echo -e "\n${YELLOW}[5/6] Enabling AppRole auth method...${NC}"
if vault auth list | grep -q "^approle/"; then
    echo -e "${GREEN}✓ AppRole already enabled${NC}"
else
    vault auth enable approle
    echo -e "${GREEN}✓ AppRole enabled${NC}"
fi

# Create AppRole for encryption-service
echo -e "\n${YELLOW}[6/6] Creating AppRole for encryption-service...${NC}"
vault write auth/approle/role/encryption-service \
    token_policies="encryption-service" \
    token_ttl=1h \
    token_max_ttl=4h \
    secret_id_ttl=720h \
    secret_id_num_uses=0

# Get Role ID
ROLE_ID=$(vault read -field=role_id auth/approle/role/encryption-service/role-id)
echo -e "${GREEN}✓ AppRole created${NC}"

# Generate Secret ID
SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/encryption-service/secret-id)

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}  Vault Initialization Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "\n${YELLOW}Save these credentials securely:${NC}"
echo -e "\n${BLUE}VAULT_ROLE_ID=${NC}${ROLE_ID}"
echo -e "${BLUE}VAULT_SECRET_ID=${NC}${SECRET_ID}"
echo -e "\n${RED}⚠ The SECRET_ID is shown only once!${NC}"
echo -e "${RED}⚠ Add these to your .env.local file${NC}"

# Verify setup
echo -e "\n${YELLOW}Verifying setup...${NC}"

# Test encryption
TEST_RESULT=$(vault write -field=ciphertext transit/encrypt/hris-file-key plaintext=$(echo -n "test" | base64))
if [[ -n "$TEST_RESULT" ]]; then
    echo -e "${GREEN}✓ Encryption test passed${NC}"
else
    echo -e "${RED}✗ Encryption test failed${NC}"
    exit 1
fi

echo -e "\n${GREEN}All checks passed! Vault is ready for HRIS.${NC}"
