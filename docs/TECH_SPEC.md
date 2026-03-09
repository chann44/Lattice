# Agent Source Control System (Agent-SCM)
## Technical Specification v1.0

> Note: Active implementation stack has moved to Bun/TypeScript. See `docs/TECH_SPEC_BUN.md` for the current executable spec.

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Data Models](#data-models)
4. [API Specification](#api-specification)
5. [Core Algorithms](#core-algorithms)
6. [Security & Authentication](#security--authentication)
7. [Storage Layer](#storage-layer)
8. [Network Protocol](#network-protocol)
9. [Testing Strategy](#testing-strategy)
10. [Deployment](#deployment)

---

## 1. System Overview

### 1.1 Purpose
A source control system designed for autonomous AI agents that have no persistent filesystem between executions. The system handles version control entirely server-side while agents remain stateless.

### 1.2 Key Requirements
- **Stateless Agent Design**: Agents send complete project snapshots, no local git
- **Autonomous Identity**: Agents self-identify using cryptographic keys
- **Smart Versioning**: Automatic semantic versioning based on code analysis
- **Auto-Branching**: Risky changes trigger experimental branches
- **Multi-Tenant**: Each agent has isolated namespace
- **Content-Addressed Storage**: Efficient deduplication like Git internals

### 1.3 Non-Goals
- Git protocol compatibility (custom protocol optimized for agents)
- Human-friendly UI (API-first design)
- Merge conflict resolution (auto-merge or experimental branch)

---

## 2. Architecture

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Layer                             │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Agent SDK (Python/Node/Go)                        │     │
│  │  - Identity management                             │     │
│  │  - Request signing                                 │     │
│  │  - Automatic retry/backoff                         │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   API Gateway Layer                          │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐      │
│  │ Rate       │  │ Auth       │  │ Request          │      │
│  │ Limiting   │  │ Middleware │  │ Validation       │      │
│  └────────────┘  └────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Business Logic Layer                       │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐      │
│  │ Agent      │  │ Repository │  │ Version          │      │
│  │ Manager    │  │ Manager    │  │ Engine           │      │
│  └────────────┘  └────────────┘  └──────────────────┘      │
│                                                               │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────┐      │
│  │ Diff       │  │ Commit     │  │ Branch           │      │
│  │ Engine     │  │ Manager    │  │ Manager          │      │
│  └────────────┘  └────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                             │
│  ┌─────────────────┐              ┌──────────────────┐      │
│  │  SQLite         │              │  Filesystem      │      │
│  │  (Metadata)     │              │  (Content)       │      │
│  │                 │              │                  │      │
│  │  - Agents       │              │  - Blobs         │      │
│  │  - Repos        │              │  - Trees         │      │
│  │  - Commits      │              │  - Compressed    │      │
│  │  - Branches     │              │                  │      │
│  └─────────────────┘              └──────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

**Server:**
- Language: Go 1.21+
- Database: SQLite 3.45+ (with WAL mode)
- Storage: Local filesystem (S3-compatible for production)
- Web Framework: net/http (stdlib) or gin-gonic/gin
- Crypto: crypto/ed25519 for signatures

**Client SDK:**
- Python 3.9+ (requests, cryptography)
- Node.js 18+ (axios, tweetnacl)
- Go 1.21+ (net/http, crypto/ed25519)

---

## 3. Data Models

### 3.1 Database Schema

```sql
-- Agent identity and authentication
CREATE TABLE agents (
    id TEXT PRIMARY KEY,                    -- agent-{12 hex chars}
    public_key TEXT UNIQUE NOT NULL,        -- Ed25519 public key (hex)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP,
    metadata JSON                           -- {name, version, runtime}
);

-- Repositories (namespaced by agent)
CREATE TABLE repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,                     -- repo name (alphanumeric + - _)
    description TEXT,
    default_branch TEXT DEFAULT 'main',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
    UNIQUE(agent_id, name)
);

-- Branches within repositories
CREATE TABLE branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    head_commit TEXT,                       -- Current commit hash
    is_experimental BOOLEAN DEFAULT 0,
    experiment_reason TEXT,                 -- Why auto-branched
    parent_branch TEXT,                     -- For experimental branches
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, name)
);

-- Commits (immutable)
CREATE TABLE commits (
    hash TEXT PRIMARY KEY,                  -- SHA256 of commit content
    repo_id INTEGER NOT NULL,
    branch TEXT NOT NULL,
    parent_hash TEXT,                       -- Previous commit (null for first)
    tree_hash TEXT NOT NULL,                -- Points to tree object
    version TEXT NOT NULL,                  -- Semantic version (v1.2.3)
    message TEXT NOT NULL,                  -- Auto-generated or provided
    author_agent_id TEXT NOT NULL,          -- Which agent created this
    commit_type TEXT NOT NULL,              -- MAJOR|MINOR|PATCH|EXPERIMENTAL
    metadata JSON,                          -- {files_changed, lines_added, etc}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    FOREIGN KEY (author_agent_id) REFERENCES agents(id)
);

-- Tree objects (directory snapshots)
CREATE TABLE trees (
    hash TEXT PRIMARY KEY,                  -- SHA256 of tree content
    content JSON NOT NULL,                  -- [{path, hash, mode}]
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blob objects (file contents)
CREATE TABLE blobs (
    hash TEXT PRIMARY KEY,                  -- SHA256 of content
    size INTEGER NOT NULL,
    compressed BOOLEAN DEFAULT 1,           -- gzip compressed?
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ref_count INTEGER DEFAULT 1             -- For garbage collection
);

-- Indexes for performance
CREATE INDEX idx_commits_repo_branch ON commits(repo_id, branch);
CREATE INDEX idx_commits_repo_created ON commits(repo_id, created_at DESC);
CREATE INDEX idx_branches_repo ON branches(repo_id);
CREATE INDEX idx_repos_agent ON repos(agent_id);
CREATE INDEX idx_blobs_hash ON blobs(hash);
CREATE INDEX idx_trees_hash ON trees(hash);
```

### 3.2 Go Structs

```go
package main

import "time"

type Agent struct {
    ID        string                 `json:"id" db:"id"`
    PublicKey string                 `json:"public_key" db:"public_key"`
    CreatedAt time.Time              `json:"created_at" db:"created_at"`
    LastSeen  time.Time              `json:"last_seen" db:"last_seen"`
    Metadata  map[string]interface{} `json:"metadata" db:"metadata"`
}

type Repo struct {
    ID            int       `json:"id" db:"id"`
    AgentID       string    `json:"agent_id" db:"agent_id"`
    Name          string    `json:"name" db:"name"`
    Description   string    `json:"description" db:"description"`
    DefaultBranch string    `json:"default_branch" db:"default_branch"`
    CreatedAt     time.Time `json:"created_at" db:"created_at"`
    UpdatedAt     time.Time `json:"updated_at" db:"updated_at"`
}

type Branch struct {
    ID               int       `json:"id" db:"id"`
    RepoID           int       `json:"repo_id" db:"repo_id"`
    Name             string    `json:"name" db:"name"`
    HeadCommit       string    `json:"head_commit" db:"head_commit"`
    IsExperimental   bool      `json:"is_experimental" db:"is_experimental"`
    ExperimentReason string    `json:"experiment_reason,omitempty" db:"experiment_reason"`
    ParentBranch     string    `json:"parent_branch,omitempty" db:"parent_branch"`
    CreatedAt        time.Time `json:"created_at" db:"created_at"`
    UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

type Commit struct {
    Hash          string                 `json:"hash" db:"hash"`
    RepoID        int                    `json:"repo_id" db:"repo_id"`
    Branch        string                 `json:"branch" db:"branch"`
    ParentHash    string                 `json:"parent_hash,omitempty" db:"parent_hash"`
    TreeHash      string                 `json:"tree_hash" db:"tree_hash"`
    Version       string                 `json:"version" db:"version"`
    Message       string                 `json:"message" db:"message"`
    AuthorAgentID string                 `json:"author_agent_id" db:"author_agent_id"`
    CommitType    string                 `json:"commit_type" db:"commit_type"`
    Metadata      map[string]interface{} `json:"metadata,omitempty" db:"metadata"`
    CreatedAt     time.Time              `json:"created_at" db:"created_at"`
}

type Tree struct {
    Hash      string      `json:"hash" db:"hash"`
    Entries   []FileEntry `json:"entries"`
    CreatedAt time.Time   `json:"created_at" db:"created_at"`
}

type FileEntry struct {
    Path string `json:"path"`
    Hash string `json:"hash"`
    Mode string `json:"mode"` // "file" or "executable"
}

type Blob struct {
    Hash       string    `json:"hash" db:"hash"`
    Size       int64     `json:"size" db:"size"`
    Compressed bool      `json:"compressed" db:"compressed"`
    CreatedAt  time.Time `json:"created_at" db:"created_at"`
    RefCount   int       `json:"ref_count" db:"ref_count"`
}
```

---

## 4. API Specification

### 4.1 Authentication

All requests (except `/register`) require authentication via signature:

```
Authorization: Agent {agent_id}:{timestamp}:{signature}
```

Where:
- `agent_id`: The agent's unique identifier
- `timestamp`: Unix timestamp in seconds
- `signature`: Ed25519 signature of `{agent_id}:{timestamp}:{request_body_sha256}`

### 4.2 Endpoints

#### 4.2.1 Agent Management

**POST /v1/register**
```json
Request:
{
  "public_key": "hex_encoded_ed25519_public_key",
  "metadata": {
    "name": "MyAgent",
    "version": "1.0.0",
    "runtime": "openai-gpt4"
  }
}

Response: 201 Created
{
  "agent_id": "agent-a3f8d92bc1e4",
  "public_key": "...",
  "created_at": "2026-03-09T10:00:00Z"
}

Errors:
400 - Invalid public key
409 - Public key already registered
```

**GET /v1/agent/me**
```json
Response: 200 OK
{
  "id": "agent-a3f8d92bc1e4",
  "public_key": "...",
  "created_at": "2026-03-09T10:00:00Z",
  "last_seen": "2026-03-09T14:30:00Z",
  "metadata": {...}
}
```

#### 4.2.2 Repository Management

**POST /v1/repos**
```json
Request:
{
  "name": "my-project",
  "description": "AI-generated trading bot",
  "default_branch": "main"
}

Response: 201 Created
{
  "id": 123,
  "agent_id": "agent-a3f8d92bc1e4",
  "name": "my-project",
  "namespace": "agent-a3f8d92bc1e4/my-project",
  "default_branch": "main",
  "created_at": "2026-03-09T10:00:00Z"
}

Errors:
400 - Invalid repo name (must be alphanumeric + - _)
409 - Repo already exists
```

**GET /v1/repos**
```json
Query params: ?page=1&per_page=20

Response: 200 OK
{
  "repos": [
    {
      "id": 123,
      "name": "my-project",
      "namespace": "agent-a3f8d92bc1e4/my-project",
      "default_branch": "main",
      "created_at": "2026-03-09T10:00:00Z",
      "updated_at": "2026-03-09T14:30:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "per_page": 20
}
```

**GET /v1/repos/:id**
```json
Response: 200 OK
{
  "id": 123,
  "agent_id": "agent-a3f8d92bc1e4",
  "name": "my-project",
  "namespace": "agent-a3f8d92bc1e4/my-project",
  "default_branch": "main",
  "branches": ["main", "experiment-2026-03-09"],
  "created_at": "2026-03-09T10:00:00Z",
  "updated_at": "2026-03-09T14:30:00Z"
}

Errors:
404 - Repo not found
403 - Repo belongs to different agent
```

#### 4.2.3 Push Operations (Core Functionality)

**POST /v1/repos/:id/check-hashes**
```json
Request:
{
  "hashes": {
    "main.py": "a3f8d92bc1e4...",
    "config.json": "2bc1e4f8a3d9...",
    "README.md": "f8a3d92bc1e4..."
  }
}

Response: 200 OK
{
  "needed": ["main.py", "config.json"],
  "already_have": ["README.md"]
}
```

**POST /v1/repos/:id/push**
```json
Request:
{
  "branch": "main",
  "files": {
    "main.py": "def hello():\n    print('world')",
    "config.json": "{\"version\": \"1.0.0\"}",
    "README.md": "# My Project"
  },
  "message": "Optional custom commit message"
}

Response: 200 OK
{
  "commit": {
    "hash": "c1e4a3f8d92b...",
    "version": "v0.2.0",
    "message": "Add hello function, update config",
    "branch": "main",
    "commit_type": "MINOR",
    "created_at": "2026-03-09T14:30:00Z"
  },
  "changes": {
    "added": ["config.json"],
    "modified": ["main.py"],
    "deleted": [],
    "stats": {
      "files_changed": 2,
      "insertions": 15,
      "deletions": 3
    }
  },
  "previous_version": "v0.1.0"
}

Response: 201 Created (Experimental Branch)
{
  "commit": {
    "hash": "...",
    "version": "v1.0.0-exp",
    "message": "...",
    "branch": "experiment-2026-03-09-143045",
    "commit_type": "EXPERIMENTAL",
    "created_at": "2026-03-09T14:30:45Z"
  },
  "experimental": {
    "reason": "Breaking changes detected: function signature changed",
    "parent_branch": "main",
    "risk_score": 0.85,
    "can_auto_merge": false
  },
  "changes": {...}
}

Response: 200 OK (No Changes)
{
  "message": "No changes detected",
  "current_version": "v0.1.0",
  "head_commit": "a3f8d92bc1e4..."
}

Errors:
400 - Invalid files (empty, too large, invalid paths)
404 - Repo or branch not found
413 - Payload too large (>50MB)
```

#### 4.2.4 Commit History

**GET /v1/repos/:id/commits**
```json
Query params: ?branch=main&limit=50&offset=0

Response: 200 OK
{
  "commits": [
    {
      "hash": "c1e4a3f8d92b...",
      "version": "v0.2.0",
      "message": "Add hello function",
      "branch": "main",
      "commit_type": "MINOR",
      "parent_hash": "a3f8d92bc1e4...",
      "created_at": "2026-03-09T14:30:00Z",
      "stats": {
        "files_changed": 1,
        "insertions": 10,
        "deletions": 0
      }
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

**GET /v1/repos/:id/commits/:hash**
```json
Response: 200 OK
{
  "hash": "c1e4a3f8d92b...",
  "version": "v0.2.0",
  "message": "Add hello function",
  "branch": "main",
  "commit_type": "MINOR",
  "parent_hash": "a3f8d92bc1e4...",
  "tree_hash": "f8a3d92bc1e4...",
  "created_at": "2026-03-09T14:30:00Z",
  "files": [
    {
      "path": "main.py",
      "hash": "a3f8d92bc1e4...",
      "size": 1024,
      "mode": "file"
    }
  ]
}
```

#### 4.2.5 File Operations

**GET /v1/repos/:id/tree**
```json
Query params: ?commit=c1e4a3f8d92b&path=/

Response: 200 OK
{
  "commit": "c1e4a3f8d92b...",
  "path": "/",
  "entries": [
    {
      "path": "main.py",
      "hash": "a3f8d92bc1e4...",
      "size": 1024,
      "mode": "file"
    },
    {
      "path": "config.json",
      "hash": "2bc1e4f8a3d9...",
      "size": 256,
      "mode": "file"
    }
  ]
}
```

**GET /v1/repos/:id/blob/:hash**
```json
Response: 200 OK
Content-Type: application/octet-stream

<binary file contents>
```

#### 4.2.6 Branch Management

**GET /v1/repos/:id/branches**
```json
Response: 200 OK
{
  "branches": [
    {
      "name": "main",
      "head_commit": "c1e4a3f8d92b...",
      "is_experimental": false,
      "created_at": "2026-03-09T10:00:00Z",
      "updated_at": "2026-03-09T14:30:00Z"
    },
    {
      "name": "experiment-2026-03-09",
      "head_commit": "f8a3d92bc1e4...",
      "is_experimental": true,
      "experiment_reason": "Breaking changes detected",
      "parent_branch": "main",
      "created_at": "2026-03-09T14:30:45Z"
    }
  ]
}
```

**POST /v1/repos/:id/branches/:name/merge**
```json
Request:
{
  "target_branch": "main",
  "strategy": "auto"  // "auto" or "force"
}

Response: 200 OK
{
  "success": true,
  "merge_commit": "d92bc1e4a3f8...",
  "message": "Merged experiment-2026-03-09 into main"
}

Response: 409 Conflict
{
  "success": false,
  "error": "Cannot auto-merge: breaking changes detected",
  "conflicts": [...],
  "suggestion": "Review changes manually or use force strategy"
}
```

#### 4.2.7 Diff Operations

**GET /v1/repos/:id/diff**
```json
Query params: ?from=a3f8d92bc1e4&to=c1e4a3f8d92b

Response: 200 OK
{
  "from_commit": "a3f8d92bc1e4...",
  "to_commit": "c1e4a3f8d92b...",
  "files": [
    {
      "path": "main.py",
      "status": "modified",
      "additions": 10,
      "deletions": 2,
      "diff": "@@ -1,5 +1,8 @@\n def hello():\n-    pass\n+    print('world')\n"
    }
  ],
  "summary": {
    "files_changed": 1,
    "insertions": 10,
    "deletions": 2
  }
}
```

---

## 5. Core Algorithms

### 5.1 Content-Addressed Storage

```go
// Hash file content using SHA256
func HashContent(content []byte) string {
    hash := sha256.Sum256(content)
    return hex.EncodeToString(hash[:])
}

// Store blob with deduplication
func (s *Store) StoreBlob(content []byte) (string, error) {
    hash := HashContent(content)
    
    // Check if already exists
    exists, err := s.BlobExists(hash)
    if err != nil {
        return "", err
    }
    
    if exists {
        // Increment reference count
        s.IncrementBlobRefCount(hash)
        return hash, nil
    }
    
    // Compress content (gzip)
    compressed, err := CompressGzip(content)
    if err != nil {
        return "", err
    }
    
    // Write to filesystem
    blobPath := s.getBlobPath(hash)
    if err := os.WriteFile(blobPath, compressed, 0644); err != nil {
        return "", err
    }
    
    // Store metadata in DB
    _, err = s.db.Exec(`
        INSERT INTO blobs (hash, size, compressed, ref_count)
        VALUES (?, ?, ?, ?)
    `, hash, len(content), true, 1)
    
    return hash, err
}

// Blob storage path: /data/blobs/ab/cd/abcdef123456...
func (s *Store) getBlobPath(hash string) string {
    return filepath.Join(
        s.blobDir,
        hash[:2],
        hash[2:4],
        hash,
    )
}
```

### 5.2 Tree Creation

```go
type TreeEntry struct {
    Path string
    Hash string
    Mode string
}

func (s *Store) CreateTree(files map[string]string) (string, error) {
    // Sort entries for deterministic hashing
    var entries []TreeEntry
    for path, hash := range files {
        entries = append(entries, TreeEntry{
            Path: path,
            Hash: hash,
            Mode: "file",
        })
    }
    
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].Path < entries[j].Path
    })
    
    // Serialize and hash
    treeContent, _ := json.Marshal(entries)
    treeHash := HashContent(treeContent)
    
    // Check if tree already exists
    exists, _ := s.TreeExists(treeHash)
    if exists {
        return treeHash, nil
    }
    
    // Store tree
    _, err := s.db.Exec(`
        INSERT INTO trees (hash, content)
        VALUES (?, ?)
    `, treeHash, string(treeContent))
    
    return treeHash, err
}
```

### 5.3 Diff Computation

```go
type DiffResult struct {
    Added    []string
    Modified []string
    Deleted  []string
    Stats    map[string]FileDiff
}

type FileDiff struct {
    Path          string
    LinesAdded    int
    LinesRemoved  int
    OldHash       string
    NewHash       string
    IsBreaking    bool
}

func (s *Store) ComputeDiff(oldTree, newTree map[string]string) (*DiffResult, error) {
    result := &DiffResult{
        Stats: make(map[string]FileDiff),
    }
    
    // Find added and modified files
    for path, newHash := range newTree {
        oldHash, existed := oldTree[path]
        
        if !existed {
            result.Added = append(result.Added, path)
            result.Stats[path] = FileDiff{
                Path:       path,
                NewHash:    newHash,
                LinesAdded: s.countLines(newHash),
            }
        } else if oldHash != newHash {
            result.Modified = append(result.Modified, path)
            
            // Get actual file contents for line-level diff
            oldContent, _ := s.GetBlob(oldHash)
            newContent, _ := s.GetBlob(newHash)
            
            lineDiff := s.computeLineDiff(oldContent, newContent)
            result.Stats[path] = FileDiff{
                Path:         path,
                OldHash:      oldHash,
                NewHash:      newHash,
                LinesAdded:   lineDiff.Added,
                LinesRemoved: lineDiff.Removed,
                IsBreaking:   s.detectBreakingChange(path, oldContent, newContent),
            }
        }
    }
    
    // Find deleted files
    for path := range oldTree {
        if _, exists := newTree[path]; !exists {
            result.Deleted = append(result.Deleted, path)
            oldHash := oldTree[path]
            oldContent, _ := s.GetBlob(oldHash)
            result.Stats[path] = FileDiff{
                Path:         path,
                OldHash:      oldHash,
                LinesRemoved: s.countLines(oldHash),
            }
        }
    }
    
    return result, nil
}

// Simple line-based diff
func (s *Store) computeLineDiff(oldContent, newContent []byte) struct{ Added, Removed int } {
    oldLines := strings.Split(string(oldContent), "\n")
    newLines := strings.Split(string(newContent), "\n")
    
    // Use Myers diff algorithm (simplified)
    added := 0
    removed := 0
    
    // Create line hash maps
    oldMap := make(map[string]bool)
    newMap := make(map[string]bool)
    
    for _, line := range oldLines {
        oldMap[line] = true
    }
    for _, line := range newLines {
        newMap[line] = true
    }
    
    // Count additions
    for _, line := range newLines {
        if !oldMap[line] {
            added++
        }
    }
    
    // Count deletions
    for _, line := range oldLines {
        if !newMap[line] {
            removed++
        }
    }
    
    return struct{ Added, Removed int }{added, removed}
}
```

### 5.4 Semantic Versioning

```go
type VersionBump string

const (
    BumpMajor VersionBump = "MAJOR"
    BumpMinor VersionBump = "MINOR"
    BumpPatch VersionBump = "PATCH"
)

func (s *Store) DetermineVersionBump(diff *DiffResult) VersionBump {
    hasBreaking := false
    hasNewFeatures := false
    
    for _, stat := range diff.Stats {
        if stat.IsBreaking {
            hasBreaking = true
            break
        }
    }
    
    if hasBreaking {
        return BumpMajor
    }
    
    // New files or significant additions = new features
    if len(diff.Added) > 0 {
        hasNewFeatures = true
    }
    
    for _, stat := range diff.Stats {
        // More than 20 lines added in a file = feature
        if stat.LinesAdded > 20 {
            hasNewFeatures = true
            break
        }
    }
    
    if hasNewFeatures {
        return BumpMinor
    }
    
    return BumpPatch
}

func BumpVersion(currentVersion string, bump VersionBump) string {
    // Parse: v1.2.3 -> (1, 2, 3)
    version := strings.TrimPrefix(currentVersion, "v")
    parts := strings.Split(version, ".")
    
    major, _ := strconv.Atoi(parts[0])
    minor, _ := strconv.Atoi(parts[1])
    patch, _ := strconv.Atoi(parts[2])
    
    switch bump {
    case BumpMajor:
        major++
        minor = 0
        patch = 0
    case BumpMinor:
        minor++
        patch = 0
    case BumpPatch:
        patch++
    }
    
    return fmt.Sprintf("v%d.%d.%d", major, minor, patch)
}
```

### 5.5 Breaking Change Detection

```go
func (s *Store) detectBreakingChange(path string, oldContent, newContent []byte) bool {
    ext := filepath.Ext(path)
    
    switch ext {
    case ".py":
        return s.detectPythonBreaking(oldContent, newContent)
    case ".js", ".ts":
        return s.detectJSBreaking(oldContent, newContent)
    case ".go":
        return s.detectGoBreaking(oldContent, newContent)
    default:
        return false
    }
}

func (s *Store) detectPythonBreaking(oldContent, newContent []byte) bool {
    // Regex patterns for function/class signatures
    funcPattern := regexp.MustCompile(`def\s+(\w+)\s*\((.*?)\)`)
    classPattern := regexp.MustCompile(`class\s+(\w+)`)
    
    oldFuncs := extractSignatures(string(oldContent), funcPattern)
    newFuncs := extractSignatures(string(newContent), funcPattern)
    
    // Check if any function signature changed
    for name, oldSig := range oldFuncs {
        if newSig, exists := newFuncs[name]; exists {
            if oldSig != newSig {
                return true // Signature changed
            }
        } else {
            return true // Function removed
        }
    }
    
    // Check if any public class removed
    oldClasses := extractNames(string(oldContent), classPattern)
    newClasses := extractNames(string(newContent), classPattern)
    
    for _, className := range oldClasses {
        if !strings.HasPrefix(className, "_") { // Public class
            if !contains(newClasses, className) {
                return true // Public class removed
            }
        }
    }
    
    return false
}

func extractSignatures(content string, pattern *regexp.Regexp) map[string]string {
    signatures := make(map[string]string)
    matches := pattern.FindAllStringSubmatch(content, -1)
    
    for _, match := range matches {
        if len(match) >= 3 {
            name := match[1]
            params := match[2]
            signatures[name] = params
        }
    }
    
    return signatures
}
```

### 5.6 Auto-Branching Decision

```go
type ExperimentalDecision struct {
    ShouldBranch bool
    Reason       string
    RiskScore    float64
}

func (s *Store) ShouldCreateExperimentalBranch(diff *DiffResult) *ExperimentalDecision {
    riskScore := 0.0
    reasons := []string{}
    
    // Breaking changes = high risk
    for path, stat := range diff.Stats {
        if stat.IsBreaking {
            riskScore += 0.5
            reasons = append(reasons, fmt.Sprintf("Breaking change in %s", path))
        }
    }
    
    // Large deletions = moderate risk
    totalDeleted := 0
    for _, stat := range diff.Stats {
        totalDeleted += stat.LinesRemoved
    }
    if totalDeleted > 100 {
        riskScore += 0.3
        reasons = append(reasons, fmt.Sprintf("Large deletion: %d lines", totalDeleted))
    }
    
    // Deleting files = moderate risk
    if len(diff.Deleted) > 0 {
        riskScore += 0.2
        reasons = append(reasons, fmt.Sprintf("Deleted %d files", len(diff.Deleted)))
    }
    
    // Major version bump = auto-branch
    if riskScore >= 0.5 {
        return &ExperimentalDecision{
            ShouldBranch: true,
            Reason:       strings.Join(reasons, "; "),
            RiskScore:    riskScore,
        }
    }
    
    return &ExperimentalDecision{
        ShouldBranch: false,
        RiskScore:    riskScore,
    }
}
```

### 5.7 Commit Message Generation

```go
func GenerateCommitMessage(diff *DiffResult) string {
    parts := []string{}
    
    if len(diff.Added) > 0 {
        if len(diff.Added) == 1 {
            parts = append(parts, fmt.Sprintf("Add %s", filepath.Base(diff.Added[0])))
        } else {
            parts = append(parts, fmt.Sprintf("Add %d files", len(diff.Added)))
        }
    }
    
    if len(diff.Modified) > 0 {
        if len(diff.Modified) == 1 {
            parts = append(parts, fmt.Sprintf("Update %s", filepath.Base(diff.Modified[0])))
        } else {
            parts = append(parts, fmt.Sprintf("Update %d files", len(diff.Modified)))
        }
    }
    
    if len(diff.Deleted) > 0 {
        if len(diff.Deleted) == 1 {
            parts = append(parts, fmt.Sprintf("Remove %s", filepath.Base(diff.Deleted[0])))
        } else {
            parts = append(parts, fmt.Sprintf("Remove %d files", len(diff.Deleted)))
        }
    }
    
    if len(parts) == 0 {
        return "Update project"
    }
    
    return strings.Join(parts, ", ")
}
```

---

## 6. Security & Authentication

### 6.1 Agent Identity

```go
import (
    "crypto/ed25519"
    "encoding/hex"
)

// Generate agent identity
func GenerateAgentIdentity() (*AgentIdentity, error) {
    pubKey, privKey, err := ed25519.GenerateKey(nil)
    if err != nil {
        return nil, err
    }
    
    // Agent ID = "agent-" + first 12 chars of pubkey hash
    pubKeyHash := sha256.Sum256(pubKey)
    agentID := "agent-" + hex.EncodeToString(pubKeyHash[:])[:12]
    
    return &AgentIdentity{
        AgentID:    agentID,
        PublicKey:  hex.EncodeToString(pubKey),
        PrivateKey: hex.EncodeToString(privKey),
    }, nil
}

type AgentIdentity struct {
    AgentID    string `json:"agent_id"`
    PublicKey  string `json:"public_key"`
    PrivateKey string `json:"private_key"`
}
```

### 6.2 Request Signing

```go
// Client side: Sign request
func SignRequest(agentID string, privKey ed25519.PrivateKey, body []byte) string {
    timestamp := time.Now().Unix()
    
    // Message to sign: agentID:timestamp:body_hash
    bodyHash := sha256.Sum256(body)
    message := fmt.Sprintf("%s:%d:%s", 
        agentID, 
        timestamp, 
        hex.EncodeToString(bodyHash[:]))
    
    signature := ed25519.Sign(privKey, []byte(message))
    
    return fmt.Sprintf("%s:%d:%s", 
        agentID, 
        timestamp, 
        hex.EncodeToString(signature))
}

// Server side: Verify signature
func (s *Server) VerifyRequest(authHeader string, body []byte) (*Agent, error) {
    // Parse: "agent-abc123:1234567890:signature_hex"
    parts := strings.Split(authHeader, ":")
    if len(parts) != 3 {
        return nil, fmt.Errorf("invalid auth header")
    }
    
    agentID := parts[0]
    timestamp, _ := strconv.ParseInt(parts[1], 10, 64)
    signatureHex := parts[2]
    
    // Check timestamp (prevent replay attacks)
    now := time.Now().Unix()
    if abs(now - timestamp) > 300 { // 5 minute window
        return nil, fmt.Errorf("request expired")
    }
    
    // Get agent's public key
    agent, err := s.store.GetAgent(agentID)
    if err != nil {
        return nil, fmt.Errorf("agent not found")
    }
    
    pubKeyBytes, _ := hex.DecodeString(agent.PublicKey)
    pubKey := ed25519.PublicKey(pubKeyBytes)
    
    // Reconstruct message
    bodyHash := sha256.Sum256(body)
    message := fmt.Sprintf("%s:%d:%s", 
        agentID, 
        timestamp, 
        hex.EncodeToString(bodyHash[:]))
    
    // Verify signature
    signatureBytes, _ := hex.DecodeString(signatureHex)
    if !ed25519.Verify(pubKey, []byte(message), signatureBytes) {
        return nil, fmt.Errorf("invalid signature")
    }
    
    // Update last seen
    s.store.UpdateAgentLastSeen(agentID)
    
    return agent, nil
}
```

### 6.3 Rate Limiting

```go
type RateLimiter struct {
    requests map[string][]time.Time
    mu       sync.Mutex
    limit    int           // requests per window
    window   time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
    return &RateLimiter{
        requests: make(map[string][]time.Time),
        limit:    limit,
        window:   window,
    }
}

func (rl *RateLimiter) Allow(agentID string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()
    
    now := time.Now()
    cutoff := now.Add(-rl.window)
    
    // Clean old requests
    timestamps := rl.requests[agentID]
    valid := []time.Time{}
    for _, t := range timestamps {
        if t.After(cutoff) {
            valid = append(valid, t)
        }
    }
    
    // Check limit
    if len(valid) >= rl.limit {
        return false
    }
    
    // Add current request
    valid = append(valid, now)
    rl.requests[agentID] = valid
    
    return true
}
```

---

## 7. Storage Layer

### 7.1 Directory Structure

```
/data/
├── agent-scm.db          # SQLite database
├── blobs/                # Content-addressed blobs
│   ├── ab/
│   │   ├── cd/
│   │   │   └── abcdef1234... (gzipped file content)
│   │   └── ef/
│   └── 12/
├── config.json           # Server configuration
└── backups/              # Daily database backups
    └── agent-scm-2026-03-09.db
```

### 7.2 Blob Storage Implementation

```go
type BlobStore struct {
    baseDir string
}

func (bs *BlobStore) Write(hash string, content []byte) error {
    // Compress
    compressed := new(bytes.Buffer)
    gw := gzip.NewWriter(compressed)
    if _, err := gw.Write(content); err != nil {
        return err
    }
    gw.Close()
    
    // Create directory structure
    dir := filepath.Join(bs.baseDir, hash[:2], hash[2:4])
    if err := os.MkdirAll(dir, 0755); err != nil {
        return err
    }
    
    // Write file
    path := filepath.Join(dir, hash)
    return os.WriteFile(path, compressed.Bytes(), 0644)
}

func (bs *BlobStore) Read(hash string) ([]byte, error) {
    path := filepath.Join(bs.baseDir, hash[:2], hash[2:4], hash)
    
    compressed, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }
    
    // Decompress
    gr, err := gzip.NewReader(bytes.NewReader(compressed))
    if err != nil {
        return nil, err
    }
    defer gr.Close()
    
    return io.ReadAll(gr)
}

func (bs *BlobStore) Exists(hash string) bool {
    path := filepath.Join(bs.baseDir, hash[:2], hash[2:4], hash)
    _, err := os.Stat(path)
    return err == nil
}
```

### 7.3 Database Optimization

```sql
-- Enable WAL mode for better concurrency
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA temp_store = MEMORY;

-- Periodic maintenance
PRAGMA optimize;
VACUUM;
ANALYZE;
```

---

## 8. Network Protocol

### 8.1 Request Flow

```
┌─────────┐                                      ┌─────────┐
│  Agent  │                                      │ Server  │
└────┬────┘                                      └────┬────┘
     │                                                 │
     │  1. Generate request body (JSON)                │
     │  2. Sign: sign(agentID:ts:hash(body))          │
     │  3. HTTP POST with Authorization header         │
     ├────────────────────────────────────────────────▶│
     │                                                 │
     │                                    4. Verify signature
     │                                    5. Check rate limit
     │                                    6. Process request
     │                                    7. Update database
     │                                                 │
     │  8. JSON response                               │
     │◀────────────────────────────────────────────────┤
     │                                                 │
```

### 8.2 Error Handling

```go
type APIError struct {
    Code    int    `json:"code"`
    Message string `json:"message"`
    Details string `json:"details,omitempty"`
}

var (
    ErrUnauthorized     = &APIError{Code: 401, Message: "Unauthorized"}
    ErrForbidden        = &APIError{Code: 403, Message: "Forbidden"}
    ErrNotFound         = &APIError{Code: 404, Message: "Not found"}
    ErrConflict         = &APIError{Code: 409, Message: "Resource conflict"}
    ErrTooLarge         = &APIError{Code: 413, Message: "Payload too large"}
    ErrRateLimited      = &APIError{Code: 429, Message: "Rate limit exceeded"}
    ErrInternalServer   = &APIError{Code: 500, Message: "Internal server error"}
)

func WriteError(w http.ResponseWriter, err *APIError, details string) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(err.Code)
    json.NewEncoder(w).Encode(map[string]interface{}{
        "error": map[string]interface{}{
            "code":    err.Code,
            "message": err.Message,
            "details": details,
        },
    })
}
```

### 8.3 Response Caching

```go
// Server-side caching for expensive operations
type Cache struct {
    store map[string]CacheEntry
    mu    sync.RWMutex
    ttl   time.Duration
}

type CacheEntry struct {
    Data      interface{}
    ExpiresAt time.Time
}

func (c *Cache) Get(key string) (interface{}, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    
    entry, exists := c.store[key]
    if !exists || time.Now().After(entry.ExpiresAt) {
        return nil, false
    }
    
    return entry.Data, true
}

func (c *Cache) Set(key string, data interface{}) {
    c.mu.Lock()
    defer c.mu.Unlock()
    
    c.store[key] = CacheEntry{
        Data:      data,
        ExpiresAt: time.Now().Add(c.ttl),
    }
}

// Cache tree lookups (expensive)
func (s *Server) GetTreeCached(hash string) (*Tree, error) {
    cacheKey := "tree:" + hash
    
    if cached, ok := s.cache.Get(cacheKey); ok {
        return cached.(*Tree), nil
    }
    
    tree, err := s.store.GetTree(hash)
    if err != nil {
        return nil, err
    }
    
    s.cache.Set(cacheKey, tree)
    return tree, nil
}
```

---

## 9. Testing Strategy

### 9.1 Unit Tests

```go
// Test: Content hashing is deterministic
func TestHashContent(t *testing.T) {
    content := []byte("hello world")
    hash1 := HashContent(content)
    hash2 := HashContent(content)
    
    assert.Equal(t, hash1, hash2, "Hash should be deterministic")
    assert.Len(t, hash1, 64, "SHA256 hash should be 64 hex chars")
}

// Test: Blob deduplication
func TestBlobDeduplication(t *testing.T) {
    store := NewTestStore(t)
    content := []byte("test content")
    
    // Store same content twice
    hash1, _ := store.StoreBlob(content)
    hash2, _ := store.StoreBlob(content)
    
    assert.Equal(t, hash1, hash2)
    
    // Should only have one blob
    blob, _ := store.GetBlob(hash1)
    assert.Equal(t, content, blob)
}

// Test: Semantic versioning
func TestVersionBumping(t *testing.T) {
    tests := []struct {
        current string
        bump    VersionBump
        expected string
    }{
        {"v0.1.0", BumpPatch, "v0.1.1"},
        {"v0.1.0", BumpMinor, "v0.2.0"},
        {"v0.1.0", BumpMajor, "v1.0.0"},
        {"v1.2.3", BumpMinor, "v1.3.0"},
    }
    
    for _, tt := range tests {
        result := BumpVersion(tt.current, tt.bump)
        assert.Equal(t, tt.expected, result)
    }
}

// Test: Breaking change detection
func TestBreakingChangeDetection(t *testing.T) {
    oldCode := `
def hello(name):
    print(f"Hello {name}")
`
    
    newCode := `
def hello(name, greeting):
    print(f"{greeting} {name}")
`
    
    isBreaking := detectPythonBreaking(
        []byte(oldCode),
        []byte(newCode),
    )
    
    assert.True(t, isBreaking, "Signature change should be breaking")
}
```

### 9.2 Integration Tests

```go
// Test: Full push flow
func TestPushFlow(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    // 1. Register agent
    identity, err := client.Register()
    assert.NoError(t, err)
    
    // 2. Create repo
    repo, err := client.CreateRepo("test-project")
    assert.NoError(t, err)
    
    // 3. First push
    result1, err := client.Push(repo.ID, map[string]string{
        "main.py": "def hello(): pass",
    })
    assert.NoError(t, err)
    assert.Equal(t, "v0.1.0", result1.Commit.Version)
    
    // 4. Second push (modification)
    result2, err := client.Push(repo.ID, map[string]string{
        "main.py": "def hello(): print('hi')",
    })
    assert.NoError(t, err)
    assert.Equal(t, "v0.1.1", result2.Commit.Version)
    assert.Contains(t, result2.Changes.Modified, "main.py")
    
    // 5. Third push (no changes)
    result3, err := client.Push(repo.ID, map[string]string{
        "main.py": "def hello(): print('hi')",
    })
    assert.NoError(t, err)
    assert.Equal(t, "No changes detected", result3.Message)
}

// Test: Experimental branching
func TestExperimentalBranching(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    // Initial commit
    client.Push(repo.ID, map[string]string{
        "main.py": `
def calculate(x, y):
    return x + y
`,
    })
    
    // Breaking change (signature change)
    result, err := client.Push(repo.ID, map[string]string{
        "main.py": `
def calculate(x, y, z):
    return x + y + z
`,
    })
    
    assert.NoError(t, err)
    assert.True(t, result.Experimental != nil)
    assert.Contains(t, result.Commit.Branch, "experiment-")
    assert.Equal(t, "main", result.Experimental.ParentBranch)
}
```

### 9.3 Load Testing

```go
// Test: Concurrent pushes
func TestConcurrentPushes(t *testing.T) {
    server := NewTestServer(t)
    
    numAgents := 10
    pushesPerAgent := 20
    
    var wg sync.WaitGroup
    errors := make(chan error, numAgents * pushesPerAgent)
    
    for i := 0; i < numAgents; i++ {
        wg.Add(1)
        go func(agentNum int) {
            defer wg.Done()
            
            client := NewTestClient(server.URL)
            identity, _ := client.Register()
            repo, _ := client.CreateRepo(fmt.Sprintf("repo-%d", agentNum))
            
            for j := 0; j < pushesPerAgent; j++ {
                content := fmt.Sprintf("version %d", j)
                _, err := client.Push(repo.ID, map[string]string{
                    "file.txt": content,
                })
                
                if err != nil {
                    errors <- err
                }
            }
        }(i)
    }
    
    wg.Wait()
    close(errors)
    
    errorCount := 0
    for range errors {
        errorCount++
    }
    
    assert.Equal(t, 0, errorCount, "No errors in concurrent pushes")
}

// Benchmark: Blob storage throughput
func BenchmarkBlobStorage(b *testing.B) {
    store := NewBlobStore("/tmp/bench-blobs")
    content := make([]byte, 1024*1024) // 1MB
    rand.Read(content)
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        store.Write(fmt.Sprintf("blob-%d", i), content)
    }
}
```

### 9.4 End-to-End Tests

```python
# test_e2e.py
import requests
import hashlib
from agent_scm import AgentClient

def test_full_agent_lifecycle():
    # 1. Agent registers
    client = AgentClient("http://localhost:8080")
    identity = client.register()
    
    assert identity['agent_id'].startswith('agent-')
    
    # 2. Create repository
    repo = client.create_repo("my-project")
    assert repo['name'] == "my-project"
    
    # 3. Push initial code
    result = client.push(repo['id'], {
        "main.py": "def hello(): print('world')",
        "README.md": "# My Project"
    })
    
    assert result['commit']['version'] == "v0.1.0"
    assert len(result['changes']['added']) == 2
    
    # 4. Modify code
    result = client.push(repo['id'], {
        "main.py": "def hello(name): print(f'Hello {name}')",
        "README.md": "# My Project"
    })
    
    assert result['commit']['version'] == "v0.2.0"  # MINOR bump
    assert "main.py" in result['changes']['modified']
    
    # 5. Get commit history
    commits = client.get_commits(repo['id'])
    assert len(commits) == 2
    
    # 6. Retrieve file from first commit
    first_commit = commits[1]
    tree = client.get_tree(repo['id'], first_commit['hash'])
    assert any(e['path'] == 'main.py' for e in tree['entries'])
    
    print("✅ All tests passed!")

if __name__ == "__main__":
    test_full_agent_lifecycle()
```

### 9.5 Test Data Generators

```go
// Generate realistic test data
func GenerateTestRepo(numCommits int) *TestRepo {
    files := map[string]string{
        "main.py": "# Main file",
        "utils.py": "# Utils",
        "config.json": "{}",
    }
    
    commits := []Commit{}
    
    for i := 0; i < numCommits; i++ {
        // Randomly modify files
        if rand.Float64() > 0.5 {
            files["main.py"] += fmt.Sprintf("\n# Edit %d", i)
        }
        
        if rand.Float64() > 0.7 {
            files[fmt.Sprintf("new_file_%d.py", i)] = "# New file"
        }
        
        // Create commit
        commit := createCommit(files)
        commits = append(commits, commit)
    }
    
    return &TestRepo{Files: files, Commits: commits}
}
```

---

## 10. Deployment

### 10.1 Docker Deployment

```dockerfile
# Dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 go build -o agent-scm-server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates sqlite

WORKDIR /app
COPY --from=builder /app/agent-scm-server .
COPY schema.sql .

RUN mkdir -p /data/blobs

EXPOSE 8080
VOLUME ["/data"]

CMD ["./agent-scm-server", "--db=/data/agent-scm.db", "--blobs=/data/blobs"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  agent-scm:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
    environment:
      - LOG_LEVEL=info
      - RATE_LIMIT=100
      - MAX_BLOB_SIZE=52428800  # 50MB
    restart: unless-stopped
```

### 10.2 Configuration

```go
// config.go
type Config struct {
    Server struct {
        Port         int           `env:"PORT" default:"8080"`
        ReadTimeout  time.Duration `env:"READ_TIMEOUT" default:"30s"`
        WriteTimeout time.Duration `env:"WRITE_TIMEOUT" default:"30s"`
    }
    
    Database struct {
        Path string `env:"DB_PATH" default:"/data/agent-scm.db"`
    }
    
    Storage struct {
        BlobsDir    string `env:"BLOBS_DIR" default:"/data/blobs"`
        MaxBlobSize int64  `env:"MAX_BLOB_SIZE" default:"52428800"` // 50MB
    }
    
    RateLimit struct {
        RequestsPerMinute int `env:"RATE_LIMIT" default:"100"`
    }
    
    Security struct {
        MaxRequestAge int64 `env:"MAX_REQUEST_AGE" default:"300"` // 5 min
    }
}
```

### 10.3 Monitoring

```go
// Prometheus metrics
var (
    pushTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "agent_scm_push_total",
            Help: "Total number of pushes",
        },
        []string{"agent_id", "repo"},
    )
    
    commitDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "agent_scm_commit_duration_seconds",
            Help: "Time to process a commit",
        },
        []string{"repo"},
    )
    
    blobsStored = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "agent_scm_blobs_stored",
            Help: "Total number of blobs in storage",
        },
    )
)

