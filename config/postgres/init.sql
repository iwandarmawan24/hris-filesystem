-- =============================================================================
-- HRIS Filesystem - PostgreSQL Initialization Script
-- =============================================================================
-- This script runs on first container start
-- Stores METADATA ONLY - Never stores file content
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- USERS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_role CHECK (role IN ('admin', 'user', 'viewer'))
);

-- =============================================================================
-- FILES METADATA TABLE
-- =============================================================================
-- IMPORTANT: This table stores METADATA ONLY
-- Actual encrypted file content is stored in SFTP/file-storage
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Original file info (before encryption)
    original_name VARCHAR(500) NOT NULL,
    original_size BIGINT NOT NULL,
    mime_type VARCHAR(255),

    -- Storage reference (encrypted blob location)
    storage_path VARCHAR(500) NOT NULL UNIQUE,  -- UUID.enc path in SFTP
    encrypted_size BIGINT NOT NULL,

    -- Integrity
    checksum_original VARCHAR(64) NOT NULL,      -- SHA-256 of original file
    checksum_encrypted VARCHAR(64) NOT NULL,     -- SHA-256 of encrypted blob

    -- Encryption metadata (NOT the key itself)
    vault_key_version INTEGER NOT NULL,          -- Vault key version used
    encryption_iv VARCHAR(32),                   -- IV (safe to store)

    -- Ownership
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP WITH TIME ZONE,         -- Soft delete

    -- Indexes for common queries
    CONSTRAINT positive_sizes CHECK (original_size > 0 AND encrypted_size > 0)
);

-- =============================================================================
-- FILE PERMISSIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS file_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(20) NOT NULL,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_permission CHECK (permission IN ('read', 'write', 'delete', 'share')),
    CONSTRAINT unique_file_user_permission UNIQUE (file_id, user_id, permission)
);

-- =============================================================================
-- AUDIT LOG TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Who
    user_id UUID REFERENCES users(id),
    user_email VARCHAR(255),                     -- Denormalized for historical record
    ip_address INET,
    user_agent TEXT,

    -- What
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,

    -- Details
    details JSONB,

    -- When
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_action CHECK (action IN (
        'login', 'logout', 'login_failed',
        'file_upload', 'file_download', 'file_delete', 'file_share',
        'permission_grant', 'permission_revoke',
        'user_create', 'user_update', 'user_delete'
    )),
    CONSTRAINT valid_resource_type CHECK (resource_type IN ('user', 'file', 'permission', 'system'))
);

-- =============================================================================
-- SESSIONS TABLE (for JWT refresh tokens)
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(64) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_created ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_files_storage_path ON files(storage_path);

CREATE INDEX IF NOT EXISTS idx_permissions_file ON file_permissions(file_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user ON file_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_permissions_expires ON file_permissions(expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_valid ON sessions(is_valid, expires_at) WHERE is_valid = true;

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- TRIGGERS
-- =============================================================================
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- DEFAULT ADMIN USER (Change password immediately!)
-- =============================================================================
-- Password: admin123 (bcrypt hash)
-- IMPORTANT: Change this password after first login
INSERT INTO users (email, password_hash, full_name, role)
VALUES (
    'admin@hris.local',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.q3VZKVq3E3oZ2a',
    'System Administrator',
    'admin'
) ON CONFLICT (email) DO NOTHING;

-- =============================================================================
-- COMMENTS
-- =============================================================================
COMMENT ON TABLE files IS 'Stores file METADATA only. Encrypted content is in SFTP storage.';
COMMENT ON COLUMN files.storage_path IS 'Path to encrypted blob in SFTP. Format: {uuid}.enc';
COMMENT ON COLUMN files.vault_key_version IS 'Version of Vault transit key used for encryption';
COMMENT ON COLUMN files.checksum_original IS 'SHA-256 hash of original unencrypted file';
COMMENT ON COLUMN files.checksum_encrypted IS 'SHA-256 hash of encrypted blob for integrity check';
