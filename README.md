# HRIS Secure File Management System

A zero-trust, enterprise-grade file management system built with Docker and open-source tools. This project demonstrates secure file handling with encryption at rest, proper key management, and clear security boundaries.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Services](#services)
- [Security Model](#security-model)
- [Configuration](#configuration)
- [Development](#development)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

### What is this?

A secure file management system that maps 1:1 to enterprise architecture patterns:

| Component | Enterprise Equivalent | This Project |
|-----------|----------------------|--------------|
| Database | Oracle DB | PostgreSQL |
| Key Management | AWS KMS / Azure Key Vault | HashiCorp Vault |
| File Storage | Enterprise NAS/SAN | SFTP + Docker Volume |
| Encryption | HSM-backed encryption | Application-layer AES-256-GCM |

### Key Principles

- **Zero-Trust Architecture**: Every service authenticates; no implicit trust
- **Defense in Depth**: Multiple security layers; compromise of one doesn't expose all
- **Separation of Concerns**: Database stores metadata only; files stored separately; keys in dedicated KMS
- **Encryption at Rest**: All files encrypted before storage; database never sees plaintext content

### Distributed Setup

```
┌─────────────────────────┐         ┌─────────────────────────┐
│     LOCAL LAPTOP        │         │      HOME SERVER        │
│                         │         │                         │
│  - app-client (React)   │◄───────►│  - postgres (metadata)  │
│  - api-service (Node)   │   VPN   │  - vault (KMS)          │
│  - encryption-svc (Py)  │         │  - file-storage (SFTP)  │
└─────────────────────────┘         └─────────────────────────┘
```

---

## Architecture

### High-Level Architecture

```
                                    ┌─────────────────┐
                                    │   app-client    │
                                    │   (React/Vite)  │
                                    │   Port: 3000    │
                                    └────────┬────────┘
                                             │ HTTPS
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LOCAL LAPTOP                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         api-service (Node.js)                        │   │
│  │                              Port: 8080                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │   │
│  │  │    Auth      │  │   Business   │  │  Orchestrator│               │   │
│  │  │  (JWT/RBAC)  │  │    Logic     │  │              │               │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                                        │                        │
│           │ gRPC/HTTP                              │                        │
│           ▼                                        │                        │
│  ┌─────────────────┐                              │                        │
│  │ encryption-svc  │                              │                        │
│  │    (Python)     │                              │                        │
│  │   Port: 8081    │                              │                        │
│  └────────┬────────┘                              │                        │
│           │                                        │                        │
└───────────┼────────────────────────────────────────┼────────────────────────┘
            │                                        │
            │ Tailscale / WireGuard VPN              │
            │                                        │
┌───────────┼────────────────────────────────────────┼────────────────────────┐
│           │              HOME SERVER               │                        │
│           ▼                                        ▼                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐            │
│  │     vault       │  │    postgres     │  │ file-storage-api│            │
│  │   (HashiCorp)   │  │   (Metadata)    │  │    (Node.js)    │            │
│  │   Port: 8200    │  │   Port: 5432    │  │   Port: 8082    │            │
│  │                 │  │                 │  │        │        │            │
│  │  Transit Engine │  │  - users        │  │        ▼        │            │
│  │  AppRole Auth   │  │  - files        │  │  ┌───────────┐  │            │
│  │                 │  │  - permissions  │  │  │   SFTP    │  │            │
│  │                 │  │  - audit_logs   │  │  │  Server   │  │            │
│  └─────────────────┘  └─────────────────┘  │  └───────────┘  │            │
│                                            │        │        │            │
│                                            │        ▼        │            │
│                                            │  [encrypted]    │            │
│                                            │  [   blobs  ]   │            │
│                                            └─────────────────┘            │
└───────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: File Upload

```
User                App-Client         API-Service      Encryption-Svc      Vault           File-Storage       Postgres
 │                      │                   │                 │               │                   │               │
 │──Upload File────────►│                   │                 │               │                   │               │
 │                      │──POST /files─────►│                 │               │                   │               │
 │                      │                   │──Encrypt Req───►│               │                   │               │
 │                      │                   │                 │──Get DEK─────►│                   │               │
 │                      │                   │                 │◄──DEK─────────│                   │               │
 │                      │                   │                 │               │                   │               │
 │                      │                   │                 │ [Encrypt with │                   │               │
 │                      │                   │                 │  AES-256-GCM] │                   │               │
 │                      │                   │                 │               │                   │               │
 │                      │                   │◄─Encrypted Blob─│               │                   │               │
 │                      │                   │                 │               │                   │               │
 │                      │                   │──Store Blob────────────────────────────────────────►│               │
 │                      │                   │◄─Storage Path───────────────────────────────────────│               │
 │                      │                   │                 │               │                   │               │
 │                      │                   │──Save Metadata───────────────────────────────────────────────────►│
 │                      │                   │◄─File ID─────────────────────────────────────────────────────────│
 │                      │◄─Response─────────│                 │               │                   │               │
 │◄─Success────────────│                   │                 │               │                   │               │
```

### Network Segmentation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NETWORK TOPOLOGY                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LOCAL NETWORKS                          HOME SERVER NETWORKS                │
│  ══════════════                          ═══════════════════                 │
│                                                                              │
│  ┌─────────────────────┐                ┌─────────────────────┐             │
│  │   frontend-net      │                │      db-net         │             │
│  │   172.20.0.0/24     │                │   172.22.0.0/24     │             │
│  │                     │                │                     │             │
│  │ app-client ◄──► api │                │     postgres        │             │
│  └─────────────────────┘                └─────────────────────┘             │
│                                                                              │
│  ┌─────────────────────┐                ┌─────────────────────┐             │
│  │   backend-net       │                │     vault-net       │             │
│  │   172.21.0.0/24     │                │   172.23.0.0/24     │             │
│  │   [internal only]   │                │                     │             │
│  │                     │                │       vault         │             │
│  │ api ◄──► encryption │                └─────────────────────┘             │
│  └─────────────────────┘                                                    │
│                                         ┌─────────────────────┐             │
│                                         │    storage-net      │             │
│                                         │   172.24.0.0/24     │             │
│                                         │   [internal only]   │             │
│                                         │                     │             │
│                                         │ api ◄──► sftp       │             │
│                                         └─────────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Frontend** | React + Vite | 18.x / 5.x | User interface |
| | TailwindCSS | 3.x | Styling |
| **API** | Node.js + Fastify | 20.x / 4.x | REST API, business logic |
| | Prisma | 5.x | Database ORM |
| **Encryption** | Python + FastAPI | 3.12 / 0.109 | Encryption operations |
| | cryptography | 42.x | AES-256-GCM implementation |
| **Database** | PostgreSQL | 16 | Metadata storage |
| **KMS** | HashiCorp Vault | 1.15 | Key management, transit encryption |
| **Storage** | atmoz/sftp | alpine | Encrypted file storage |
| **Infrastructure** | Docker Compose | 2.x | Container orchestration |
| | Tailscale/WireGuard | - | Secure networking |

---

## Prerequisites

### Required Software

| Software | Version | Check Command |
|----------|---------|---------------|
| Docker | 24.0+ | `docker --version` |
| Docker Compose | 2.0+ | `docker compose version` |
| Node.js | 20.x | `node --version` |
| Python | 3.12+ | `python3 --version` |
| OpenSSL | 3.x | `openssl version` |

### Network Requirements

- **VPN Connection**: Tailscale or WireGuard between local and home server
- **Open Ports on Home Server**:
  - `5432` - PostgreSQL
  - `8200` - Vault
  - `8082` - File Storage API

---

## Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd hris-filesystem
```

### 2. Home Server Setup

```bash
# SSH into your home server
ssh user@homeserver

# Navigate to project
cd /path/to/hris-filesystem

# Run setup script
./scripts/setup-server.sh

# Initialize Vault (wait for containers to start)
./scripts/init-vault.sh

# IMPORTANT: Save the output credentials
# VAULT_ROLE_ID=xxxxx
# VAULT_SECRET_ID=xxxxx
```

### 3. Local Development Setup

```bash
# Copy environment template
cp .env.local.example .env.local

# Edit configuration
nano .env.local

# Required changes:
# - HOME_SERVER_HOST=<your-server-ip-or-tailscale-hostname>
# - POSTGRES_PASSWORD=<from-server-.env.server>
# - VAULT_ROLE_ID=<from-init-vault.sh-output>
# - VAULT_SECRET_ID=<from-init-vault.sh-output>
# - FILE_STORAGE_API_KEY=<from-server-.env.server>

# Run local setup
./scripts/setup-local.sh

# Start services
docker compose -f docker-compose.local.yml up -d
```

### 4. Verify Installation

```bash
# Check all services are running
docker compose -f docker-compose.local.yml ps

# Test API health
curl http://localhost:8080/health

# Open UI
open http://localhost:3000
```

---

## Project Structure

```
hris-filesystem/
│
├── docker-compose.local.yml      # Local services (app, api, encryption)
├── docker-compose.server.yml     # Server services (db, vault, storage)
│
├── .env.local.example            # Local environment template
├── .env.server.example           # Server environment template
├── .gitignore                    # Git ignore rules
├── README.md                     # This file
│
├── config/
│   ├── postgres/
│   │   ├── init.sql              # Database schema
│   │   └── ssl/                  # PostgreSQL SSL certs (generated)
│   │
│   ├── vault/
│   │   ├── config.hcl            # Vault server configuration
│   │   └── policies/
│   │       └── encryption-service.hcl  # Vault policy
│   │
│   └── sftp/
│       ├── sshd_config           # Hardened SSH config
│       └── keys/                 # SFTP SSH keys (generated)
│
├── scripts/
│   ├── setup-server.sh           # Server initialization
│   ├── setup-local.sh            # Local initialization
│   └── init-vault.sh             # Vault configuration
│
└── services/
    ├── app-client/               # React frontend
    │   ├── Dockerfile
    │   ├── package.json
    │   └── src/
    │
    ├── api-service/              # Node.js API
    │   ├── Dockerfile
    │   ├── package.json
    │   ├── prisma/
    │   └── src/
    │
    ├── encryption-service/       # Python encryption
    │   ├── Dockerfile
    │   ├── requirements.txt
    │   └── src/
    │
    └── file-storage-api/         # Storage abstraction
        ├── Dockerfile
        ├── package.json
        └── src/
```

---

## Services

### app-client (Frontend)

| Property | Value |
|----------|-------|
| **Technology** | React 18 + Vite + TailwindCSS |
| **Port** | 3000 |
| **Purpose** | User interface for file management |

**Features:**
- File upload/download with progress
- File listing and search
- User authentication
- Permission management UI

**Environment Variables:**
```env
VITE_API_URL=http://localhost:8080
```

---

### api-service (Backend API)

| Property | Value |
|----------|-------|
| **Technology** | Node.js 20 + Fastify + Prisma |
| **Port** | 8080 |
| **Purpose** | Business logic, authentication, orchestration |

**Features:**
- RESTful API endpoints
- JWT authentication with refresh tokens
- Role-based access control (RBAC)
- Request validation
- Audit logging

**Key Endpoints:**
```
POST   /auth/login          # User login
POST   /auth/refresh        # Refresh token
GET    /files               # List user files
POST   /files               # Upload file
GET    /files/:id           # Download file
DELETE /files/:id           # Delete file
POST   /files/:id/share     # Share file
GET    /users/me            # Current user profile
```

**Environment Variables:**
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
ENCRYPTION_SERVICE_URL=http://encryption-service:8081
FILE_STORAGE_API_URL=http://homeserver:8082
JWT_SECRET=<secret>
JWT_EXPIRES_IN=24h
```

---

### encryption-service (Encryption)

| Property | Value |
|----------|-------|
| **Technology** | Python 3.12 + FastAPI |
| **Port** | 8081 |
| **Purpose** | File encryption/decryption using Vault |

**Features:**
- AES-256-GCM encryption
- Streaming encryption for large files
- Key retrieval from Vault Transit engine
- Envelope encryption pattern

**Encryption Flow:**
```
1. Request DEK (Data Encryption Key) from Vault
2. Encrypt file content with DEK using AES-256-GCM
3. Return encrypted blob + encrypted DEK (wrapped by Vault)
4. DEK is never stored in plaintext
```

**Environment Variables:**
```env
VAULT_ADDR=http://homeserver:8200
VAULT_ROLE_ID=<role-id>
VAULT_SECRET_ID=<secret-id>
VAULT_MOUNT_PATH=transit
VAULT_KEY_NAME=hris-file-key
```

---

### postgres (Database)

| Property | Value |
|----------|-------|
| **Technology** | PostgreSQL 16 |
| **Port** | 5432 |
| **Purpose** | Metadata storage (NO file content) |

**Tables:**
```sql
users           # User accounts
files           # File metadata (NOT content)
file_permissions # Access control
audit_logs      # Activity tracking
sessions        # JWT refresh tokens
```

**Security:**
- SSL/TLS required
- Strong password authentication
- No file content ever stored

---

### vault (Key Management)

| Property | Value |
|----------|-------|
| **Technology** | HashiCorp Vault 1.15 OSS |
| **Port** | 8200 |
| **Purpose** | Key management, encryption operations |

**Engines Used:**
- **Transit**: Encryption/decryption operations
- **AppRole**: Service authentication

**Key Configuration:**
```
Key Name: hris-file-key
Algorithm: AES-256-GCM96
Exportable: false
Derived: false
```

---

### file-storage-api (Storage Gateway)

| Property | Value |
|----------|-------|
| **Technology** | Node.js 20 + Fastify |
| **Port** | 8082 |
| **Purpose** | Abstraction layer over SFTP storage |

**Features:**
- RESTful interface for blob storage
- Checksum validation
- Audit logging
- API key authentication

**Endpoints:**
```
PUT    /files/:uuid    # Store encrypted blob
GET    /files/:uuid    # Retrieve encrypted blob
DELETE /files/:uuid    # Remove blob
GET    /health         # Health check
```

---

### sftp-server (File Storage)

| Property | Value |
|----------|-------|
| **Technology** | atmoz/sftp (OpenSSH) |
| **Port** | 22 (internal only) |
| **Purpose** | Actual encrypted file storage |

**Security:**
- SSH key authentication only
- Chroot jail enabled
- Password authentication disabled
- SFTP subsystem only (no shell)

**Storage Structure:**
```
/home/hris/data/encrypted/
├── a1b2c3d4-e5f6-7890-abcd-ef1234567890.enc
├── b2c3d4e5-f6a7-8901-bcde-f12345678901.enc
└── ...
```

---

## Security Model

### Zero-Trust Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ZERO-TRUST SECURITY MODEL                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. NEVER TRUST, ALWAYS VERIFY                                              │
│     ├── Every service authenticates to others                               │
│     ├── JWT tokens for user authentication                                  │
│     ├── API keys for service-to-service                                     │
│     └── AppRole for Vault access                                            │
│                                                                              │
│  2. LEAST PRIVILEGE ACCESS                                                  │
│     ├── Vault policy allows only specific operations                        │
│     ├── SFTP user chrooted to data directory                                │
│     ├── Database user has minimal permissions                               │
│     └── Each service only accesses what it needs                            │
│                                                                              │
│  3. DEFENSE IN DEPTH                                                        │
│     ├── Network segmentation (5 isolated networks)                          │
│     ├── Encryption at rest (all files)                                      │
│     ├── Encryption in transit (TLS/mTLS)                                    │
│     └── Audit logging at every layer                                        │
│                                                                              │
│  4. ASSUME BREACH                                                           │
│     ├── Compromised storage = useless encrypted blobs                       │
│     ├── Compromised database = metadata only, no keys                       │
│     ├── Compromised Vault = sealed, needs unseal keys                       │
│     └── All three needed to reconstruct files                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Compromise Scenarios

| Compromised Component | Impact | Mitigation |
|----------------------|--------|------------|
| **File Storage** | Encrypted blobs exposed | Useless without keys from Vault |
| **PostgreSQL** | Metadata leaked | No file content, no encryption keys |
| **Vault (sealed)** | Nothing exposed | Keys encrypted by master key |
| **Vault (unsealed)** | Keys exposed | Rotate keys, revoke tokens |
| **API Service** | Session hijacking possible | Short JWT expiry, refresh rotation |
| **All Components** | Full data breach | Requires all 3 + unseal keys |

### Authentication Matrix

| From | To | Method |
|------|-----|--------|
| User | app-client | Username/Password |
| app-client | api-service | JWT Bearer Token |
| api-service | encryption-service | Internal network (trusted) |
| api-service | postgres | TLS + Credentials |
| api-service | file-storage-api | API Key + TLS |
| encryption-service | vault | AppRole + Token |
| file-storage-api | sftp-server | SSH Key |

---

## Configuration

### Environment Variables

#### Local (.env.local)

```env
# Home Server Connection
HOME_SERVER_HOST=192.168.1.100      # Or Tailscale hostname

# Service Ports
APP_CLIENT_PORT=3000
API_SERVICE_PORT=8080
ENCRYPTION_SERVICE_PORT=8081

# Database
POSTGRES_USER=hris_user
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=hris_metadata
POSTGRES_PORT=5432

# Vault
VAULT_PORT=8200
VAULT_ROLE_ID=<from-init-vault.sh>
VAULT_SECRET_ID=<from-init-vault.sh>
VAULT_MOUNT_PATH=transit
VAULT_KEY_NAME=hris-file-key

# File Storage
FILE_STORAGE_API_PORT=8082
FILE_STORAGE_API_KEY=<api-key>

# JWT
JWT_SECRET=<64-byte-base64-secret>
JWT_EXPIRES_IN=24h

# Other
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=DEBUG
```

#### Server (.env.server)

```env
# Database
POSTGRES_USER=hris_user
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=hris_metadata
POSTGRES_PORT=5432

# Vault
VAULT_PORT=8200
VAULT_MODE=dev                      # Use 'production' for prod

# File Storage
FILE_STORAGE_API_PORT=8082
FILE_STORAGE_API_KEY=<api-key>

# SFTP
SFTP_USER=hris
SFTP_PORT=2222

# Logging
LOG_LEVEL=info
```

### Generating Secrets

```bash
# JWT Secret (64 bytes, base64)
openssl rand -base64 64

# API Key (32 bytes, hex)
openssl rand -hex 32

# Database Password
openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32
```

---

## Development

### Running Locally

```bash
# Start all local services
docker compose -f docker-compose.local.yml up -d

# View logs
docker compose -f docker-compose.local.yml logs -f

# Restart specific service
docker compose -f docker-compose.local.yml restart api-service

# Stop all
docker compose -f docker-compose.local.yml down
```

### Running Individual Services (without Docker)

```bash
# app-client
cd services/app-client
npm install
npm run dev

# api-service
cd services/api-service
npm install
npx prisma generate
npm run dev

# encryption-service
cd services/encryption-service
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8081
```

### Database Migrations

```bash
# Generate migration
cd services/api-service
npx prisma migrate dev --name <migration-name>

# Apply migration
npx prisma migrate deploy

# Reset database (CAUTION: destroys data)
npx prisma migrate reset
```

### Testing

```bash
# Run all tests
npm test                    # Node.js services
pytest                      # Python service

# Run with coverage
npm run test:coverage
pytest --cov=src
```

---

## Deployment

### Production Checklist

- [ ] Change all default passwords
- [ ] Generate new JWT secrets
- [ ] Enable Vault production mode (disable dev mode)
- [ ] Configure Vault auto-unseal or manual unseal procedure
- [ ] Enable TLS for all services
- [ ] Set up proper SSL certificates (not self-signed)
- [ ] Configure firewall rules
- [ ] Set up backup procedures
- [ ] Enable audit logging
- [ ] Configure monitoring and alerting
- [ ] Review and harden Vault policies
- [ ] Set up log aggregation

### Vault Production Mode

```bash
# 1. Stop dev mode vault
docker compose -f docker-compose.server.yml stop vault

# 2. Update .env.server
VAULT_MODE=production

# 3. Start vault
docker compose -f docker-compose.server.yml up -d vault

# 4. Initialize vault
docker exec -it hris-vault vault operator init

# 5. Save unseal keys and root token securely!

# 6. Unseal vault (requires 3 of 5 keys by default)
docker exec -it hris-vault vault operator unseal <key1>
docker exec -it hris-vault vault operator unseal <key2>
docker exec -it hris-vault vault operator unseal <key3>

# 7. Re-run init-vault.sh with root token
VAULT_TOKEN=<root-token> ./scripts/init-vault.sh
```

---

## API Reference

### Authentication

```http
POST /auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "accessToken": "eyJhbG...",
  "refreshToken": "eyJhbG...",
  "expiresIn": 86400
}
```

### File Operations

```http
# Upload file
POST /files
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <binary>
name: document.pdf

Response:
{
  "id": "uuid",
  "name": "document.pdf",
  "size": 1024,
  "mimeType": "application/pdf",
  "createdAt": "2024-01-01T00:00:00Z"
}

# Download file
GET /files/:id
Authorization: Bearer <token>

Response: <binary>

# Delete file
DELETE /files/:id
Authorization: Bearer <token>

Response:
{
  "success": true
}
```

---

## Troubleshooting

### Common Issues

#### Cannot connect to home server

```bash
# Check VPN connection
tailscale status
# or
wg show

# Test connectivity
ping <HOME_SERVER_HOST>
nc -zv <HOME_SERVER_HOST> 5432
nc -zv <HOME_SERVER_HOST> 8200
```

#### Vault is sealed

```bash
# Check vault status
docker exec -it hris-vault vault status

# Unseal (production mode)
docker exec -it hris-vault vault operator unseal <key>
```

#### Database connection refused

```bash
# Check postgres is running
docker compose -f docker-compose.server.yml ps postgres

# Check logs
docker compose -f docker-compose.server.yml logs postgres

# Test connection
psql "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${HOME_SERVER_HOST}:5432/${POSTGRES_DB}?sslmode=require"
```

#### Encryption service cannot authenticate to Vault

```bash
# Verify AppRole credentials
curl -X POST "${VAULT_ADDR}/v1/auth/approle/login" \
  -d "{\"role_id\":\"${VAULT_ROLE_ID}\",\"secret_id\":\"${VAULT_SECRET_ID}\"}"

# Check policy
docker exec -it hris-vault vault policy read encryption-service
```

### Logs

```bash
# All local services
docker compose -f docker-compose.local.yml logs -f

# Specific service
docker compose -f docker-compose.local.yml logs -f api-service

# Server services
docker compose -f docker-compose.server.yml logs -f
```

---

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

### Code Style

- **Node.js**: ESLint + Prettier
- **Python**: Black + isort + flake8
- **Commits**: Conventional Commits format

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [HashiCorp Vault](https://www.vaultproject.io/) - Secrets management
- [Fastify](https://www.fastify.io/) - Fast Node.js web framework
- [FastAPI](https://fastapi.tiangolo.com/) - Modern Python web framework
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [atmoz/sftp](https://github.com/atmoz/sftp) - Easy SFTP server

---

**Built with security in mind.**