func init() {
    prometheus.MustRegister(pushTotal)
    prometheus.MustRegister(commitDuration)
    prometheus.MustRegister(blobsStored)
}
```

### 10.4 Backup Strategy

```bash
#!/bin/bash
# backup.sh - Daily database backup

DATE=$(date +%Y-%m-%d)
BACKUP_DIR="/data/backups"
DB_PATH="/data/agent-scm.db"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup SQLite database
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/agent-scm-$DATE.db'"

# Compress
gzip "$BACKUP_DIR/agent-scm-$DATE.db"

# Keep last 30 days
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: agent-scm-$DATE.db.gz"
```

---

## 11. Client SDK Reference

### 11.1 Python SDK

```python
# agent_scm/client.py
import requests
import hashlib
import json
import os
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

class AgentClient:
    def __init__(self, endpoint, identity_file="~/.agent-scm/identity.json"):
        self.endpoint = endpoint.rstrip('/')
        self.identity_file = os.path.expanduser(identity_file)
        self.identity = self._load_or_create_identity()
    
    def _load_or_create_identity(self):
        if os.path.exists(self.identity_file):
            with open(self.identity_file, 'r') as f:
                data = json.load(f)
                return {
                    'agent_id': data['agent_id'],
                    'private_key': bytes.fromhex(data['private_key']),
                    'public_key': bytes.fromhex(data['public_key'])
                }
        else:
            return None
    
    def register(self, metadata=None):
        # Generate keypair
        private_key = ed25519.Ed25519PrivateKey.generate()
        public_key = private_key.public_key()
        
        pub_bytes = public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw
        )
        
        # Register with server
        response = requests.post(
            f"{self.endpoint}/v1/register",
            json={
                "public_key": pub_bytes.hex(),
                "metadata": metadata or {}
            }
        )
        response.raise_for_status()
        
        data = response.json()
        agent_id = data['agent_id']
        
        # Save identity
        priv_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption()
        )
        
        identity = {
            'agent_id': agent_id,
            'public_key': pub_bytes.hex(),
            'private_key': priv_bytes.hex()
        }
        
        os.makedirs(os.path.dirname(self.identity_file), exist_ok=True)
        with open(self.identity_file, 'w') as f:
            json.dump(identity, f, indent=2)
        
        self.identity = {
            'agent_id': agent_id,
            'private_key': priv_bytes,
            'public_key': pub_bytes
        }
        
        return data
    
    def _sign_request(self, body):
        import time
        timestamp = int(time.time())
        
        body_json = json.dumps(body, sort_keys=True)
        body_hash = hashlib.sha256(body_json.encode()).hexdigest()
        
        message = f"{self.identity['agent_id']}:{timestamp}:{body_hash}"
        
        private_key = ed25519.Ed25519PrivateKey.from_private_bytes(
            self.identity['private_key']
        )
        signature = private_key.sign(message.encode())
        
        return f"{self.identity['agent_id']}:{timestamp}:{signature.hex()}"
    
    def _request(self, method, path, **kwargs):
        url = f"{self.endpoint}{path}"
        
        body = kwargs.get('json', {})
        headers = kwargs.get('headers', {})
        headers['Authorization'] = f"Agent {self._sign_request(body)}"
        
        response = requests.request(method, url, headers=headers, **kwargs)
        response.raise_for_status()
        return response.json()
    
    def create_repo(self, name, description=""):
        return self._request('POST', '/v1/repos', json={
            'name': name,
            'description': description
        })
    
    def push(self, repo_id, files, branch='main'):
        return self._request('POST', f'/v1/repos/{repo_id}/push', json={
            'branch': branch,
            'files': files
        })
    
    def get_commits(self, repo_id, branch='main', limit=50):
        return self._request('GET', 
            f'/v1/repos/{repo_id}/commits?branch={branch}&limit={limit}')
    
    def get_tree(self, repo_id, commit_hash):
        return self._request('GET', 
            f'/v1/repos/{repo_id}/tree?commit={commit_hash}')
