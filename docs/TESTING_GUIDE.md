# Agent-SCM Testing Guide

# Agent-SCM Testing Guide

## ⚠️ Start Here: Prototype Validation (Before Full Build)

**DO NOT start full implementation without running these validation tests.**

These prototypes test the riskiest assumptions in the spec:

### Prototype 1: Breaking Change Detection Accuracy

**Goal:** Validate that regex-based detection is viable (>60% accuracy)

**Setup (2 hours):**
```bash
mkdir prototypes && cd prototypes
touch test_breaking_detection.py
```

**Collect Test Data:**
```python
# test_breaking_detection.py
import requests

# Collect 50-100 real code changes
test_cases = [
    # Source 1: GitHub PRs with "breaking change" label
    {
        "old": "def calculate(x): return x * 2",
        "new": "def calculate(x, y): return x * y",
        "is_breaking": True,  # Signature changed
        "source": "github.com/user/repo/pull/123"
    },
    
    # Source 2: Your own refactoring history
    {
        "old": "def process(data): return data.upper()",
        "new": "def process(data): return data.lower()",
        "is_breaking": True,  # Behavior changed
        "source": "my_project_v1_to_v2"
    },
    
    # Source 3: Claude Artifacts iterations
    # Save multiple versions of same artifact
    
    # Source 4: False positives (should NOT be breaking)
    {
        "old": "def hello(): pass",
        "new": "def hello():\n    # Added comment\n    pass",
        "is_breaking": False,  # Just comment
        "source": "false_positive_test"
    },
]

def detect_breaking_python(old_code, new_code):
    """Implement the regex detection from spec"""
    import re
    
    func_pattern = re.compile(r'def\s+(\w+)\s*\((.*?)\)')
    
    old_funcs = {}
    for match in func_pattern.finditer(old_code):
        name, params = match.groups()
        old_funcs[name] = params
    
    new_funcs = {}
    for match in func_pattern.finditer(new_code):
        name, params = match.groups()
        new_funcs[name] = params
    
    # Check for signature changes
    for name, old_params in old_funcs.items():
        if name not in new_funcs:
            return True  # Function removed
        if old_params != new_funcs[name]:
            return True  # Signature changed
    
    return False

def run_validation():
    correct = 0
    false_positives = 0
    false_negatives = 0
    
    for case in test_cases:
        detected = detect_breaking_python(case['old'], case['new'])
        expected = case['is_breaking']
        
        if detected == expected:
            correct += 1
        elif detected and not expected:
            false_positives += 1
            print(f"FALSE POSITIVE: {case['source']}")
        elif not detected and expected:
            false_negatives += 1
            print(f"FALSE NEGATIVE: {case['source']}")
    
    total = len(test_cases)
    accuracy = correct / total
    precision = correct / (correct + false_positives) if (correct + false_positives) > 0 else 0
    recall = correct / (correct + false_negatives) if (correct + false_negatives) > 0 else 0
    
    print(f"\n=== RESULTS ===")
    print(f"Total cases: {total}")
    print(f"Accuracy: {accuracy:.1%}")
    print(f"Precision: {precision:.1%}")
    print(f"Recall: {recall:.1%}")
    print(f"False positives: {false_positives}")
    print(f"False negatives: {false_negatives}")
    
    print(f"\n=== DECISION ===")
    if accuracy >= 0.70:
        print("✅ PROCEED: Regex approach is viable")
    elif accuracy >= 0.60:
        print("⚠️  CAUTION: Proceed but plan AST upgrade")
    else:
        print("❌ PIVOT: Use AST parsing from start or simplify approach")
    
    return accuracy

if __name__ == "__main__":
    accuracy = run_validation()
```

**Run Test:**
```bash
python test_breaking_detection.py
```

**Success Criteria:**
- Accuracy >70%: Proceed with confidence
- Accuracy 60-70%: Proceed with AST in roadmap
- Accuracy <60%: Pivot to simpler approach or AST from start

**Time Investment:** 4-8 hours (collecting test cases is most time)

---

### Prototype 2: SQLite Concurrent Write Test

**Goal:** Validate SQLite can handle 50 concurrent agents

