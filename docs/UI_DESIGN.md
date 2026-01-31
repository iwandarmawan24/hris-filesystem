# UI Design - App Client

> Simple web UI untuk secure file management system menggunakan React.

## Table of Contents

- [Overview](#overview)
- [UI Components](#ui-components)
- [Data Flow](#data-flow)
- [Security Model](#security-model)
- [Wireframes](#wireframes)
- [State Management](#state-management)
- [API Integration](#api-integration)

---

## Overview

### Design Principles

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         UI DESIGN PRINCIPLES                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. MINIMAL & FUNCTIONAL                                                    │
│     • No fancy design, focus on functionality                               │
│     • Clean table-based layout                                              │
│     • Standard form controls                                                │
│                                                                              │
│  2. ZERO-TRUST CLIENT                                                       │
│     • UI is untrusted                                                       │
│     • All validation on server                                              │
│     • No sensitive data in browser storage                                  │
│                                                                              │
│  3. API-ONLY COMMUNICATION                                                  │
│     • UI ↔ API Service only                                                 │
│     • No direct DB access                                                   │
│     • No direct Vault access                                                │
│     • No direct Storage access                                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | React 18 |
| Build Tool | Vite |
| Styling | TailwindCSS |
| HTTP Client | Axios / Fetch |
| State | React Context + useState |
| Routing | React Router v6 |

---

## UI Components

### Component Tree

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPONENT TREE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  App                                                                        │
│  ├── AuthProvider (Context)                                                 │
│  │   │                                                                      │
│  │   ├── LoginPage                                                          │
│  │   │   └── LoginForm                                                      │
│  │   │                                                                      │
│  │   └── ProtectedRoute                                                     │
│  │       └── MainLayout                                                     │
│  │           ├── Header                                                     │
│  │           │   ├── Logo                                                   │
│  │           │   └── UserMenu (logout)                                      │
│  │           │                                                              │
│  │           └── FilesPage                                                  │
│  │               ├── UploadSection                                          │
│  │               │   ├── UploadButton                                       │
│  │               │   └── UploadProgress                                     │
│  │               │                                                          │
│  │               ├── FilesTable                                             │
│  │               │   ├── TableHeader                                        │
│  │               │   └── FileRow (map)                                      │
│  │               │       ├── FileName                                       │
│  │               │       ├── FileSize                                       │
│  │               │       ├── FileDate                                       │
│  │               │       └── FileActions                                    │
│  │               │           ├── DownloadBtn                                │
│  │               │           ├── RenameBtn                                  │
│  │               │           └── DeleteBtn                                  │
│  │               │                                                          │
│  │               └── Modals                                                 │
│  │                   ├── RenameModal                                        │
│  │                   └── DeleteConfirmModal                                 │
│  │                                                                          │
│  └── ToastNotifications                                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Specifications

#### 1. LoginPage

```
┌─────────────────────────────────────────────────────────────────┐
│                         LOGIN PAGE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    ┌─────────────────────┐                      │
│                    │   HRIS File System  │                      │
│                    └─────────────────────┘                      │
│                                                                  │
│                    ┌─────────────────────┐                      │
│                    │ Email               │                      │
│                    │ [________________]  │                      │
│                    │                     │                      │
│                    │ Password            │                      │
│                    │ [________________]  │                      │
│                    │                     │                      │
│                    │ [     Login      ]  │                      │
│                    │                     │                      │
│                    │ {error message}     │                      │
│                    └─────────────────────┘                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Props: none
State: email, password, isLoading, error
Actions: handleLogin() → POST /auth/login
```

#### 2. FilesPage

```
┌─────────────────────────────────────────────────────────────────┐
│  HRIS File System                          [user@email] [Logout]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  My Files                              [ + Upload File ]        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Name              │ Size    │ Uploaded    │ Actions         ││
│  ├───────────────────┼─────────┼─────────────┼─────────────────┤│
│  │ 📄 report.xlsx    │ 245 KB  │ 2 hours ago │ ⬇️ ✏️ 🗑️        ││
│  │ 📄 photo.jpg      │ 1.2 MB  │ Yesterday   │ ⬇️ ✏️ 🗑️        ││
│  │ 📄 document.pdf   │ 500 KB  │ 3 days ago  │ ⬇️ ✏️ 🗑️        ││
│  │                   │         │             │                 ││
│  │              {empty state or loading}                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Showing 3 files                           < 1 2 3 >            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Props: none
State: files[], isLoading, error, selectedFile, modalType
Actions:
  - fetchFiles() → GET /files
  - uploadFile() → POST /files
  - downloadFile() → GET /files/:id
  - renameFile() → PATCH /files/:id
  - deleteFile() → DELETE /files/:id
```

#### 3. UploadSection

```
┌─────────────────────────────────────────────────────────────────┐
│                       UPLOAD SECTION                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DEFAULT STATE:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              [ + Upload File ]                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  UPLOADING STATE:                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Uploading: report.xlsx                                     ││
│  │  [████████████░░░░░░░░] 65%                                 ││
│  │                                            [Cancel]         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  DRAG & DROP:                                                   │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│
│  │              Drop file here to upload                       ││
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

Props: onUploadComplete
State: file, progress, isUploading, isDragging
Actions: handleFileSelect, handleDrop, handleUpload, handleCancel
```

#### 4. Modals

```
┌─────────────────────────────────────────────────────────────────┐
│                       RENAME MODAL                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Rename File                                          [X]   ││
│  │                                                             ││
│  │  Current: report.xlsx                                       ││
│  │                                                             ││
│  │  New name:                                                  ││
│  │  [report-2024.xlsx___________________________]              ││
│  │                                                             ││
│  │                          [Cancel]  [Rename]                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                     DELETE CONFIRM MODAL                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Delete File                                          [X]   ││
│  │                                                             ││
│  │  Are you sure you want to delete "report.xlsx"?             ││
│  │                                                             ││
│  │  This action cannot be undone.                              ││
│  │                                                             ││
│  │                          [Cancel]  [Delete]                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐      ┌──────────────┐      ┌──────────────┐                  │
│  │  Login   │      │  API Service │      │  PostgreSQL  │                  │
│  │   Form   │      │              │      │              │                  │
│  └────┬─────┘      └──────┬───────┘      └──────┬───────┘                  │
│       │                   │                     │                           │
│       │ POST /auth/login  │                     │                           │
│       │ {email, password} │                     │                           │
│       │──────────────────►│                     │                           │
│       │                   │                     │                           │
│       │                   │ SELECT user WHERE   │                           │
│       │                   │ email = ?           │                           │
│       │                   │────────────────────►│                           │
│       │                   │                     │                           │
│       │                   │ user record         │                           │
│       │                   │◄────────────────────│                           │
│       │                   │                     │                           │
│       │                   │ Verify bcrypt hash  │                           │
│       │                   │ Generate JWT        │                           │
│       │                   │                     │                           │
│       │ {accessToken,     │                     │                           │
│       │  refreshToken}    │                     │                           │
│       │◄──────────────────│                     │                           │
│       │                   │                     │                           │
│       │ Store tokens in   │                     │                           │
│       │ memory (not       │                     │                           │
│       │ localStorage)     │                     │                           │
│       │                   │                     │                           │
│       │ Redirect to /files│                     │                           │
│       │                   │                     │                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Upload Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FILE UPLOAD FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐   ┌───────────┐   ┌───────────┐   ┌───────┐   ┌───────────┐ │
│  │    UI    │   │    API    │   │ Encryption│   │ Vault │   │  Storage  │ │
│  └────┬─────┘   └─────┬─────┘   └─────┬─────┘   └───┬───┘   └─────┬─────┘ │
│       │               │               │             │             │        │
│       │ POST /files   │               │             │             │        │
│       │ multipart     │               │             │             │        │
│       │──────────────►│               │             │             │        │
│       │               │               │             │             │        │
│       │               │ POST /encrypt │             │             │        │
│       │               │──────────────►│             │             │        │
│       │               │               │             │             │        │
│       │               │               │ Get DEK     │             │        │
│       │               │               │────────────►│             │        │
│       │               │               │             │             │        │
│       │               │               │ DEK         │             │        │
│       │               │               │◄────────────│             │        │
│       │               │               │             │             │        │
│       │               │               │ Encrypt     │             │        │
│       │               │               │ file        │             │        │
│       │               │               │             │             │        │
│       │               │ encrypted     │             │             │        │
│       │               │ blob + DEK    │             │             │        │
│       │               │◄──────────────│             │             │        │
│       │               │               │             │             │        │
│       │               │ PUT /files    │             │             │        │
│       │               │───────────────────────────────────────────►        │
│       │               │               │             │             │        │
│       │               │ Save metadata │             │             │        │
│       │               │ to PostgreSQL │             │             │        │
│       │               │               │             │             │        │
│       │ {id, name,    │               │             │             │        │
│       │  size, date}  │               │             │             │        │
│       │◄──────────────│               │             │             │        │
│       │               │               │             │             │        │
│       │ Update table  │               │             │             │        │
│       │               │               │             │             │        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### File Download Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FILE DOWNLOAD FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐   ┌───────────┐   ┌───────────┐   ┌───────┐   ┌───────────┐ │
│  │    UI    │   │    API    │   │ Encryption│   │ Vault │   │  Storage  │ │
│  └────┬─────┘   └─────┬─────┘   └─────┬─────┘   └───┬───┘   └─────┬─────┘ │
│       │               │               │             │             │        │
│       │ GET /files/id │               │             │             │        │
│       │──────────────►│               │             │             │        │
│       │               │               │             │             │        │
│       │               │ Check access  │             │             │        │
│       │               │ (owner or     │             │             │        │
│       │               │ permission)   │             │             │        │
│       │               │               │             │             │        │
│       │               │ GET metadata  │             │             │        │
│       │               │ from DB       │             │             │        │
│       │               │               │             │             │        │
│       │               │ GET /files/uuid              │             │        │
│       │               │◄──────────────────────────────────────────│        │
│       │               │               │             │             │        │
│       │               │ POST /decrypt │             │             │        │
│       │               │──────────────►│             │             │        │
│       │               │               │             │             │        │
│       │               │               │ Decrypt DEK │             │        │
│       │               │               │────────────►│             │        │
│       │               │               │◄────────────│             │        │
│       │               │               │             │             │        │
│       │               │               │ Decrypt     │             │        │
│       │               │               │ file        │             │        │
│       │               │               │             │             │        │
│       │               │ decrypted     │             │             │        │
│       │               │ stream        │             │             │        │
│       │               │◄──────────────│             │             │        │
│       │               │               │             │             │        │
│       │ File blob +   │               │             │             │        │
│       │ original name │               │             │             │        │
│       │◄──────────────│               │             │             │        │
│       │               │               │             │             │        │
│       │ Trigger       │               │             │             │        │
│       │ browser       │               │             │             │        │
│       │ download      │               │             │             │        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Security Model

### Why UI is Untrusted

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      UI SECURITY MODEL                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  THE UI IS UNTRUSTED BECAUSE:                                               │
│  ═══════════════════════════                                                │
│                                                                              │
│  1. RUNS IN USER'S BROWSER                                                  │
│     • User can modify JavaScript                                            │
│     • User can inspect network requests                                     │
│     • User can forge requests with DevTools                                 │
│                                                                              │
│  2. ALL VALIDATION MUST BE SERVER-SIDE                                      │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │  Client validation = UX convenience                          │        │
│     │  Server validation = ACTUAL security                         │        │
│     └─────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  3. UI HAS NO DIRECT ACCESS TO:                                             │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │  ✗ PostgreSQL (metadata)                                     │        │
│     │  ✗ Vault (encryption keys)                                   │        │
│     │  ✗ SFTP Storage (encrypted files)                            │        │
│     │  ✗ Encryption Service                                        │        │
│     │                                                               │        │
│     │  ✓ API Service ONLY (via HTTPS)                              │        │
│     └─────────────────────────────────────────────────────────────┘        │
│                                                                              │
│  4. TOKEN STORAGE                                                           │
│     ┌─────────────────────────────────────────────────────────────┐        │
│     │  ✗ localStorage (vulnerable to XSS)                          │        │
│     │  ✗ sessionStorage (vulnerable to XSS)                        │        │
│     │  ✓ Memory only (lost on refresh, but secure)                 │        │
│     │  ✓ httpOnly cookie (if using cookie auth)                    │        │
│     └─────────────────────────────────────────────────────────────┘        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Security Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SECURITY BOUNDARIES                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        UNTRUSTED ZONE                                │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │                      User's Browser                          │   │   │
│  │  │                                                              │   │   │
│  │  │  ┌────────────────────────────────────────────────────────┐ │   │   │
│  │  │  │                    React App                            │ │   │   │
│  │  │  │                                                         │ │   │   │
│  │  │  │  • Display files                                        │ │   │   │
│  │  │  │  • Upload form                                          │ │   │   │
│  │  │  │  • Download trigger                                     │ │   │   │
│  │  │  │  • JWT token (memory)                                   │ │   │   │
│  │  │  │                                                         │ │   │   │
│  │  │  └────────────────────────────────────────────────────────┘ │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      │ HTTPS + JWT                           │
│                                      ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        TRUSTED ZONE                                  │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────┐  ┌─────────────┐   │   │
│  │  │ API Service │  │ Encryption  │  │  Vault  │  │   Storage   │   │   │
│  │  │             │  │  Service    │  │         │  │   (SFTP)    │   │   │
│  │  │ • Auth      │  │             │  │ • Keys  │  │             │   │   │
│  │  │ • Authz     │  │ • Encrypt   │  │ • DEKs  │  │ • Blobs     │   │   │
│  │  │ • Business  │  │ • Decrypt   │  │         │  │             │   │   │
│  │  │   logic     │  │             │  │         │  │             │   │   │
│  │  └─────────────┘  └─────────────┘  └─────────┘  └─────────────┘   │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │                      PostgreSQL                              │   │   │
│  │  │                      (Metadata)                              │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### What UI Can See

| Data | UI Access | Notes |
|------|-----------|-------|
| File list (metadata) | ✅ Via API | Name, size, date |
| File content | ✅ Via download | Decrypted by backend |
| Encryption keys | ❌ Never | Handled by backend |
| Other users' files | ❌ Never | API enforces access |
| Database directly | ❌ Never | API is gateway |
| Storage directly | ❌ Never | API is gateway |

---

## Wireframes

### Login Page

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                                                                  │
│                                                                  │
│                    ╔═══════════════════════╗                    │
│                    ║   HRIS File System    ║                    │
│                    ╚═══════════════════════╝                    │
│                                                                  │
│                    ┌───────────────────────┐                    │
│                    │                       │                    │
│                    │  Email                │                    │
│                    │  ┌─────────────────┐  │                    │
│                    │  │                 │  │                    │
│                    │  └─────────────────┘  │                    │
│                    │                       │                    │
│                    │  Password             │                    │
│                    │  ┌─────────────────┐  │                    │
│                    │  │ ●●●●●●●●        │  │                    │
│                    │  └─────────────────┘  │                    │
│                    │                       │                    │
│                    │  ┌─────────────────┐  │                    │
│                    │  │     Login       │  │                    │
│                    │  └─────────────────┘  │                    │
│                    │                       │                    │
│                    └───────────────────────┘                    │
│                                                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Files Page

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ HRIS File System              admin@hris.local    [Logout]  │ │
│ └─────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  My Files                                    [  + Upload  ]     │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ □  Name                    Size      Uploaded     Actions   ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ □  📄 annual-report.xlsx   2.4 MB    2 hours ago   ⬇ ✏ 🗑   ││
│  │ □  📄 profile-photo.jpg    856 KB    Yesterday     ⬇ ✏ 🗑   ││
│  │ □  📄 contract.pdf         1.1 MB    3 days ago    ⬇ ✏ 🗑   ││
│  │ □  📄 notes.txt            12 KB     Last week     ⬇ ✏ 🗑   ││
│  │                                                             ││
│  │                                                             ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Showing 4 of 4 files                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Upload Progress

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │   📄 large-file.zip                                         ││
│  │                                                             ││
│  │   ████████████████░░░░░░░░░░░░░░  45%                       ││
│  │                                                             ││
│  │   Uploading... 12.5 MB of 28 MB                             ││
│  │                                                             ││
│  │                                          [ Cancel ]         ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Management

### Auth Context

```typescript
interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
}
```

### Files State

```typescript
interface FilesState {
  files: FileMetadata[];
  isLoading: boolean;
  error: string | null;
  uploadProgress: number | null;
  selectedFile: FileMetadata | null;
  modalType: 'rename' | 'delete' | null;
}

interface FileMetadata {
  id: string;
  originalName: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## API Integration

### API Client

```typescript
// src/api/client.ts

const API_URL = import.meta.env.VITE_API_URL;

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const api = {
  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: HeadersInit = {
      ...options.headers,
    };

    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(response.statusText);
    }

    return response.json();
  },

  // Auth
  login: (email: string, password: string) =>
    api.request<AuthResponse>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),

  // Files
  getFiles: () => api.request<FileMetadata[]>('/files'),

  uploadFile: (file: File, onProgress?: (progress: number) => void) => {
    // Use XMLHttpRequest for progress tracking
  },

  downloadFile: (id: string) =>
    api.request<Blob>(`/files/${id}`, {
      headers: { Accept: 'application/octet-stream' },
    }),

  renameFile: (id: string, newName: string) =>
    api.request<FileMetadata>(`/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalName: newName }),
    }),

  deleteFile: (id: string) =>
    api.request<void>(`/files/${id}`, { method: 'DELETE' }),
};
```

### API Endpoints Used

| Action | Method | Endpoint | Body |
|--------|--------|----------|------|
| Login | POST | `/auth/login` | `{email, password}` |
| Logout | POST | `/auth/logout` | - |
| List files | GET | `/files` | - |
| Upload | POST | `/files` | `multipart/form-data` |
| Download | GET | `/files/:id` | - |
| Rename | PATCH | `/files/:id` | `{originalName}` |
| Delete | DELETE | `/files/:id` | - |

---

## Related Files

- `services/app-client/` - React application code
- `services/api-service/` - Backend API
- `docs/DATABASE_SCHEMA.md` - File metadata schema