```

### 11.2 Usage Example

```python
from agent_scm import AgentClient

# Initialize client (auto-loads identity or registers)
client = AgentClient("https://scm.example.com")

# First time: register
if not client.identity:
    client.register(metadata={
        "name": "TradingBot",
        "version": "1.0.0"
    })

# Create repository
repo = client.create_repo("trading-bot", "Autonomous trading system")

# Push code
result = client.push(repo['id'], {
    "main.py": """
import ccxt

def execute_trade(exchange, symbol, side, amount):
    order = exchange.create_order(symbol, 'market', side, amount)
    return order
""",
    "config.json": json.dumps({
        "exchange": "binance",
        "symbols": ["BTC/USDT", "ETH/USDT"]
    })
})

print(f"Committed: {result['commit']['version']}")
print(f"Message: {result['commit']['message']}")
```

---

## 12. Performance Benchmarks

### 12.1 Target Metrics

| Operation | Target Latency (p95) | Throughput |
|-----------|---------------------|------------|
| Register  | <100ms | 100 req/s |
| Push (small) | <200ms | 50 req/s |
| Push (large) | <2s | 10 req/s |
| Get commits | <50ms | 200 req/s |
| Get tree | <100ms | 100 req/s |
| Get blob | <150ms | 100 req/s |

### 12.2 Storage Efficiency

With compression:
- Text files: ~70-80% size reduction
- Already compressed (images): ~0-5% reduction
- Average: 50% space saved

Deduplication:
- Identical files: 100% saving
- Similar files: 0% (no delta compression in v1)

---

## Appendix A: Full Example Flow

```
1. Agent generates code
   ├─ No git tracking
   └─ Just produces files