**Setup (30 minutes):**
```go
// prototypes/test_sqlite_concurrent.go
package main

import (
    "database/sql"
    "fmt"
    "sync"
    "time"
    _ "github.com/mattn/go-sqlite3"
)

func main() {
    // Initialize test database
    db, _ := sql.Open("sqlite3", "test_concurrent.db")
    defer db.Close()
    
    // Enable WAL mode (from spec)
    db.Exec("PRAGMA journal_mode=WAL")
    db.Exec("PRAGMA synchronous=NORMAL")
    
    // Create test table
    db.Exec(`
        CREATE TABLE IF NOT EXISTS commits (
            hash TEXT PRIMARY KEY,
            repo_id INTEGER,
            content TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `)
    
    // Test concurrent writes
    numAgents := 50
    writesPerAgent := 20
    
    var wg sync.WaitGroup
    errorCount := 0
    mu := sync.Mutex{}
    
    start := time.Now()
    
    for i := 0; i < numAgents; i++ {
        wg.Add(1)
        go func(agentID int) {
            defer wg.Done()
            
            for j := 0; j < writesPerAgent; j++ {
                hash := fmt.Sprintf("agent-%d-commit-%d", agentID, j)
                _, err := db.Exec(
                    "INSERT INTO commits (hash, repo_id, content) VALUES (?, ?, ?)",
                    hash, agentID, "test content",
                )
                
                if err != nil {
                    mu.Lock()
                    errorCount++
                    fmt.Printf("Error: %v\n", err)
                    mu.Unlock()
                }
                
                // Simulate some processing
                time.Sleep(10 * time.Millisecond)
            }
        }(i)
    }
    
    wg.Wait()
    elapsed := time.Since(start)
    
    // Check results
    var count int
    db.QueryRow("SELECT COUNT(*) FROM commits").Scan(&count)
    
    totalWrites := numAgents * writesPerAgent
    successRate := float64(count) / float64(totalWrites)
    errorRate := float64(errorCount) / float64(totalWrites)
    
    fmt.Printf("\n=== RESULTS ===\n")
    fmt.Printf("Total writes attempted: %d\n", totalWrites)
    fmt.Printf("Successful writes: %d\n", count)
    fmt.Printf("Errors: %d\n", errorCount)
    fmt.Printf("Success rate: %.1f%%\n", successRate*100)
    fmt.Printf("Error rate: %.1f%%\n", errorRate*100)
    fmt.Printf("Time elapsed: %v\n", elapsed)
    fmt.Printf("Writes/second: %.0f\n", float64(count)/elapsed.Seconds())
    
    fmt.Printf("\n=== DECISION ===\n")
    if errorRate == 0 {
        fmt.Println("✅ EXCELLENT: SQLite handles concurrent writes perfectly")
    } else if errorRate < 0.05 {
        fmt.Println("✅ GOOD: SQLite works with retry logic")
    } else if errorRate < 0.10 {
        fmt.Println("⚠️  CAUTION: Consider PostgreSQL for production")
    } else {
        fmt.Println("❌ FAIL: Use PostgreSQL from start")
    }
}
```

**Run Test:**
```bash
go run test_sqlite_concurrent.go
```

**Success Criteria:**
- 0% errors: Perfect, use SQLite
- <5% errors: Good with retry logic
- 5-10% errors: Consider PostgreSQL
- >10% errors: Must use PostgreSQL

**Time Investment:** 1-2 hours

---

### Prototype 3: Storage Efficiency Test

**Goal:** Measure actual storage with realistic data

**Setup (1 hour):**
```python
# prototypes/test_storage_efficiency.py
import hashlib
import gzip
import os
import random
import string

class BlobStore:
    def __init__(self, base_dir="test_blobs"):
        self.base_dir = base_dir
        os.makedirs(base_dir, exist_ok=True)
        self.blobs = {}  # hash -> content
        self.stats = {"stored": 0, "duplicates": 0, "total_size": 0, "compressed_size": 0}
    
    def store(self, content):
        # Hash content
        hash_val = hashlib.sha256(content).hexdigest()
        
        if hash_val in self.blobs:
            self.stats["duplicates"] += 1
            return hash_val
        
        # Compress
        compressed = gzip.compress(content)
        
        # Store
        path = os.path.join(self.base_dir, hash_val[:2], hash_val[2:4], hash_val)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        
        with open(path, 'wb') as f:
            f.write(compressed)
        
        self.blobs[hash_val] = True
        self.stats["stored"] += 1
        self.stats["total_size"] += len(content)
        self.stats["compressed_size"] += len(compressed)
        
        return hash_val

def generate_python_file():
    """Generate realistic Python code"""
    functions = []
    for i in range(random.randint(3, 10)):
        func_name = f"process_{random.choice(['data', 'input', 'result', 'value'])}_{i}"
        params = ', '.join([f'arg{j}' for j in range(random.randint(1, 4))])
        body = f"    result = {random.randint(1, 100)}\n    return result"
        functions.append(f"def {func_name}({params}):\n{body}\n")
    
    return '\n'.join(functions).encode()

def mutate_code(content, mutation_rate=0.3):
    """Simulate code changes"""
    lines = content.decode().split('\n')
    
    # Modify some lines
    for i in range(len(lines)):
        if random.random() < mutation_rate:
            if 'return' in lines[i]:
                lines[i] = lines[i].replace(
                    str(random.randint(1, 100)),
                    str(random.randint(1, 100))
                )
    
    # Maybe add new function
    if random.random() < 0.2:
        lines.append(f"\ndef new_func_{random.randint(1,100)}(): pass")
    
    return '\n'.join(lines).encode()

def run_test():
    store = BlobStore()
    
    # Simulate 10 repos
    repos = []
    for repo_id in range(10):
        repo_files = {}
        
        # Each repo has 10-20 files
        for file_id in range(random.randint(10, 20)):
            filename = f"file_{file_id}.py"
            repo_files[filename] = generate_python_file()
        
        repos.append(repo_files)
    
    # Simulate 100 commits per repo
    for commit_num in range(100):
        for repo_id, repo in enumerate(repos):
            # Mutate files
            for filename in list(repo.keys()):
                if random.random() < 0.3:  # 30% of files change
                    repo[filename] = mutate_code(repo[filename])
            
            # Store all files
            for content in repo.values():
                store.store(content)
        
        if commit_num % 10 == 0:
            print(f"Progress: {commit_num}/100 commits")
    
    # Calculate statistics
    stats = store.stats
    total_commits = 100 * 10  # 100 commits × 10 repos
    
    compression_ratio = stats["compressed_size"] / stats["total_size"] if stats["total_size"] > 0 else 0
    dedup_rate = stats["duplicates"] / (stats["stored"] + stats["duplicates"]) if (stats["stored"] + stats["duplicates"]) > 0 else 0
    
    avg_size_per_repo = stats["compressed_size"] / 10 / (1024 * 1024)  # MB
    
    print(f"\n=== STORAGE STATISTICS ===")
    print(f"Total blobs stored: {stats['stored']}")
    print(f"Duplicate blobs (saved): {stats['duplicates']}")
    print(f"Original size: {stats['total_size'] / (1024*1024):.1f} MB")
    print(f"Compressed size: {stats['compressed_size'] / (1024*1024):.1f} MB")
    print(f"Compression ratio: {compression_ratio:.1%}")
    print(f"Deduplication rate: {dedup_rate:.1%}")
    print(f"Average per repo (100 commits): {avg_size_per_repo:.1f} MB")
    
    print(f"\n=== DECISION ===")
    if avg_size_per_repo < 10:
        print("✅ EXCELLENT: Storage very efficient")
    elif avg_size_per_repo < 20:
        print("✅ GOOD: Storage acceptable")
    elif avg_size_per_repo < 50:
        print("⚠️  CAUTION: Consider better compression")
    else:
        print("❌ PROBLEM: Need delta compression or different approach")

if __name__ == "__main__":
    run_test()
```

**Run Test:**
```bash
python test_storage_efficiency.py
```

**Success Criteria:**
- <10MB per repo: Excellent
- 10-20MB per repo: Good
- 20-50MB per repo: Acceptable with monitoring
- >50MB per repo: Need delta compression

**Time Investment:** 2 hours

---

## After Prototypes: Decision Matrix

| Prototype | Result | Action |
|-----------|--------|--------|
| Breaking Detection | >70% | ✅ Proceed with regex |
| Breaking Detection | 60-70% | ⚠️  Proceed, plan AST upgrade |
| Breaking Detection | <60% | ❌ Pivot to AST or simpler approach |
| SQLite Concurrency | <5% errors | ✅ Use SQLite |
| SQLite Concurrency | 5-10% errors | ⚠️  SQLite + retry logic |
| SQLite Concurrency | >10% errors | ❌ Use PostgreSQL from start |
| Storage Efficiency | <20MB/repo | ✅ Proceed |
| Storage Efficiency | 20-50MB/repo | ⚠️  Monitor, optimize if needed |
| Storage Efficiency | >50MB/repo | ❌ Need delta compression |

**GO/NO-GO Decision:**
- All ✅: Full speed ahead with original spec
- Mix of ✅/⚠️: Proceed with adjustments
- Any ❌: Revise approach before starting

---

## Quick Start

```bash
# 1. Set up test environment
make test-env

# 2. Run all tests
make test

# 3. Run specific test suites
make test-unit          # Unit tests only
make test-integration   # Integration tests
make test-e2e          # End-to-end tests
make test-load         # Load/performance tests

# 4. Coverage report
make test-coverage
```

---

## Test Environment Setup

### 1. Local Development Setup

```bash
# Install dependencies
go mod download
pip install -r requirements-test.txt

# Start test database
sqlite3 test.db < schema.sql

# Start test server
go run cmd/server/main.go --db=test.db --port=8081 &
TEST_SERVER_PID=$!

# Run tests
go test ./...

# Cleanup
kill $TEST_SERVER_PID
rm test.db
```

### 2. Docker Test Environment

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  agent-scm-test:
    build:
      context: .
      dockerfile: Dockerfile.test
    environment:
      - ENV=test
      - DB_PATH=/tmp/test.db
    volumes:
      - ./:/app
      - /tmp/test-data:/data
    command: go test -v ./...

  load-test:
    image: grafana/k6:latest
    volumes:
      - ./tests/load:/scripts
    command: run /scripts/load-test.js
    depends_on:
      - agent-scm-test
```

```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit
```

---

## Unit Tests

### Test File Structure

```
tests/
├── unit/
│   ├── hash_test.go           # Content hashing
│   ├── version_test.go        # Semantic versioning
│   ├── diff_test.go          # Diff computation
│   ├── signing_test.go       # Cryptographic signing
│   ├── breaking_test.go      # Breaking change detection
│   └── storage_test.go       # Blob storage
├── integration/
│   ├── api_test.go           # API endpoints
│   ├── push_test.go          # Push flow
│   └── branch_test.go        # Branching logic
├── e2e/
│   ├── test_agent_lifecycle.py
│   └── test_multi_agent.py
└── load/
    └── load-test.js
```

### Critical Unit Tests

#### 1. Content Hashing Tests

```go
// tests/unit/hash_test.go
package unit

import (
    "testing"
    "github.com/stretchr/testify/assert"
)

func TestHashContent_Deterministic(t *testing.T) {
    content := []byte("hello world")
    hash1 := HashContent(content)
    hash2 := HashContent(content)
    
    assert.Equal(t, hash1, hash2)
    assert.Len(t, hash1, 64) // SHA256 = 64 hex chars
}

func TestHashContent_DifferentContent(t *testing.T) {
    content1 := []byte("hello")
    content2 := []byte("world")
    
    hash1 := HashContent(content1)
    hash2 := HashContent(content2)
    
    assert.NotEqual(t, hash1, hash2)
}

func TestHashContent_EmptyContent(t *testing.T) {
    content := []byte("")
    hash := HashContent(content)
    
    // SHA256 of empty string
    expected := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    assert.Equal(t, expected, hash)
}
```

#### 2. Semantic Versioning Tests

```go
// tests/unit/version_test.go
package unit

func TestBumpVersion(t *testing.T) {
    tests := []struct {
        name     string
        current  string
        bump     VersionBump
        expected string
    }{
        {"patch bump", "v0.1.0", BumpPatch, "v0.1.1"},
        {"minor bump", "v0.1.0", BumpMinor, "v0.2.0"},
        {"major bump", "v0.1.0", BumpMajor, "v1.0.0"},
        {"minor resets patch", "v0.1.5", BumpMinor, "v0.2.0"},
        {"major resets all", "v1.2.3", BumpMajor, "v2.0.0"},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := BumpVersion(tt.current, tt.bump)
            assert.Equal(t, tt.expected, result)
        })
    }
}

