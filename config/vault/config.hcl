# =============================================================================
# HRIS Filesystem - HashiCorp Vault Configuration
# =============================================================================
# This config is for PRODUCTION mode
# For development, use -dev flag which ignores this file
# =============================================================================

# Storage backend - file-based for simplicity
storage "file" {
  path = "/vault/data"
}

# Listener configuration
listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1  # Enable TLS in production with proper certs

  # For production with TLS:
  # tls_cert_file = "/vault/config/tls/vault.crt"
  # tls_key_file  = "/vault/config/tls/vault.key"
}

# API address for Vault to advertise
api_addr = "http://0.0.0.0:8200"

# Cluster address (for HA setups)
cluster_addr = "http://0.0.0.0:8201"

# Disable memory locking (required for container without IPC_LOCK)
disable_mlock = false

# UI
ui = true

# Telemetry
telemetry {
  disable_hostname = true
}

# Audit logging
# Enable via CLI after unseal:
# vault audit enable file file_path=/vault/logs/audit.log