2. Agent calls push()
   ├─ Sends entire project state
   └─ {main.py, config.json, README.md}

3. Server receives push
   ├─ Hashes each file: SHA256(content)
   ├─ Checks blob store: already have README.md
   ├─ Stores new blobs: main.py, config.json
   └─ Creates tree object

4. Server gets previous commit
   ├─ Loads HEAD commit
   └─ Loads previous tree

5. Server computes diff
   ├─ Added: [config.json]
   ├─ Modified: [main.py]
   ├─ Deleted: []
   └─ Stats: +15 lines, -3 lines

6. Server analyzes changes
   ├─ Breaking changes? No
   ├─ New features? Yes (new file)
   └─ Version bump: MINOR (0.1.0 → 0.2.0)

7. Server checks risk
   ├─ Risk score: 0.1 (low)
   └─ Auto-branch? No

8. Server creates commit
   ├─ Hash: SHA256(tree + parent + metadata)
   ├─ Version: v0.2.0
   ├─ Message: "Add config.json, update main.py"
   └─ Links to tree object

9. Server updates branch pointer
   └─ main → new commit hash

10. Server responds
    └─ {commit, version, changes}

11. Agent receives response
    ├─ No local state to update
    └─ Can immediately push again with new state
```

---

## Appendix B: Migration from Git

For agents currently using Git, migration steps:

```python
import git
from agent_scm import AgentClient