func TestDetermineVersionBump(t *testing.T) {
    tests := []struct {
        name     string
        diff     *DiffResult
        expected VersionBump
    }{
        {
            name: "breaking change",
            diff: &DiffResult{
                Modified: []string{"api.py"},
                Stats: map[string]FileDiff{
                    "api.py": {IsBreaking: true},
                },
            },
            expected: BumpMajor,
        },
        {
            name: "new file",
            diff: &DiffResult{
                Added: []string{"new.py"},
            },
            expected: BumpMinor,
        },
        {
            name: "small change",
            diff: &DiffResult{
                Modified: []string{"readme.md"},
                Stats: map[string]FileDiff{
                    "readme.md": {LinesAdded: 5, IsBreaking: false},
                },
            },
            expected: BumpPatch,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := DetermineVersionBump(tt.diff)
            assert.Equal(t, tt.expected, result)
        })
    }
}
```

#### 3. Diff Computation Tests

```go
// tests/unit/diff_test.go
package unit

func TestComputeDiff(t *testing.T) {
    oldTree := map[string]string{
        "file1.txt": "hash1",
        "file2.txt": "hash2",
        "file3.txt": "hash3",
    }
    
    newTree := map[string]string{
        "file1.txt": "hash1",      // unchanged
        "file2.txt": "hash2_new",  // modified
        "file4.txt": "hash4",      // added
    }
    
    diff := ComputeDiff(oldTree, newTree)
    
    assert.Contains(t, diff.Modified, "file2.txt")
    assert.Contains(t, diff.Added, "file4.txt")
    assert.Contains(t, diff.Deleted, "file3.txt")
    assert.NotContains(t, diff.Modified, "file1.txt")
}

