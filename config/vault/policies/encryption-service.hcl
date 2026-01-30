# =============================================================================
# HRIS Filesystem - Vault Policy for Encryption Service
# =============================================================================
# This policy grants minimal permissions for encryption operations
# Principle of least privilege - only what's needed
# =============================================================================

# -----------------------------------------------------------------------------
# Transit Secrets Engine - Encryption/Decryption Operations
# -----------------------------------------------------------------------------

# Allow encryption using the HRIS file key
path "transit/encrypt/hris-file-key" {
  capabilities = ["update"]
}

# Allow decryption using the HRIS file key
path "transit/decrypt/hris-file-key" {
  capabilities = ["update"]
}

# Allow generating data keys (for envelope encryption)
path "transit/datakey/plaintext/hris-file-key" {
  capabilities = ["update"]
}

path "transit/datakey/wrapped/hris-file-key" {
  capabilities = ["update"]
}

# Allow rewrapping data keys (for key rotation)
path "transit/rewrap/hris-file-key" {
  capabilities = ["update"]
}

# Read key information (version, algorithm, etc.)
path "transit/keys/hris-file-key" {
  capabilities = ["read"]
}

# -----------------------------------------------------------------------------
# Deny all other paths
# -----------------------------------------------------------------------------

# Explicitly deny access to other transit keys
path "transit/encrypt/*" {
  capabilities = ["deny"]
}

path "transit/decrypt/*" {
  capabilities = ["deny"]
}

# Deny key management operations
path "transit/keys/*" {
  capabilities = ["deny"]
}

# Re-allow our specific key (overrides deny above)
path "transit/keys/hris-file-key" {
  capabilities = ["read"]
}

path "transit/encrypt/hris-file-key" {
  capabilities = ["update"]
}

path "transit/decrypt/hris-file-key" {
  capabilities = ["update"]
}