def migrate_git_to_agent_scm(git_repo_path):
    # Initialize agent client
    client = AgentClient("https://scm.example.com")
    client.register()
    
    # Create new repo
    repo = client.create_repo(os.path.basename(git_repo_path))
    
    # Get all files from Git repo
    git_repo = git.Repo(git_repo_path)
    files = {}
    
    for item in git_repo.tree().traverse():
        if item.type == 'blob':
            files[item.path] = item.data_stream.read().decode()
    
    # Push to agent-scm
    result = client.push(repo['id'], files)
    print(f"Migrated to agent-scm: {result['commit']['version']}")
```

---

## 13. Known Limitations & Risks

### 13.1 Confidence Assessment

**Overall Confidence: 60-70% for full specification, 90% for MVP**

#### What Will Definitely Work ✅

**Proven Technology Foundation:**
- Content-addressed storage (Git uses same approach)
- Server-side diffing via hash comparison
- Ed25519 cryptographic signing
- Stateless agent design solves real problem
- SQLite + Go + HTTP = boring, reliable tech

**Core Features (High Confidence):**
- Agent registration and auth: 95%
- Blob storage with deduplication: 95%
- Basic push/pull workflow: 90%
- Commit history retrieval: 95%

#### What Needs Significant Iteration ⚠️

**Breaking Change Detection (Biggest Risk)**

The regex-based approach is fundamentally limited:

```go
// Current approach - WILL MISS many cases:
funcPattern := regexp.MustCompile(`def\s+(\w+)\s*\((.*?)\)`)