func TestComputeDiff_NoChanges(t *testing.T) {
    tree := map[string]string{
        "file1.txt": "hash1",
        "file2.txt": "hash2",
    }
    
    diff := ComputeDiff(tree, tree)
    
    assert.Empty(t, diff.Added)
    assert.Empty(t, diff.Modified)
    assert.Empty(t, diff.Deleted)
}
```

#### 4. Breaking Change Detection Tests

```go
// tests/unit/breaking_test.go
package unit

func TestDetectPythonBreaking(t *testing.T) {
    tests := []struct {
        name      string
        oldCode   string
        newCode   string
        isBreaking bool
    }{
        {
            name: "signature change - added param",
            oldCode: `
def hello(name):
    print(name)
`,
            newCode: `
def hello(name, greeting):
    print(greeting, name)
`,
            isBreaking: true,
        },
        {
            name: "signature change - removed param",
            oldCode: `
def process(x, y, z):
    return x + y + z
`,
            newCode: `
def process(x, y):
    return x + y
`,
            isBreaking: true,
        },
        {
            name: "class removed",
            oldCode: `
class Calculator:
    def add(self, x, y):
        return x + y
`,
            newCode: `
# Calculator removed
`,
            isBreaking: true,
        },
        {
            name: "implementation change - not breaking",
            oldCode: `
def add(x, y):
    return x + y
`,
            newCode: `
def add(x, y):
    # Better implementation
    result = x + y
    return result
`,
            isBreaking: false,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := detectPythonBreaking(
                []byte(tt.oldCode),
                []byte(tt.newCode),
            )
            assert.Equal(t, tt.isBreaking, result)
        })
    }
}
```

#### 5. Cryptographic Signing Tests

```go
// tests/unit/signing_test.go
package unit

func TestSignAndVerify(t *testing.T) {
    // Generate keypair
    pubKey, privKey, _ := ed25519.GenerateKey(nil)
    
    agentID := "agent-test123"
    body := []byte(`{"repo": "test"}`)
    
    // Sign request
    signature := SignRequest(agentID, privKey, body)
    
    // Verify signature
    valid, err := VerifySignature(agentID, pubKey, signature, body)
    assert.NoError(t, err)
    assert.True(t, valid)
}

func TestVerifySignature_Invalid(t *testing.T) {
    pubKey, privKey, _ := ed25519.GenerateKey(nil)
    _, wrongPrivKey, _ := ed25519.GenerateKey(nil)
    
    agentID := "agent-test123"
    body := []byte(`{"repo": "test"}`)
    
    // Sign with wrong key
    signature := SignRequest(agentID, wrongPrivKey, body)
    
    // Should fail verification
    valid, _ := VerifySignature(agentID, pubKey, signature, body)
    assert.False(t, valid)
}

