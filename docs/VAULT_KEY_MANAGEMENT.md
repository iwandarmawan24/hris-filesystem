# Vault Key Management Design

> HashiCorp Vault OSS untuk file encryption system dengan envelope encryption pattern.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Key Hierarchy](#key-hierarchy)
- [Key Lifecycle](#key-lifecycle)
- [Per-File Key Strategy](#per-file-key-strategy)
- [Access Control](#access-control)
- [Enterprise KMS/HSM Mapping](#enterprise-kmshsm-mapping)
- [API Reference](#api-reference)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           KEY MANAGEMENT FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐        │
│  │ encryption-  │     │      VAULT       │     │   KEY STORAGE    │        │
│  │   service    │     │                  │     │                  │        │
│  │              │     │  ┌────────────┐  │     │  KEK (Master)    │        │
│  │  Request:    │────▶│  │  Transit   │  │     │  └─► Encrypted   │        │
│  │  "encrypt    │     │  │  Engine    │  │     │      by Shamir   │        │
│  │   this file" │     │  └────────────┘  │     │                  │        │
│  │              │◀────│         │        │     │  DEKs (per-file) │        │
│  │  Response:   │     │         ▼        │     │  └─► Encrypted   │        │
│  │  ciphertext  │     │  ┌────────────┐  │     │      by KEK      │        │
│  │              │     │  │  AppRole   │  │     │                  │        │
│  └──────────────┘     │  │   Auth     │  │     └──────────────────┘        │
│                       │  └────────────┘  │                                  │
│                       └──────────────────┘                                  │
│                                                                              │
│  KEY POINT: Raw keys NEVER leave Vault                                      │
│             Only ciphertext travels over network                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Zero Knowledge**: Application never sees or stores raw encryption keys
2. **Envelope Encryption**: Data encrypted with DEK, DEK encrypted with KEK
3. **Least Privilege**: Each service has minimal required permissions
4. **Key Separation**: Transit key for encryption, AppRole for authentication

---

## Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                      KEY HIERARCHY                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Level 1: UNSEAL KEYS (Shamir's Secret Sharing)                 │
│  ═══════════════════════════════════════════════                │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐                       │
│  │Key 1│ │Key 2│ │Key 3│ │Key 4│ │Key 5│  (5 shares, 3 needed) │
│  └──┬──┘ └──┬──┘ └──┬──┘ └─────┘ └─────┘                       │
│     │       │       │                                           │
│     └───────┴───────┴─────────┐                                 │
│                               ▼                                  │
│  Level 2: MASTER KEY (KEK - Key Encryption Key)                 │
│  ══════════════════════════════════════════════                 │
│  ┌─────────────────────────────────────────┐                    │
│  │  KEK: Encrypts all Transit keys         │                    │
│  │  Never exported, never leaves Vault     │                    │
│  └─────────────────────┬───────────────────┘                    │
│                        │                                         │
│                        ▼                                         │
│  Level 3: TRANSIT KEYS (Per-Application)                        │
│  ═══════════════════════════════════════                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │hris-file-key│ │hris-user-key│ │  (future)   │               │
│  │ (Transit)   │ │ (optional)  │ │             │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│         │                                                        │
│         ▼                                                        │
│  Level 4: DATA ENCRYPTION KEYS (Per-File)                       │
│  ════════════════════════════════════════                       │
│  ┌─────────────────────────────────────────┐                    │
│  │  Generated via: datakey/plaintext       │                    │
│  │  Returns:                               │                    │
│  │   - plaintext DEK (use immediately)     │                    │
│  │   - ciphertext DEK (store in DB)        │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Types Explained

| Level | Key Type | Purpose | Storage | Rotation |
|-------|----------|---------|---------|----------|
| 1 | Unseal Keys | Decrypt master key | Offline/HSM | Rarely |
| 2 | Master Key (KEK) | Encrypt Transit keys | Vault internal | Via rekey |
| 3 | Transit Key | Generate/wrap DEKs | Vault Transit | Scheduled |
| 4 | Data Key (DEK) | Encrypt actual files | PostgreSQL (wrapped) | Per-file |

---

## Key Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      KEY LIFECYCLE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐                                                │
│  │  GENERATE   │  Transit key created once (init-vault.sh)     │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────┐                                                │
│  │   ACTIVE    │  Key used for encrypt/decrypt operations      │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼  (scheduled rotation)                                  │
│  ┌─────────────┐                                                │
│  │   ROTATE    │  New key version created                       │
│  └──────┬──────┘  Old versions still usable for decrypt        │
│         │                                                        │
│         ▼  (optional)                                            │
│  ┌─────────────┐                                                │
│  │   REWRAP    │  Re-encrypt DEKs with latest key version      │
│  └──────┬──────┘                                                │
│         │                                                        │
│         ▼  (if compromised)                                      │
│  ┌─────────────┐                                                │
│  │   REVOKE    │  Set min_decryption_version                    │
│  └─────────────┘  Old versions become unusable                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Lifecycle Operations

| Phase | Action | Command | Frequency |
|-------|--------|---------|-----------|
| **Generate** | Create Transit key | `vault write -f transit/keys/hris-file-key` | Once |
| **Request DEK** | Get new data key | `vault write transit/datakey/plaintext/hris-file-key` | Per file |
| **Encrypt** | Use DEK for file | Application code (AES-256-GCM) | Per file |
| **Store** | Save wrapped DEK | PostgreSQL `encrypted_dek` column | Per file |
| **Decrypt** | Unwrap DEK | `vault write transit/decrypt/hris-file-key` | On access |
| **Rotate** | New key version | `vault write -f transit/keys/hris-file-key/rotate` | Scheduled |
| **Rewrap** | Update wrapped DEKs | `vault write transit/rewrap/hris-file-key` | After rotation |

---

## Per-File Key Strategy

### Envelope Encryption Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   ENVELOPE ENCRYPTION FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  FILE UPLOAD:                                                   │
│  ════════════                                                   │
│                                                                  │
│  1. Request new DEK from Vault                                  │
│     ┌─────────────────────────────────────────┐                │
│     │ POST transit/datakey/plaintext/hris-... │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│  2. Vault returns plaintext + wrapped DEK                       │
│     ┌─────────────────────────────────────────┐                │
│     │ {                                       │                │
│     │   "plaintext": "dGhpcyBpcyBhIGtleQ==", │ ← 32 bytes     │
│     │   "ciphertext": "vault:v1:abc123..."   │ ← store this   │
│     │ }                                       │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│  3. Encrypt file content with plaintext DEK                     │
│     ┌─────────────────────────────────────────┐                │
│     │ AES-256-GCM(plaintext_dek, file_bytes)  │                │
│     │ → encrypted_blob + IV/nonce             │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│  4. Store metadata in PostgreSQL                                │
│     ┌─────────────────────────────────────────┐                │
│     │ INSERT INTO files (                     │                │
│     │   encrypted_dek = 'vault:v1:abc123...', │                │
│     │   encryption_iv = 'base64-iv',          │                │
│     │   vault_key_version = 1                 │                │
│     │ )                                       │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│  5. Store encrypted blob in SFTP                                │
│     ┌─────────────────────────────────────────┐                │
│     │ PUT /files/{uuid}.enc                   │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│  6. WIPE plaintext DEK from memory immediately                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### File Download (Decryption)

```
┌─────────────────────────────────────────────────────────────────┐
│                   DECRYPTION FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Fetch file metadata from PostgreSQL                         │
│     → Get encrypted_dek, encryption_iv, storage_path            │
│                                                                  │
│  2. Fetch encrypted blob from SFTP                              │
│     → GET /files/{uuid}.enc                                     │
│                                                                  │
│  3. Decrypt the wrapped DEK via Vault                           │
│     ┌─────────────────────────────────────────┐                │
│     │ POST transit/decrypt/hris-file-key      │                │
│     │ { "ciphertext": "vault:v1:abc123..." }  │                │
│     └─────────────────────────────────────────┘                │
│                         │                                        │
│                         ▼                                        │
│     ┌─────────────────────────────────────────┐                │
│     │ { "plaintext": "dGhpcyBpcyBhIGtleQ==" } │ ← DEK          │
│     └─────────────────────────────────────────┘                │
│                                                                  │
│  4. Decrypt file content with DEK                               │
│     → AES-256-GCM decrypt(dek, iv, encrypted_blob)              │
│                                                                  │
│  5. Stream decrypted content to client                          │
│                                                                  │
│  6. WIPE plaintext DEK from memory                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### PostgreSQL Schema

```sql
-- files table stores encrypted_dek (wrapped by Vault)
CREATE TABLE files (
    id UUID PRIMARY KEY,
    original_name VARCHAR(500) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,      -- {uuid}.enc in SFTP

    -- Encryption metadata
    encrypted_dek TEXT NOT NULL,             -- vault:v1:... (wrapped DEK)
    vault_key_version INTEGER NOT NULL,      -- Key version used
    encryption_iv VARCHAR(48),               -- IV/Nonce (base64)

    -- Integrity
    checksum_original VARCHAR(64) NOT NULL,  -- SHA-256 of plaintext
    checksum_encrypted VARCHAR(64) NOT NULL, -- SHA-256 of ciphertext

    owner_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

---

## Access Control

```
┌─────────────────────────────────────────────────────────────────┐
│                     ACCESS CONTROL LAYERS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: VAULT AUTHENTICATION (AppRole)                        │
│  ════════════════════════════════════════                       │
│                                                                  │
│  encryption-service authenticates with:                         │
│  ┌─────────────────────────────────────────┐                   │
│  │ role_id:   "encryption-service"         │  ← embedded       │
│  │ secret_id: "xxx-rotated-regularly-xxx"  │  ← from env var   │
│  └─────────────────────────────────────────┘                   │
│                                                                  │
│  Layer 2: VAULT POLICY (Least Privilege)                        │
│  ═══════════════════════════════════════                        │
│                                                                  │
│  encryption-service.hcl:                                        │
│  ┌─────────────────────────────────────────┐                   │
│  │ # ALLOWED:                              │                   │
│  │ transit/encrypt/hris-file-key           │                   │
│  │ transit/decrypt/hris-file-key           │                   │
│  │ transit/datakey/*/hris-file-key         │                   │
│  │ transit/rewrap/hris-file-key            │                   │
│  │ transit/keys/hris-file-key (read)       │                   │
│  │                                         │                   │
│  │ # DENIED:                               │                   │
│  │ transit/keys/* (create/delete/update)   │                   │
│  │ secret/*                                │                   │
│  │ sys/*                                   │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                  │
│  Layer 3: APPLICATION AUTHORIZATION                             │
│  ══════════════════════════════════                             │
│                                                                  │
│  api-service enforces:                                          │
│  ┌─────────────────────────────────────────┐                   │
│  │ 1. Valid JWT token?                     │                   │
│  │ 2. User owns file OR has permission?    │                   │
│  │ 3. Permission not expired?              │                   │
│  │ 4. Rate limit not exceeded?             │                   │
│  │                                         │                   │
│  │ Only then → call encryption-service     │                   │
│  └─────────────────────────────────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Vault Policy File

Location: `config/vault/policies/encryption-service.hcl`

```hcl
# Transit operations - encrypt/decrypt
path "transit/encrypt/hris-file-key" {
  capabilities = ["update"]
}

path "transit/decrypt/hris-file-key" {
  capabilities = ["update"]
}

# Generate data keys (envelope encryption)
path "transit/datakey/plaintext/hris-file-key" {
  capabilities = ["update"]
}

path "transit/datakey/wrapped/hris-file-key" {
  capabilities = ["update"]
}

# Key rotation support
path "transit/rewrap/hris-file-key" {
  capabilities = ["update"]
}

# Read key metadata (version, algorithm)
path "transit/keys/hris-file-key" {
  capabilities = ["read"]
}
```

---

## Enterprise KMS/HSM Mapping

| This Demo | AWS KMS | Azure Key Vault | GCP KMS |
|-----------|---------|-----------------|---------|
| Vault OSS | AWS KMS | Azure Key Vault | Cloud KMS |
| Transit Engine | Encrypt/Decrypt API | Cryptography API | Encrypt/Decrypt |
| Unseal Keys | HSM-backed | HSM Premium | Cloud HSM |
| AppRole | IAM Role | Managed Identity | Service Account |
| Vault Policy | Key Policy + IAM | Access Policy + RBAC | IAM Policy |
| Transit Key | CMK (Customer Master Key) | KEK | CryptoKey |
| `datakey/plaintext` | GenerateDataKey | - | GenerateRandomBytes |
| `rewrap` | ReEncrypt | - | Encrypt with new version |

### Architectural Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                    ENTERPRISE MAPPING                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐         ┌─────────────────┐               │
│  │   THIS DEMO     │         │   AWS EXAMPLE   │               │
│  ├─────────────────┤         ├─────────────────┤               │
│  │                 │         │                 │               │
│  │  Vault Transit  │ ══════► │    AWS KMS      │               │
│  │  hris-file-key  │         │   CMK (alias)   │               │
│  │                 │         │                 │               │
│  │  POST transit/  │ ══════► │ GenerateDataKey │               │
│  │  datakey/plain  │         │     API         │               │
│  │                 │         │                 │               │
│  │  POST transit/  │ ══════► │    Decrypt      │               │
│  │  decrypt        │         │     API         │               │
│  │                 │         │                 │               │
│  │  AppRole +      │ ══════► │  IAM Role +     │               │
│  │  Policy         │         │  Key Policy     │               │
│  │                 │         │                 │               │
│  │  Unseal Keys    │ ══════► │  CloudHSM /     │               │
│  │  (Shamir)       │         │  AWS Secrets    │               │
│  │                 │         │                 │               │
│  └─────────────────┘         └─────────────────┘               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  SECURITY EQUIVALENCE:                                   │   │
│  │                                                          │   │
│  │  • Both use envelope encryption pattern                  │   │
│  │  • Both never expose raw KEK                             │   │
│  │  • Both support key rotation without re-encryption       │   │
│  │  • Both provide audit logging                            │   │
│  │  • Both enforce least-privilege access                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Generate Data Key (for new file)

```bash
# Request
vault write transit/datakey/plaintext/hris-file-key

# Response
{
  "data": {
    "ciphertext": "vault:v1:8SDd3WHDOjf7mq69CyCqYjBXAiQQAVZRkFM13ok481zoCmHnSeDX9vyf7w==",
    "key_version": 1,
    "plaintext": "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1mb3ItYWVz"
  }
}
```

### Decrypt Wrapped DEK (for file download)

```bash
# Request
vault write transit/decrypt/hris-file-key \
  ciphertext="vault:v1:8SDd3WHDOjf7mq69CyCqYjBXAiQQAVZRkFM13ok481zoCmHnSeDX9vyf7w=="

# Response
{
  "data": {
    "plaintext": "dGVzdC1rZXktMzItYnl0ZXMtbG9uZy1mb3ItYWVz"
  }
}
```

### Rewrap DEK (after key rotation)

```bash
# Request
vault write transit/rewrap/hris-file-key \
  ciphertext="vault:v1:old-wrapped-dek..."

# Response
{
  "data": {
    "ciphertext": "vault:v2:new-wrapped-dek...",
    "key_version": 2
  }
}
```

### Rotate Transit Key

```bash
# Rotate key (creates new version)
vault write -f transit/keys/hris-file-key/rotate

# Check key versions
vault read transit/keys/hris-file-key
```

---

## Security Considerations

### What's Protected

| Scenario | Impact | Mitigation |
|----------|--------|------------|
| Database breach | Wrapped DEKs exposed | Useless without Vault access |
| File storage breach | Encrypted blobs exposed | Useless without DEKs |
| Vault sealed | No encryption/decryption | Requires unseal keys |
| AppRole secret leaked | Attacker can decrypt | Rotate secret, revoke tokens |
| Transit key compromised | Historical data at risk | Rotate + rewrap all DEKs |

### Best Practices

1. **Rotate AppRole secret_id** regularly (e.g., daily)
2. **Enable Vault audit logging** for all operations
3. **Use short-lived tokens** (1h TTL in our config)
4. **Monitor for anomalies** in decrypt operations
5. **Backup unseal keys** securely (offline, split custody)
6. **Rotate Transit key** periodically and rewrap DEKs

---

## Related Files

- `config/vault/config.hcl` - Vault server configuration
- `config/vault/policies/encryption-service.hcl` - Access policy
- `scripts/init-vault.sh` - Vault initialization script
- `config/postgres/init.sql` - Database schema with `encrypted_dek` column