// Misses:
// 1. Decorators changing behavior
@deprecated
def foo(x): pass  // Breaking but signature unchanged

// 2. Type hint changes
def foo(x: int) -> str:     // Before
def foo(x: str) -> str:     // After - BREAKING!

// 3. Default arguments
def foo(x, **kwargs): pass  // Always matches same pattern

// 4. Semantic changes
def calculate(x):
    return x * 2  // Before
    return x * 3  // After - BREAKING but no signature change
```

**Expected Accuracy: 60-70%**

**Recommended Fix:** Use tree-sitter for AST-based parsing
```go
import "github.com/tree-sitter/tree-sitter-python"

// Parse to AST, compare function nodes
oldAST := parser.Parse(oldCode)
newAST := parser.Parse(newCode)
compareASTNodes(oldAST, newAST)  // Much more accurate
```

**Semantic Versioning Heuristics Are Crude**

Current logic:
```go
if len(diff.Added) > 0 {
    return BumpMinor  // New file = feature
}
if stat.LinesAdded > 20 {
    return BumpMinor  // 20+ lines = feature
}
```

**Problems:**
- Adding test file = MINOR bump (should be PATCH or nothing)
- Deleting deprecated code = MAJOR bump (incorrect)
- Renaming 100 variables = MAJOR bump (false positive)
- Adding critical bugfix in 5 lines = PATCH (correct by accident)

**Reality:** Needs tuning with real-world data. First version will be ~60% accurate.

#### Critical Scalability Issues 🚨

**1. Bandwidth Inefficiency**

```python
# Agent with 50MB project
for iteration in range(100):
    # Sends ALL 50MB every time
    client.push(repo_id, all_files)
    # Even if only 1KB changed