func TestVerifySignature_Expired(t *testing.T) {
    pubKey, privKey, _ := ed25519.GenerateKey(nil)
    agentID := "agent-test123"
    body := []byte(`{"repo": "test"}`)
    
    // Create signature with old timestamp
    oldTimestamp := time.Now().Add(-10 * time.Minute).Unix()
    signature := SignRequestWithTimestamp(agentID, privKey, body, oldTimestamp)
    
    // Should fail due to expiration
    valid, err := VerifySignature(agentID, pubKey, signature, body)
    assert.Error(t, err)
    assert.False(t, valid)
}
```

#### 6. Blob Storage Tests

```go
// tests/unit/storage_test.go
package unit

func TestBlobStore_Deduplication(t *testing.T) {
    store := NewBlobStore("/tmp/test-blobs")
    defer os.RemoveAll("/tmp/test-blobs")
    
    content := []byte("test content")
    
    // Store same content twice
    hash1, err1 := store.Write(content)
    hash2, err2 := store.Write(content)
    
    assert.NoError(t, err1)
    assert.NoError(t, err2)
    assert.Equal(t, hash1, hash2)
    
    // Verify only one file exists
    files, _ := filepath.Glob(filepath.Join("/tmp/test-blobs", "*", "*", "*"))
    assert.Len(t, files, 1)
}

func TestBlobStore_Compression(t *testing.T) {
    store := NewBlobStore("/tmp/test-blobs")
    defer os.RemoveAll("/tmp/test-blobs")
    
    // Highly compressible content
    content := bytes.Repeat([]byte("a"), 10000)
    
    hash, _ := store.Write(content)
    
    // Check stored file size
    path := store.getBlobPath(hash)
    info, _ := os.Stat(path)
    
    // Should be much smaller than original
    assert.Less(t, info.Size(), int64(1000))
}

func TestBlobStore_ReadWrite(t *testing.T) {
    store := NewBlobStore("/tmp/test-blobs")
    defer os.RemoveAll("/tmp/test-blobs")
    
    original := []byte("test content with special chars: 日本語")
    
    hash, _ := store.Write(original)
    retrieved, err := store.Read(hash)
    
    assert.NoError(t, err)
    assert.Equal(t, original, retrieved)
}
```

---

## Integration Tests

### API Integration Tests

```go
// tests/integration/api_test.go
package integration

func TestAPIFlow_RegisterAndPush(t *testing.T) {
    server := NewTestServer(t)
    defer server.Close()
    
    // 1. Register agent
    pubKey, privKey := generateTestKeypair()
    
    resp := httpPost(server.URL+"/v1/register", map[string]interface{}{
        "public_key": hex.EncodeToString(pubKey),
        "metadata":   map[string]string{"name": "TestAgent"},
    })
    
    assert.Equal(t, 201, resp.StatusCode)
    
    var regData map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&regData)
    agentID := regData["agent_id"].(string)
    
    // 2. Create repo
    body := map[string]interface{}{
        "name":        "test-repo",
        "description": "Test repository",
    }
    
    resp = httpPostSigned(server.URL+"/v1/repos", body, agentID, privKey)
    assert.Equal(t, 201, resp.StatusCode)
    
    var repoData map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&repoData)
    repoID := int(repoData["id"].(float64))
    
    // 3. Push files
    pushBody := map[string]interface{}{
        "branch": "main",
        "files": map[string]string{
            "main.py":     "print('hello')",
            "README.md": "# Test",
        },
    }
    
    resp = httpPostSigned(
        fmt.Sprintf("%s/v1/repos/%d/push", server.URL, repoID),
        pushBody,
        agentID,
        privKey,
    )
    
    assert.Equal(t, 200, resp.StatusCode)
    
    var pushData map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&pushData)
    
    commit := pushData["commit"].(map[string]interface{})
    assert.Equal(t, "v0.1.0", commit["version"])
    
    changes := pushData["changes"].(map[string]interface{})
    added := changes["added"].([]interface{})
    assert.Len(t, added, 2)
}

func TestAPI_UnauthorizedAccess(t *testing.T) {
    server := NewTestServer(t)
    defer server.Close()
    
    // Try to create repo without auth
    resp := httpPost(server.URL+"/v1/repos", map[string]interface{}{
        "name": "test-repo",
    })
    
    assert.Equal(t, 401, resp.StatusCode)
}

func TestAPI_InvalidSignature(t *testing.T) {
    server := NewTestServer(t)
    defer server.Close()
    
    // Register with one key
    pubKey1, privKey1 := generateTestKeypair()
    agent := registerAgent(server.URL, pubKey1)
    
    // Try to use different key
    _, privKey2 := generateTestKeypair()
    
    resp := httpPostSigned(server.URL+"/v1/repos", 
        map[string]interface{}{"name": "test"},
        agent["agent_id"].(string),
        privKey2,
    )
    
    assert.Equal(t, 401, resp.StatusCode)
}
```

### Push Flow Integration Tests

```go
// tests/integration/push_test.go
package integration

