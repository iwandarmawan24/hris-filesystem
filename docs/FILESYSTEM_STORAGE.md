# Filesystem Storage Design

> Strategi penyimpanan file terenkripsi dalam environment Docker.

## Table of Contents

- [Overview](#overview)
- [File Naming Strategy](#file-naming-strategy)
- [Directory Structure](#directory-structure)
- [Metadata Mapping](#metadata-mapping)
- [Security Analysis](#security-analysis)
- [Storage Operations](#storage-operations)

---

## Overview

### Core Principle: Encrypted Blobs Only

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STORAGE ISOLATION PRINCIPLE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WHAT'S STORED:                       WHAT'S NOT STORED:                    │
│  ═══════════════                      ══════════════════                    │
│                                                                              │
│  ✓ Encrypted binary blobs             ✗ Original filenames                  │
│  ✓ Random UUID filenames              ✗ File metadata                       │
│  ✓ .enc extension                     ✗ User information                    │
│                                       ✗ Encryption keys                     │
│                                       ✗ Timestamps                          │
│                                       ✗ File relationships                  │
│                                                                              │
│  STORAGE CONTENT = MEANINGLESS WITHOUT:                                     │
│  • Database (metadata mapping)                                              │
│  • Vault (encryption keys)                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Files encrypted at rest | ✅ | AES-256-GCM before storage |
| Names don't reveal original | ✅ | UUID v4 filenames |
| Decoupled from DB | ✅ | Separate SFTP server |
| Breach = no plaintext | ✅ | Keys in Vault, metadata in PostgreSQL |

---

## File Naming Strategy

### UUID-Based Naming

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FILE NAMING TRANSFORMATION                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ORIGINAL FILE:                                                             │
│  ┌─────────────────────────────────────────┐                               │
│  │ confidential-salary-report-2024.xlsx    │                               │
│  │ Size: 245,678 bytes                     │                               │
│  │ Type: application/vnd.openxmlformats    │                               │
│  └─────────────────────────────────────────┘                               │
│                      │                                                       │
│                      ▼ Encrypt + Rename                                      │
│                                                                              │
│  STORED FILE:                                                               │
│  ┌─────────────────────────────────────────┐                               │
│  │ a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc│                               │
│  │ Size: 245,712 bytes (+ encryption overhead)                             │
│  │ Type: application/octet-stream          │                               │
│  └─────────────────────────────────────────┘                               │
│                                                                              │
│  INFORMATION LEAKED: NONE                                                   │
│  • Original name: hidden                                                    │
│  • File type: hidden                                                        │
│  • Content: encrypted                                                       │
│  • Owner: unknown                                                           │
│  • Purpose: unknown                                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Naming Rules

| Aspect | Rule | Example |
|--------|------|---------|
| Format | `{UUID v4}.enc` | `a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc` |
| UUID version | v4 (random) | Not predictable |
| Extension | Always `.enc` | Indicates encrypted blob |
| Case | Lowercase | Consistent across systems |

### Why UUID v4?

```
┌─────────────────────────────────────────────────────────────────┐
│                     UUID v4 BENEFITS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. UNPREDICTABLE                                               │
│     • 122 bits of randomness                                    │
│     • Cannot guess next/previous file                           │
│     • No sequential patterns                                    │
│                                                                  │
│  2. COLLISION-RESISTANT                                         │
│     • 2^122 possible values                                     │
│     • Probability of collision ≈ 0                              │
│     • Safe for distributed generation                           │
│                                                                  │
│  3. NO INFORMATION LEAKAGE                                      │
│     • No timestamp (unlike UUID v1)                             │
│     • No MAC address (unlike UUID v1)                           │
│     • Pure randomness                                           │
│                                                                  │
│  4. STANDARD FORMAT                                             │
│     • 36 characters (with hyphens)                              │
│     • Filesystem-safe                                           │
│     • URL-safe                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

### Storage Layout

```
/data/hris/files/                    # HDD mount point
└── encrypted/                       # Chroot root for SFTP user
    ├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc
    ├── b2c3d4e5-f6a7-8901-bcde-f12345678901.enc
    ├── c3d4e5f6-a7b8-9012-cdef-123456789012.enc
    └── ...
```

### Flat vs Hierarchical

**Chosen: Flat Structure**

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLAT STRUCTURE (CHOSEN)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /encrypted/                                                    │
│  ├── uuid1.enc                                                  │
│  ├── uuid2.enc                                                  │
│  └── uuid3.enc                                                  │
│                                                                  │
│  PROS:                                                          │
│  ✓ Simple implementation                                        │
│  ✓ No directory traversal needed                                │
│  ✓ Fast direct access                                           │
│  ✓ No metadata in path structure                                │
│                                                                  │
│  CONS:                                                          │
│  • Many files in one directory (mitigated by modern FS)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Alternative: Sharded (for millions of files)**

```
┌─────────────────────────────────────────────────────────────────┐
│                    SHARDED STRUCTURE (FUTURE)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /encrypted/                                                    │
│  ├── a1/                                                        │
│  │   └── b2/                                                    │
│  │       └── a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc          │
│  ├── b2/                                                        │
│  │   └── c3/                                                    │
│  │       └── b2c3d4e5-f6a7-8901-bcde-f12345678901.enc          │
│  └── ...                                                        │
│                                                                  │
│  FORMULA: /{first-2-chars}/{next-2-chars}/{full-uuid}.enc       │
│                                                                  │
│  WHEN TO USE:                                                   │
│  • 100,000+ files expected                                      │
│  • Filesystem performance degrades                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Docker Volume Mapping

```yaml
# docker-compose.server.yml
sftp-server:
  volumes:
    # Host path → Container path
    - /data/hris/files:/home/hris/data

# Container sees:
# /home/hris/data/encrypted/
#   └── *.enc files

# Host sees:
# /data/hris/files/encrypted/
#   └── *.enc files
```

---

## Metadata Mapping

### Database to Storage Relationship

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      METADATA TO STORAGE MAPPING                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PostgreSQL (files table)                    SFTP Storage                   │
│  ════════════════════════                    ════════════                   │
│                                                                              │
│  ┌─────────────────────────────────┐        ┌────────────────────────────┐ │
│  │ id: uuid-file-1                 │        │                            │ │
│  │ original_name: "report.xlsx"    │───────►│ uuid-file-1.enc            │ │
│  │ storage_path: "uuid-file-1.enc" │        │ (encrypted blob)           │ │
│  │ encrypted_dek: "vault:v1:..."   │        │                            │ │
│  │ owner_id: uuid-user-1           │        └────────────────────────────┘ │
│  └─────────────────────────────────┘                                        │
│                                                                              │
│  ┌─────────────────────────────────┐        ┌────────────────────────────┐ │
│  │ id: uuid-file-2                 │        │                            │ │
│  │ original_name: "photo.jpg"      │───────►│ uuid-file-2.enc            │ │
│  │ storage_path: "uuid-file-2.enc" │        │ (encrypted blob)           │ │
│  │ encrypted_dek: "vault:v1:..."   │        │                            │ │
│  │ owner_id: uuid-user-2           │        └────────────────────────────┘ │
│  └─────────────────────────────────┘                                        │
│                                                                              │
│  MAPPING KEY: files.storage_path → SFTP filename                            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Lookup Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FILE RETRIEVAL FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. User requests: "Download report.xlsx"                                   │
│                         │                                                    │
│                         ▼                                                    │
│  2. API queries PostgreSQL:                                                 │
│     SELECT storage_path, encrypted_dek, encryption_iv                       │
│     FROM files WHERE id = ? AND owner_id = ?                                │
│                         │                                                    │
│                         ▼                                                    │
│  3. Result: storage_path = "a1b2c3d4-...-.enc"                             │
│             encrypted_dek = "vault:v1:abc..."                               │
│                         │                                                    │
│                         ▼                                                    │
│  4. Fetch from SFTP: GET /encrypted/a1b2c3d4-...-.enc                      │
│                         │                                                    │
│                         ▼                                                    │
│  5. Decrypt DEK via Vault                                                   │
│                         │                                                    │
│                         ▼                                                    │
│  6. Decrypt blob with DEK                                                   │
│                         │                                                    │
│                         ▼                                                    │
│  7. Return decrypted file as "report.xlsx"                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Orphan Detection

Files without metadata mapping are orphans:

```sql
-- Find orphan files (storage files not in DB)
-- Run periodically as maintenance job

-- 1. List all storage_path from DB
SELECT storage_path FROM files WHERE deleted_at IS NULL;

-- 2. Compare with actual SFTP listing
-- 3. Files in SFTP but not in DB = orphans (can be deleted)

-- Orphan causes:
-- • Upload interrupted after storage but before DB commit
-- • DB rollback after storage write
-- • Manual file placement (shouldn't happen)
```

---

## Security Analysis

### Breach Scenarios

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        BREACH SCENARIO ANALYSIS                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SCENARIO 1: Storage Breach Only                                            │
│  ═══════════════════════════════                                            │
│                                                                              │
│  Attacker gains: /data/hris/files/encrypted/                                │
│                                                                              │
│  ┌─────────────────────────────────────────────────┐                       │
│  │ a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc       │                       │
│  │ [ENCRYPTED BINARY BLOB - UNREADABLE]            │                       │
│  │                                                 │                       │
│  │ Attacker knows:                                 │                       │
│  │ • There are N files                             │                       │
│  │ • Approximate sizes (with encryption overhead)  │                       │
│  │                                                 │                       │
│  │ Attacker CANNOT know:                           │                       │
│  │ ✗ What files contain                            │                       │
│  │ ✗ Original filenames                            │                       │
│  │ ✗ Who owns the files                            │                       │
│  │ ✗ File types                                    │                       │
│  │ ✗ File relationships                            │                       │
│  └─────────────────────────────────────────────────┘                       │
│                                                                              │
│  RESULT: USELESS DATA                                                       │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SCENARIO 2: Storage + Database Breach                                      │
│  ═════════════════════════════════════                                      │
│                                                                              │
│  Attacker gains:                                                            │
│  • Encrypted files from storage                                             │
│  • Metadata from PostgreSQL (including encrypted_dek)                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────┐                       │
│  │ Attacker now knows:                             │                       │
│  │ • Original filenames                            │                       │
│  │ • File sizes, types                             │                       │
│  │ • Who owns what                                 │                       │
│  │ • Wrapped DEK (vault:v1:...)                    │                       │
│  │                                                 │                       │
│  │ Attacker still CANNOT:                          │                       │
│  │ ✗ Decrypt the DEK (needs Vault)                 │                       │
│  │ ✗ Read file contents                            │                       │
│  └─────────────────────────────────────────────────┘                       │
│                                                                              │
│  RESULT: METADATA EXPOSED, CONTENT STILL PROTECTED                          │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SCENARIO 3: Full Breach (Storage + DB + Vault)                             │
│  ══════════════════════════════════════════════                             │
│                                                                              │
│  Attacker needs ALL THREE + Vault unsealed:                                 │
│  • Storage access                                                           │
│  • Database access                                                          │
│  • Vault access (unsealed)                                                  │
│                                                                              │
│  RESULT: FULL COMPROMISE (but requires 3 systems)                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Defense in Depth

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEFENSE IN DEPTH LAYERS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Layer 1: NETWORK ISOLATION                                     │
│  • Storage on internal network only                             │
│  • No direct external access                                    │
│  • Only file-storage-api can reach SFTP                         │
│                                                                  │
│  Layer 2: ACCESS CONTROL                                        │
│  • SFTP key-based auth (no passwords)                           │
│  • Chroot jail for SFTP user                                    │
│  • Read/write via API only                                      │
│                                                                  │
│  Layer 3: ENCRYPTION AT REST                                    │
│  • AES-256-GCM encryption                                       │
│  • Per-file unique DEK                                          │
│  • DEK wrapped by Vault                                         │
│                                                                  │
│  Layer 4: OBFUSCATION                                           │
│  • No original filenames                                        │
│  • No file type indicators                                      │
│  • Random UUID naming                                           │
│                                                                  │
│  Layer 5: SEPARATION                                            │
│  • Keys in Vault (separate system)                              │
│  • Metadata in PostgreSQL (separate system)                     │
│  • Files in SFTP (separate system)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Storage Operations

### Upload Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           UPLOAD OPERATION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INPUT: User uploads "confidential-report.xlsx" (245KB)                     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 1: Generate Identifiers                                         │   │
│  │         file_id = uuid_generate_v4()                                 │   │
│  │         storage_path = "{file_id}.enc"                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 2: Calculate Checksums                                          │   │
│  │         checksum_original = SHA256(original_file)                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 3: Encrypt File                                                 │   │
│  │         DEK = Vault.generateDataKey()                                │   │
│  │         encrypted_blob = AES256GCM(DEK.plaintext, original_file)     │   │
│  │         checksum_encrypted = SHA256(encrypted_blob)                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 4: Store Encrypted Blob                                         │   │
│  │         SFTP.put(encrypted_blob, "/encrypted/{file_id}.enc")         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 5: Save Metadata                                                │   │
│  │         INSERT INTO files (                                          │   │
│  │           id, original_name, storage_path,                           │   │
│  │           encrypted_dek, vault_key_version,                          │   │
│  │           checksum_original, checksum_encrypted, ...                 │   │
│  │         )                                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 6: Wipe Sensitive Data                                          │   │
│  │         DEK.plaintext = null (memory wipe)                           │   │
│  │         original_file = null                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  OUTPUT: file_id returned to user                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Download Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DOWNLOAD OPERATION                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  INPUT: User requests file_id = "a1b2c3d4-..."                              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 1: Verify Access                                                │   │
│  │         Check ownership OR permission in file_permissions            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 2: Fetch Metadata                                               │   │
│  │         SELECT storage_path, encrypted_dek, encryption_iv,           │   │
│  │                original_name, checksum_original                      │   │
│  │         FROM files WHERE id = ?                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 3: Fetch Encrypted Blob                                         │   │
│  │         encrypted_blob = SFTP.get("/encrypted/{storage_path}")       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 4: Decrypt DEK                                                  │   │
│  │         DEK = Vault.decrypt(encrypted_dek)                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 5: Decrypt File                                                 │   │
│  │         original_file = AES256GCM.decrypt(DEK, iv, encrypted_blob)   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 6: Verify Integrity                                             │   │
│  │         assert SHA256(original_file) == checksum_original            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Step 7: Stream to Client                                             │   │
│  │         Response with original_name, correct MIME type               │   │
│  │         Wipe DEK from memory                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  OUTPUT: Original file streamed with correct filename                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Delete Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DELETE OPERATION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SOFT DELETE (Default):                                                     │
│  ══════════════════════                                                     │
│  UPDATE files SET deleted_at = NOW() WHERE id = ?                           │
│  • File remains in storage (recoverable)                                    │
│  • Metadata retained with deletion timestamp                                │
│  • Can be restored by setting deleted_at = NULL                             │
│                                                                              │
│  HARD DELETE (After retention period):                                      │
│  ═════════════════════════════════════                                      │
│  1. DELETE FROM file_permissions WHERE file_id = ?                          │
│  2. SFTP.delete("/encrypted/{storage_path}")                                │
│  3. DELETE FROM files WHERE id = ?                                          │
│                                                                              │
│  Note: DEK in Vault is NOT deleted (Vault manages key lifecycle)            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Files

- `docker-compose.server.yml` - SFTP server configuration
- `config/sftp/sshd_config` - Hardened SSH configuration
- `docs/DATABASE_SCHEMA.md` - Metadata table design
- `docs/VAULT_KEY_MANAGEMENT.md` - Encryption key management