```

**Impact:** 5GB transferred for 100 iterations where 100KB changed total.

**Mitigation in Spec:** `/check-hashes` endpoint exists but:
- Still sends all hashes (overhead for 10,000 files)
- Then sends all changed files (good)
- But no delta compression

**Better Solution (v2.0):**
```python
# Send diff only
client.push_delta(repo_id, {
    "modified": {"main.py": new_content},
    "added": {"new.py": content},
    "deleted": ["old.py"]
})
```

**2. Large Binary Files**

```python
# 100MB ML model
client.push(repo_id, {
    "model.pkl": 100_MB_bytes  # No compression benefit
})

# After 10 iterations = 1GB stored
# With NO deduplication (content changed each time)
```

**Problem:** Spec has no solution for this. Git LFS exists for a reason.

**Impact:** Will hit storage limits quickly with ML models.

**3. Database Scalability**

- SQLite works well to ~100GB
- Beyond that: write contention, slow queries
- Spec has no migration path to PostgreSQL

**When This Breaks:**
- 1000 agents × 1000 commits each × 1KB metadata = 1GB (fine)
- 1000 agents × 10,000 commits each = 10GB (getting slow)
- 10,000 agents × 10,000 commits = 100GB (needs PostgreSQL)

**4. Experimental Branch Explosion**

```python
# Agent tries 50 experiments
for i in range(50):
    push_breaking_change()
    # Creates experiment-2026-03-09-140001
    # Creates experiment-2026-03-09-140002
    # ...
    # Creates experiment-2026-03-09-140050