func TestPushFlow_IncrementalChanges(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    // Push 1: Initial files
    result1, _ := client.Push(repo.ID, map[string]string{
        "main.py":   "def hello(): pass",
        "config.py": "DEBUG = True",
    })
    
    assert.Equal(t, "v0.1.0", result1.Commit.Version)
    assert.Len(t, result1.Changes.Added, 2)
    
    // Push 2: Modify one file
    result2, _ := client.Push(repo.ID, map[string]string{
        "main.py":   "def hello(): print('hi')",
        "config.py": "DEBUG = True",
    })
    
    assert.Equal(t, "v0.1.1", result2.Commit.Version)
    assert.Len(t, result2.Changes.Modified, 1)
    assert.Contains(t, result2.Changes.Modified, "main.py")
    
    // Push 3: Add new file
    result3, _ := client.Push(repo.ID, map[string]string{
        "main.py":   "def hello(): print('hi')",
        "config.py": "DEBUG = True",
        "utils.py":  "def helper(): pass",
    })
    
    assert.Equal(t, "v0.2.0", result3.Commit.Version)
    assert.Contains(t, result3.Changes.Added, "utils.py")
    
    // Push 4: Delete file
    result4, _ := client.Push(repo.ID, map[string]string{
        "main.py":   "def hello(): print('hi')",
        "utils.py":  "def helper(): pass",
    })
    
    assert.Contains(t, result4.Changes.Deleted, "config.py")
}

func TestPushFlow_NoChanges(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    files := map[string]string{
        "main.py": "print('hello')",
    }
    
    // First push
    result1, _ := client.Push(repo.ID, files)
    assert.Equal(t, "v0.1.0", result1.Commit.Version)
    
    // Second push with same content
    result2, _ := client.Push(repo.ID, files)
    assert.Equal(t, "No changes detected", result2.Message)
    assert.Equal(t, "v0.1.0", result2.CurrentVersion)
}

func TestPushFlow_LargeFile(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    // Create 10MB file
    largeContent := strings.Repeat("a", 10*1024*1024)
    
    result, err := client.Push(repo.ID, map[string]string{
        "large.txt": largeContent,
    })
    
    assert.NoError(t, err)
    assert.Equal(t, "v0.1.0", result.Commit.Version)
    
    // Verify blob stored correctly
    tree, _ := client.GetTree(repo.ID, result.Commit.Hash)
    assert.Len(t, tree.Entries, 1)
}
```

### Experimental Branching Tests

```go
// tests/integration/branch_test.go
package integration

func TestBranching_ExperimentalCreation(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    // Initial commit
    client.Push(repo.ID, map[string]string{
        "api.py": `
def calculate(x, y):
    return x + y
`,
    })
    
    // Breaking change
    result, _ := client.Push(repo.ID, map[string]string{
        "api.py": `
def calculate(x, y, z):
    return x + y + z
`,
    })
    
    // Should create experimental branch
    assert.NotNil(t, result.Experimental)
    assert.True(t, strings.HasPrefix(result.Commit.Branch, "experiment-"))
    assert.Equal(t, "main", result.Experimental.ParentBranch)
    assert.Contains(t, result.Experimental.Reason, "Breaking")
}

func TestBranching_MultipleBranches(t *testing.T) {
    server := NewTestServer(t)
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("test-project")
    
    // Create main branch
    client.Push(repo.ID, map[string]string{
        "main.py": "v1",
    })
    
    // Create multiple experimental branches
    for i := 0; i < 3; i++ {
        client.Push(repo.ID, map[string]string{
            "main.py": fmt.Sprintf("breaking change %d", i),
        })
    }
    
    // List branches
    branches, _ := client.ListBranches(repo.ID)
    
    // Should have main + 3 experimental
    assert.Len(t, branches, 4)
    
    experimentalCount := 0
    for _, branch := range branches {
        if branch.IsExperimental {
            experimentalCount++
        }
    }
    assert.Equal(t, 3, experimentalCount)
}
```

---

## End-to-End Tests

### Python E2E Tests

```python
# tests/e2e/test_agent_lifecycle.py
import pytest
from agent_scm import AgentClient
import tempfile
import os

class TestAgentLifecycle:
    @pytest.fixture
    def client(self):
        return AgentClient("http://localhost:8080")
    
    def test_full_lifecycle(self, client):
        # 1. Register
        identity = client.register(metadata={
            "name": "E2ETestAgent",
            "version": "1.0.0"
        })
        
        assert identity['agent_id'].startswith('agent-')
        
        # 2. Create repo
        repo = client.create_repo(
            name="e2e-test-repo",
            description="End-to-end test repository"
        )
        
        assert repo['name'] == "e2e-test-repo"
        assert repo['default_branch'] == "main"
        
        # 3. Push initial code
        result = client.push(repo['id'], {
            "main.py": """
def greet(name):
    return f"Hello, {name}"
""",
            "config.json": '{"version": "1.0.0"}',
            "README.md": "# E2E Test Project"
        })
        
        assert result['commit']['version'] == "v0.1.0"
        assert len(result['changes']['added']) == 3
        assert result['commit']['commit_type'] == "MINOR"
        
        # 4. Modify code (patch)
        result = client.push(repo['id'], {
            "main.py": """
def greet(name):
    # Added comment
    return f"Hello, {name}"
""",
            "config.json": '{"version": "1.0.0"}',
            "README.md": "# E2E Test Project"
        })
        
        assert result['commit']['version'] == "v0.1.1"
        assert "main.py" in result['changes']['modified']
        
        # 5. Add new feature (minor)
        result = client.push(repo['id'], {
            "main.py": """
def greet(name):
    return f"Hello, {name}"

def farewell(name):
    return f"Goodbye, {name}"
""",
            "config.json": '{"version": "1.0.0"}',
            "README.md": "# E2E Test Project"
        })
        
        assert result['commit']['version'] == "v0.2.0"
        
        # 6. Breaking change (should create experimental branch)
        result = client.push(repo['id'], {
            "main.py": """
def greet(name, greeting="Hello"):
    return f"{greeting}, {name}"
""",
            "config.json": '{"version": "2.0.0"}',
            "README.md": "# E2E Test Project"
        })
        
        assert result['experimental'] is not None
        assert result['commit']['branch'].startswith('experiment-')
        
        # 7. Get commit history
        commits = client.get_commits(repo['id'], branch='main')
        assert len(commits) == 3  # Only main branch commits
        
        # 8. Get branches
        branches = client.get_branches(repo['id'])
        assert len(branches) == 2  # main + experimental
        
        # 9. Get file tree
        tree = client.get_tree(repo['id'], commits[0]['hash'])
        assert len(tree['entries']) == 3
        
    def test_multi_agent_isolation(self):
        # Create two agents
        agent1 = AgentClient("http://localhost:8080")
        agent2 = AgentClient("http://localhost:8080")
        
        agent1.register(metadata={"name": "Agent1"})
        agent2.register(metadata={"name": "Agent2"})
        
        # Both create repos with same name
        repo1 = agent1.create_repo("my-project")
        repo2 = agent2.create_repo("my-project")
        
        # Should be different repos
        assert repo1['id'] != repo2['id']
        
        # Agent1 pushes
        agent1.push(repo1['id'], {"file.txt": "agent1 content"})
        
        # Agent2 should not be able to access agent1's repo
        with pytest.raises(Exception) as exc_info:
            agent2.get_commits(repo1['id'])
        
        assert exc_info.value.status_code == 403
