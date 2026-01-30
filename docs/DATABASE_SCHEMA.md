# Database Schema Design

> PostgreSQL schema untuk encrypted file management system. Representasi Oracle DB metadata storage di environment enterprise.

## Table of Contents

- [Overview](#overview)
- [Entity Relationship Diagram](#entity-relationship-diagram)
- [Table Definitions](#table-definitions)
- [Indexing Strategy](#indexing-strategy)
- [Enterprise Safety Features](#enterprise-safety-features)
- [Oracle DB Mapping](#oracle-db-mapping)
- [Query Patterns](#query-patterns)

---

## Overview

### Core Principle: Metadata Only

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA SEPARATION PRINCIPLE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────┐                    ┌─────────────────────┐        │
│  │     PostgreSQL      │                    │    SFTP Storage     │        │
│  │                     │                    │                     │        │
│  │  ✓ File metadata    │                    │  ✓ Encrypted blobs  │        │
│  │  ✓ User accounts    │                    │  ✓ No metadata      │        │
│  │  ✓ Permissions      │                    │  ✓ No filenames     │        │
│  │  ✓ Audit logs       │                    │  ✓ UUID.enc only    │        │
│  │  ✓ Wrapped DEKs     │                    │                     │        │
│  │                     │                    │                     │        │
│  │  ✗ NO file content  │                    │  ✗ NO keys          │        │
│  │  ✗ NO raw keys      │                    │  ✗ NO user info     │        │
│  └─────────────────────┘                    └─────────────────────┘        │
│                                                                              │
│  BREACH SCENARIO:                                                           │
│  • DB leaked → metadata only, files unreadable                              │
│  • Storage leaked → encrypted blobs, no context                             │
│  • Both leaked → still need Vault to decrypt                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Requirements Coverage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| No file content in DB | ✅ | `storage_path` points to SFTP, content never stored |
| Multi-user support | ✅ | `users` table with roles (admin, user, viewer) |
| Track ownership | ✅ | `files.owner_id` → `users.id` |
| Track access | ✅ | `file_permissions` table + `audit_logs` |
| Encryption key reference | ✅ | `encrypted_dek`, `vault_key_version`, `encryption_iv` |

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENTITY RELATIONSHIP DIAGRAM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐   │
│  │     users       │       │     files       │       │  audit_logs     │   │
│  ├─────────────────┤       ├─────────────────┤       ├─────────────────┤   │
│  │ id (PK)         │──┐    │ id (PK)         │       │ id (PK)         │   │
│  │ email (UQ)      │  │    │ original_name   │       │ user_id (FK)────│───┘
│  │ password_hash   │  │    │ original_size   │       │ user_email      │   │
│  │ full_name       │  │    │ mime_type       │       │ ip_address      │   │
│  │ role            │  │    │ storage_path    │       │ user_agent      │   │
│  │ is_active       │  │    │ encrypted_size  │       │ action          │   │
│  │ created_at      │  │    │ checksum_*      │       │ resource_type   │   │
│  │ updated_at      │  │    │ encrypted_dek   │       │ resource_id     │   │
│  │ last_login_at   │  │    │ vault_key_ver   │       │ details (JSONB) │   │
│  └─────────────────┘  │    │ encryption_iv   │       │ created_at      │   │
│         │             │    │ owner_id (FK)───│───────└─────────────────┘   │
│         │             │    │ created_at      │                              │
│         │             │    │ updated_at      │                              │
│         │             │    │ deleted_at      │                              │
│         │             │    └─────────────────┘                              │
│         │             │             │                                        │
│         │             │             │ 1:N                                    │
│         │             │             ▼                                        │
│         │             │    ┌─────────────────┐                              │
│         │             │    │file_permissions │                              │
│         │             │    ├─────────────────┤                              │
│         │             │    │ id (PK)         │                              │
│         │             └───►│ file_id (FK)    │                              │
│         │                  │ user_id (FK)────│──────────────────────────────┘
│         │                  │ permission      │                              │
│         │                  │ granted_by (FK) │                              │
│         │                  │ granted_at      │                              │
│         │                  │ expires_at      │                              │
│         │                  └─────────────────┘                              │
│         │                                                                    │
│         │             ┌─────────────────┐                                   │
│         │             │    sessions     │                                   │
│         │             ├─────────────────┤                                   │
│         └────────────►│ id (PK)         │                                   │
│                       │ user_id (FK)    │                                   │
│                       │ refresh_token_h │                                   │
│                       │ ip_address      │                                   │
│                       │ user_agent      │                                   │
│                       │ is_valid        │                                   │
│                       │ created_at      │                                   │
│                       │ expires_at      │                                   │
│                       │ revoked_at      │                                   │
│                       └─────────────────┘                                   │
│                                                                              │
│  LEGEND:                                                                    │
│  ────► Foreign Key (1:N)                                                    │
│  (PK)  Primary Key                                                          │
│  (FK)  Foreign Key                                                          │
│  (UQ)  Unique Constraint                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Relationships Summary

| Parent | Child | Relationship | On Delete |
|--------|-------|--------------|-----------|
| `users` | `files` | 1:N | CASCADE |
| `users` | `file_permissions` | 1:N | CASCADE |
| `users` | `sessions` | 1:N | CASCADE |
| `users` | `audit_logs` | 1:N | SET NULL |
| `files` | `file_permissions` | 1:N | CASCADE |

---

## Table Definitions

### 1. users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,      -- bcrypt hash
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user', -- admin, user, viewer
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,

    CONSTRAINT valid_role CHECK (role IN ('admin', 'user', 'viewer'))
);
```

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key, auto-generated |
| `email` | VARCHAR(255) | Login identifier, unique |
| `password_hash` | VARCHAR(255) | bcrypt hashed password |
| `role` | VARCHAR(50) | RBAC: admin, user, viewer |
| `is_active` | BOOLEAN | Soft disable without delete |

### 2. files (Metadata Only)

```sql
CREATE TABLE files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Original file info
    original_name VARCHAR(500) NOT NULL,      -- Original filename
    original_size BIGINT NOT NULL,            -- Size before encryption
    mime_type VARCHAR(255),                   -- Content type

    -- Storage reference (NOT content)
    storage_path VARCHAR(500) NOT NULL UNIQUE, -- UUID.enc in SFTP
    encrypted_size BIGINT NOT NULL,            -- Size after encryption

    -- Integrity verification
    checksum_original VARCHAR(64) NOT NULL,   -- SHA-256 of plaintext
    checksum_encrypted VARCHAR(64) NOT NULL,  -- SHA-256 of ciphertext

    -- Encryption metadata (NOT the key)
    encrypted_dek TEXT NOT NULL,              -- Wrapped DEK: vault:v1:...
    vault_key_version INTEGER NOT NULL,       -- Vault key version
    encryption_iv VARCHAR(48),                -- IV/Nonce (base64)

    -- Ownership
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,                   -- Soft delete

    CONSTRAINT positive_sizes CHECK (original_size > 0 AND encrypted_size > 0)
);
```

| Column | Type | Purpose | Security Note |
|--------|------|---------|---------------|
| `storage_path` | VARCHAR | Reference to SFTP blob | Not the content |
| `encrypted_dek` | TEXT | Wrapped DEK from Vault | Useless without Vault |
| `vault_key_version` | INTEGER | For key rotation tracking | Metadata only |
| `encryption_iv` | VARCHAR | Initialization Vector | Safe to store |
| `checksum_*` | VARCHAR(64) | Integrity verification | SHA-256 hashes |

### 3. file_permissions

```sql
CREATE TABLE file_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(20) NOT NULL,          -- read, write, delete, share
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,                   -- Optional expiration

    CONSTRAINT valid_permission CHECK (permission IN ('read', 'write', 'delete', 'share')),
    CONSTRAINT unique_file_user_permission UNIQUE (file_id, user_id, permission)
);
```

| Permission | Allows |
|------------|--------|
| `read` | Download file |
| `write` | Update/replace file |
| `delete` | Delete file |
| `share` | Grant permissions to others |

### 4. audit_logs

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Who
    user_id UUID REFERENCES users(id),
    user_email VARCHAR(255),                  -- Denormalized (historical)
    ip_address INET,
    user_agent TEXT,

    -- What
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    details JSONB,                            -- Flexible additional data

    -- When
    created_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT valid_action CHECK (action IN (
        'login', 'logout', 'login_failed',
        'file_upload', 'file_download', 'file_delete', 'file_share',
        'permission_grant', 'permission_revoke',
        'user_create', 'user_update', 'user_delete'
    ))
);
```

**Why denormalize `user_email`?**
- Audit logs are historical records
- If user is deleted, we still need to know who performed actions
- Compliant with enterprise audit requirements

### 5. sessions

```sql
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64) NOT NULL,  -- SHA-256 of refresh token
    ip_address INET,
    user_agent TEXT,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
```

**Why store refresh token hash?**
- Never store tokens in plaintext
- Can validate without exposing token
- Can revoke specific sessions

---

## Indexing Strategy

```sql
-- Files: Owner lookup (most common query)
CREATE INDEX idx_files_owner ON files(owner_id);

-- Files: Recent files first
CREATE INDEX idx_files_created ON files(created_at DESC);

-- Files: Active files only (partial index)
CREATE INDEX idx_files_deleted ON files(deleted_at) WHERE deleted_at IS NULL;

-- Files: Storage path lookup
CREATE INDEX idx_files_storage_path ON files(storage_path);

-- Permissions: File access check
CREATE INDEX idx_permissions_file ON file_permissions(file_id);

-- Permissions: User's accessible files
CREATE INDEX idx_permissions_user ON file_permissions(user_id);

-- Permissions: Expiring permissions (partial)
CREATE INDEX idx_permissions_expires ON file_permissions(expires_at)
    WHERE expires_at IS NOT NULL;

-- Audit: User activity
CREATE INDEX idx_audit_user ON audit_logs(user_id);

-- Audit: Action filtering
CREATE INDEX idx_audit_action ON audit_logs(action);

-- Audit: Resource lookup
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);

-- Audit: Timeline (most common)
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Sessions: User sessions
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Sessions: Valid sessions only (partial)
CREATE INDEX idx_sessions_valid ON sessions(is_valid, expires_at)
    WHERE is_valid = true;
```

### Index Design Rationale

| Index | Type | Purpose |
|-------|------|---------|
| `idx_files_owner` | B-tree | Fast "my files" query |
| `idx_files_deleted` | Partial B-tree | Skip soft-deleted files |
| `idx_permissions_expires` | Partial B-tree | Cleanup job efficiency |
| `idx_audit_created` | B-tree DESC | Recent-first audit view |
| `idx_sessions_valid` | Partial B-tree | Active sessions only |

### Why Partial Indexes?

```sql
-- Full index: indexes ALL rows
CREATE INDEX idx_all ON files(deleted_at);

-- Partial index: indexes only matching rows (smaller, faster)
CREATE INDEX idx_active ON files(deleted_at) WHERE deleted_at IS NULL;
```

Benefits:
- Smaller index size
- Faster writes (fewer rows to index)
- Faster reads (less to scan)
- Perfect for soft-delete patterns

---

## Enterprise Safety Features

### 1. Data Integrity

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA INTEGRITY LAYERS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. PRIMARY KEYS (UUID)                                         │
│     • Globally unique identifiers                               │
│     • No sequential guessing                                    │
│     • Safe for distributed systems                              │
│                                                                  │
│  2. FOREIGN KEYS with CASCADE                                   │
│     • Referential integrity enforced                            │
│     • No orphan records                                         │
│     • Automatic cleanup on delete                               │
│                                                                  │
│  3. CHECK CONSTRAINTS                                           │
│     • valid_role: only admin/user/viewer                        │
│     • valid_permission: only read/write/delete/share            │
│     • positive_sizes: file sizes must be > 0                    │
│                                                                  │
│  4. UNIQUE CONSTRAINTS                                          │
│     • users.email: no duplicate accounts                        │
│     • files.storage_path: no duplicate storage refs             │
│     • file_permissions: no duplicate grants                     │
│                                                                  │
│  5. NOT NULL CONSTRAINTS                                        │
│     • Critical fields cannot be empty                           │
│     • Prevents incomplete records                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Audit Trail

```
┌─────────────────────────────────────────────────────────────────┐
│                       AUDIT COMPLIANCE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  WHO: user_id, user_email, ip_address, user_agent               │
│  WHAT: action, resource_type, resource_id, details              │
│  WHEN: created_at (immutable timestamp)                         │
│                                                                  │
│  FEATURES:                                                      │
│  • Denormalized user_email (survives user deletion)             │
│  • JSONB details (flexible, queryable)                          │
│  • No UPDATE/DELETE on audit_logs (append-only pattern)         │
│  • IP address for forensics                                     │
│  • User agent for device tracking                               │
│                                                                  │
│  COMPLIANCE:                                                    │
│  ✓ SOC 2 Type II                                                │
│  ✓ ISO 27001                                                    │
│  ✓ GDPR (with data retention policy)                            │
│  ✓ HIPAA (with encryption)                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Soft Delete Pattern

```sql
-- Never hard delete files
UPDATE files SET deleted_at = NOW() WHERE id = ?;

-- Query active files only
SELECT * FROM files WHERE deleted_at IS NULL;

-- Recovery is possible
UPDATE files SET deleted_at = NULL WHERE id = ?;

-- Permanent delete (admin only, after retention period)
DELETE FROM files WHERE deleted_at < NOW() - INTERVAL '90 days';
```

### 4. Session Security

```
┌─────────────────────────────────────────────────────────────────┐
│                      SESSION SECURITY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  • Refresh token stored as SHA-256 hash (not plaintext)         │
│  • Explicit expiration timestamp                                │
│  • Revocation tracking (revoked_at)                             │
│  • Device fingerprinting (ip_address, user_agent)               │
│  • Can invalidate all sessions (is_valid = false)               │
│                                                                  │
│  ATTACK MITIGATIONS:                                            │
│  • Token theft → can revoke specific session                    │
│  • Credential compromise → revoke all sessions                  │
│  • Session fixation → new token on login                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Oracle DB Mapping

| PostgreSQL (This Demo) | Oracle DB (Enterprise) | Notes |
|------------------------|------------------------|-------|
| `uuid_generate_v4()` | `SYS_GUID()` | UUID generation |
| `TIMESTAMPTZ` | `TIMESTAMP WITH TIME ZONE` | Timezone-aware |
| `VARCHAR` | `VARCHAR2` | String type |
| `BIGINT` | `NUMBER(19)` | Large integers |
| `BOOLEAN` | `NUMBER(1)` | Oracle has no boolean |
| `JSONB` | `JSON` or `CLOB` | JSON storage |
| `INET` | `VARCHAR2(45)` | IP address storage |
| `TEXT` | `CLOB` | Large text |
| `CREATE INDEX` | Same | B-tree by default |
| Partial Index | Function-based Index | Similar concept |
| `ON DELETE CASCADE` | Same | Referential action |

### Migration Example

```sql
-- PostgreSQL
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true
);

-- Oracle equivalent
CREATE TABLE users (
    id RAW(16) DEFAULT SYS_GUID() PRIMARY KEY,
    email VARCHAR2(255) NOT NULL UNIQUE,
    is_active NUMBER(1) DEFAULT 1
);
```

---

## Query Patterns

### Get User's Files

```sql
SELECT f.id, f.original_name, f.original_size, f.created_at
FROM files f
WHERE f.owner_id = :user_id
  AND f.deleted_at IS NULL
ORDER BY f.created_at DESC
LIMIT 50 OFFSET 0;
```

### Get Files Shared With User

```sql
SELECT f.id, f.original_name, f.original_size,
       fp.permission, u.full_name as owner_name
FROM files f
JOIN file_permissions fp ON f.id = fp.file_id
JOIN users u ON f.owner_id = u.id
WHERE fp.user_id = :user_id
  AND f.deleted_at IS NULL
  AND (fp.expires_at IS NULL OR fp.expires_at > NOW())
ORDER BY f.created_at DESC;
```

### Check File Access

```sql
SELECT EXISTS (
    SELECT 1 FROM files f
    WHERE f.id = :file_id
      AND f.deleted_at IS NULL
      AND (
          f.owner_id = :user_id
          OR EXISTS (
              SELECT 1 FROM file_permissions fp
              WHERE fp.file_id = f.id
                AND fp.user_id = :user_id
                AND fp.permission = :required_permission
                AND (fp.expires_at IS NULL OR fp.expires_at > NOW())
          )
      )
) as has_access;
```

### Audit Log Query

```sql
SELECT
    al.created_at,
    al.user_email,
    al.action,
    al.resource_type,
    al.ip_address,
    al.details
FROM audit_logs al
WHERE al.created_at >= :start_date
  AND al.created_at <= :end_date
  AND (:action IS NULL OR al.action = :action)
  AND (:user_id IS NULL OR al.user_id = :user_id)
ORDER BY al.created_at DESC
LIMIT 100;
```

### Cleanup Expired Permissions

```sql
DELETE FROM file_permissions
WHERE expires_at IS NOT NULL
  AND expires_at < NOW();
```

### Cleanup Old Sessions

```sql
UPDATE sessions
SET is_valid = false, revoked_at = NOW()
WHERE expires_at < NOW()
  AND is_valid = true;
```

---

## Related Files

- `config/postgres/init.sql` - Schema definition
- `services/api-service/prisma/schema.prisma` - Prisma ORM schema (TBD)
- `docs/VAULT_KEY_MANAGEMENT.md` - Key management design