```

**Result:** 50 branches polluting namespace, no cleanup strategy.

**Missing from Spec:**
- Branch TTL (auto-delete after 7 days)
- Max branches per repo (enforce limit)
- Branch merge/cleanup workflow

### 13.2 What's Missing from v1.0 Spec

**1. Garbage Collection**
```sql
-- Blobs with ref_count=0 should be deleted
-- But spec has no GC job
SELECT * FROM blobs WHERE ref_count = 0;
-- Manually delete? When? How?
```

**2. Backup/Restore**
- Daily backup script in deployment section
- But no restore procedure
- No point-in-time recovery
- No disaster recovery plan

**3. Monitoring Gaps**
- Prometheus metrics defined
- But no alerting rules
- No SLOs defined
- No runbook for incidents

**4. Multi-Tenancy Isolation**
- Agents can't access each other's repos ✓
- But: all agents share same SQLite file
- One corrupted agent can lock database
- No resource quotas (disk, API calls)

**5. Merge Conflicts**
```python
# Two experimental branches
branch1 = push_breaking_change_v1()
branch2 = push_breaking_change_v2()

# How to merge both back to main?
# Spec says: "auto-merge or force"
# Reality: Need conflict resolution
```

### 13.3 Performance Reality Check

**Claimed Targets vs Likely Reality:**

| Operation | Spec Target | Realistic (v1.0) | Notes |
|-----------|-------------|------------------|-------|
| Register | <100ms | 50-150ms | ✓ Achievable |
| Push (small) | <200ms | 200-500ms | Diff computation slower than expected |
| Push (large 10MB) | <2s | 2-5s | Compression bottleneck |
| Get commits | <50ms | 50-100ms | SQLite query on 10K commits |
| Concurrent agents | 100 | 50-75 | SQLite write lock contention |

**Bottlenecks:**
1. Diff computation on large files (line-by-line comparison)
2. Gzip compression (CPU bound)
3. SQLite write serialization
4. No query caching

### 13.4 Security Considerations Not Fully Addressed

**1. API Key Rotation**
- Agents have permanent private keys
- If compromised, no rotation mechanism
- Need: key rotation API

**2. Rate Limiting Bypass**
```python
# Agent can register multiple identities
for i in range(100):
    new_agent = register()  # New rate limit quota
```

**Fix:** Rate limit by IP or require human approval.

**3. Storage Exhaustion**
```python
# Malicious agent
while True:
    push(repo, {"file.bin": random_bytes(50_MB)})
    # No quota enforcement
```

**Fix:** Per-agent disk quotas.

**4. Replay Attack Window**
- 5-minute timestamp window
- Attacker can replay requests within window
- Should be: nonce-based (one-time tokens)

### 13.5 Recommended Scope Changes

#### MVP (3 weeks) - High Confidence ✅

**Include:**
- Agent registration + Ed25519 auth
- Repository creation
- Push with deduplication
- Simple version bumping (line count only)
- Commit history
- Tree/blob retrieval
- Python SDK

**Exclude:**
- Breaking change detection
- Auto-branching
- AST analysis
- Multi-language support

**Confidence: 90%** - This absolutely works.

#### Full v1.0 (8-10 weeks) - Medium Confidence ⚠️

**Add to MVP:**
- Regex-based breaking detection (60% accuracy)
- Experimental branching with limits
- Improved versioning heuristics
- Load testing + optimization
- Production hardening

**Confidence: 70%** - Will need iteration based on real usage.

#### v2.0 (Future) - Requires Research 🔬

**Big improvements:**
- Tree-sitter AST parsing
- Delta compression (like Git pack files)
- PostgreSQL migration path
- Multi-region replication
- Git protocol compatibility

**Confidence: 40%** - Needs experimentation.

### 13.6 Critical Path Items to Prototype First

Before committing to full implementation:

**1. Breaking Change Detection Accuracy Test**
```python
# Collect 100 real Python code changes
# Run detection algorithm
# Measure: precision, recall, F1
# If F1 < 0.6, pivot to AST approach
```

**2. Load Test with Real Agent Code**
```python
# Use actual Claude Artifacts output
# Or OpenAI code interpreter results
# Push 1000 iterations
# Measure: storage growth, performance degradation
```

**3. Storage Efficiency Benchmark**
```bash
# Generate 1000 realistic repos
# Each with 100 commits
# Measure: disk usage, deduplication rate
# Goal: <100MB per repo on average
```

**4. Concurrent Agent Stress Test**
```python
# 100 agents pushing simultaneously
# Measure: SQLite lock contention
# If >10% failure rate, need PostgreSQL from start
```

### 13.7 When to Abandon This Approach

**Stop if:**
- Breaking change detection <40% accurate after 2 weeks
- SQLite can't handle 20 concurrent agents
- Storage grows >10GB for 100 repos (inefficient)
- Agent feedback: "too complex, just want Git"

**Pivot to:**
- Simple Git wrapper API (boring but works)
- Focus on agent-friendly Git UI instead

---

This specification provides everything needed to implement the agent source control system, **with realistic expectations about challenges and limitations**. The design prioritizes simplicity for stateless agents while maintaining robust version control semantics, **but recognize this is v1.0 and will need significant iteration**.