```

### Multi-Agent Concurrent Test

```python
# tests/e2e/test_concurrent.py
import pytest
from agent_scm import AgentClient
import concurrent.futures
import time

def agent_workflow(agent_id):
    """Simulate an agent's complete workflow"""
    client = AgentClient("http://localhost:8080")
    
    # Register
    client.register(metadata={"name": f"Agent{agent_id}"})
    
    # Create repo
    repo = client.create_repo(f"repo-{agent_id}")
    
    # Push multiple times
    results = []
    for i in range(10):
        result = client.push(repo['id'], {
            "main.py": f"version = {i}",
            "data.txt": f"Data for iteration {i}"
        })
        results.append(result['commit']['version'])
        time.sleep(0.1)
    
    return results

def test_concurrent_agents():
    """Test 20 agents working concurrently"""
    num_agents = 20
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        futures = [
            executor.submit(agent_workflow, i)
            for i in range(num_agents)
        ]
        
        results = [f.result() for f in futures]
    
    # Verify all agents completed successfully
    assert len(results) == num_agents
    
    # Each agent should have 10 versions
    for agent_versions in results:
        assert len(agent_versions) == 10
        # Versions should increment properly
        assert agent_versions[0] == "v0.1.0"
        assert agent_versions[-1] == "v0.1.9"
```

---

## Load Testing

### K6 Load Test Script

```javascript
// tests/load/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up to 10 agents
    { duration: '3m', target: 50 },   // Ramp up to 50 agents
    { duration: '2m', target: 100 },  // Spike to 100 agents
    { duration: '2m', target: 50 },   // Scale down
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests < 500ms
    http_req_failed: ['rate<0.01'],    // <1% failure rate
  },
};

const BASE_URL = 'http://localhost:8080';

// Shared agent identities (simulating persistent agents)
const agents = [];

export function setup() {
  // Create 100 pre-registered agents
  for (let i = 0; i < 100; i++) {
    const identity = registerAgent();
    const repo = createRepo(identity, `load-test-repo-${i}`);
    agents.push({ identity, repo });
  }
  return { agents };
}

export default function (data) {
  const agent = data.agents[Math.floor(Math.random() * data.agents.length)];
  
  // Simulate agent push
  const files = {
    'main.py': `# Version ${Date.now()}`,
    'config.json': JSON.stringify({ timestamp: Date.now() }),
  };
  
  const result = push(agent.identity, agent.repo.id, files);
  
  check(result, {
    'push successful': (r) => r.status === 200,
    'has commit hash': (r) => r.json('commit.hash') !== '',
    'has version': (r) => r.json('commit.version') !== '',
  });
  
  sleep(Math.random() * 2); // Random delay between 0-2s
}

function registerAgent() {
  const payload = {
    public_key: crypto.randomBytes(32).toString('hex'),
    metadata: { name: 'LoadTestAgent' },
  };
  
  const res = http.post(`${BASE_URL}/v1/register`, JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
  
  return res.json();
}

function createRepo(identity, name) {
  const payload = { name, description: 'Load test repo' };
  const signature = signRequest(identity.agent_id, payload);
  
  const res = http.post(`${BASE_URL}/v1/repos`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Agent ${signature}`,
    },
  });
  
  return res.json();
}

function push(identity, repoId, files) {
  const payload = { branch: 'main', files };
  const signature = signRequest(identity.agent_id, payload);
  
  return http.post(
    `${BASE_URL}/v1/repos/${repoId}/push`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Agent ${signature}`,
      },
    }
  );
}

function signRequest(agentId, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyHash = crypto.sha256(JSON.stringify(payload), 'hex');
  // Simplified signature (in real test, use proper crypto)
  return `${agentId}:${timestamp}:${bodyHash}`;
}
```

### Running Load Tests

```bash
# Install k6
brew install k6  # macOS
# or: sudo apt-get install k6  # Linux

# Run load test
k6 run tests/load/load-test.js

# Run with custom duration
k6 run --duration 10m --vus 100 tests/load/load-test.js

# Export results to InfluxDB (for visualization)
k6 run --out influxdb=http://localhost:8086/k6 tests/load/load-test.js
```

---

## Performance Benchmarks

### Go Benchmarks

```go
// tests/benchmark/bench_test.go
package benchmark

func BenchmarkHashContent(b *testing.B) {
    content := bytes.Repeat([]byte("a"), 1024*1024) // 1MB
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        HashContent(content)
    }
}

func BenchmarkBlobStore_Write(b *testing.B) {
    store := NewBlobStore("/tmp/bench-blobs")
    defer os.RemoveAll("/tmp/bench-blobs")
    
    content := make([]byte, 10*1024) // 10KB
    rand.Read(content)
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        store.Write(content)
    }
}

func BenchmarkDiffComputation(b *testing.B) {
    oldTree := generateRandomTree(100) // 100 files
    newTree := generateRandomTree(100)
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        ComputeDiff(oldTree, newTree)
    }
}

func BenchmarkPushEndToEnd(b *testing.B) {
    server := NewBenchServer()
    client := NewTestClient(server.URL)
    
    identity, _ := client.Register()
    repo, _ := client.CreateRepo("bench-repo")
    
    files := map[string]string{
        "main.py":   string(make([]byte, 5*1024)),
        "config.py": string(make([]byte, 1*1024)),
        "utils.py":  string(make([]byte, 3*1024)),
    }
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        client.Push(repo.ID, files)
    }
}
```

---

## Test Data Generators

### Realistic Repository Generator

```python
# tests/fixtures/repo_generator.py
import random
import string

class RepoGenerator:
    def __init__(self):
        self.file_types = ['.py', '.js', '.go', '.md', '.json']
        self.function_names = ['process', 'calculate', 'validate', 'transform']
    
    def generate_file(self, file_type):
        if file_type == '.py':
            return self.generate_python_file()
        elif file_type == '.js':
            return self.generate_js_file()
        elif file_type == '.md':
            return self.generate_markdown_file()
        elif file_type == '.json':
            return self.generate_json_file()
        else:
            return self.generate_random_text()
    
    def generate_python_file(self):
        num_functions = random.randint(2, 8)
        functions = []
        
        for _ in range(num_functions):
            name = random.choice(self.function_names)
            params = ', '.join([f'arg{i}' for i in range(random.randint(1, 4))])
            
            functions.append(f"""
def {name}({params}):
    '''
    Auto-generated function for testing
    '''
    result = {random.randint(1, 100)}
    return result
""")
        
        return '\n'.join(functions)
    
    def generate_repo(self, num_files=10):
        files = {}
        
        for i in range(num_files):
            file_type = random.choice(self.file_types)
            filename = f"file_{i}{file_type}"
            files[filename] = self.generate_file(file_type)
        
        return files
    
    def mutate_repo(self, files, mutation_rate=0.3):
        """Randomly modify files to simulate changes"""
        mutated = files.copy()
        
        for filename in list(mutated.keys()):
            if random.random() < mutation_rate:
                # Modify file
                mutated[filename] += f"\n# Modified at {random.randint(1, 1000)}"
        
        # Maybe add new file
        if random.random() < 0.2:
            new_type = random.choice(self.file_types)
            new_file = f"new_{random.randint(1, 100)}{new_type}"
            mutated[new_file] = self.generate_file(new_type)
        
        # Maybe remove file
        if random.random() < 0.1 and len(mutated) > 1:
            del mutated[random.choice(list(mutated.keys()))]
        
        return mutated
```

---

## Continuous Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      
      - name: Run unit tests
        run: |
          go test -v -race -coverprofile=coverage.txt ./...
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage.txt

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Go
        uses: actions/setup-go@v4
        with:
          go-version: '1.21'
      
      - name: Run integration tests
        run: |
          make test-integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Start server
        run: |
          go run cmd/server/main.go &
          sleep 5
      
      - name: Install Python dependencies
        run: |
          pip install -r requirements-test.txt
      
      - name: Run E2E tests
        run: |
          pytest tests/e2e/ -v

  load-tests:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      
      - name: Install k6
        run: |
          sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
          echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update
          sudo apt-get install k6
      
      - name: Run load tests
        run: |
          k6 run tests/load/load-test.js
```

---

## Test Makefile

```makefile
# Makefile
.PHONY: test test-unit test-integration test-e2e test-load test-coverage

test: test-unit test-integration

test-unit:
	@echo "Running unit tests..."
	go test -v -race ./tests/unit/...

test-integration:
	@echo "Running integration tests..."
	go test -v -race ./tests/integration/...

test-e2e:
	@echo "Starting test server..."
	@go run cmd/server/main.go --db=/tmp/test.db --port=8081 &
	@echo $$! > /tmp/server.pid
	@sleep 2
	@echo "Running E2E tests..."
	@pytest tests/e2e/ -v
	@kill `cat /tmp/server.pid`
	@rm /tmp/server.pid /tmp/test.db

test-load:
	@echo "Running load tests..."
	@k6 run tests/load/load-test.js

test-coverage:
	@echo "Generating coverage report..."
	@go test -coverprofile=coverage.out ./...
	@go tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

test-bench:
	@echo "Running benchmarks..."
	@go test -bench=. -benchmem ./tests/benchmark/...
```

---

This testing guide covers all aspects of testing the Agent-SCM system comprehensively.
