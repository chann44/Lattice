# Agent-SCM Implementation Roadmap

## ⚠️ Reality Check: Timeline Confidence

**Original Plan:** 6 weeks to production  
**Realistic Estimate:** 8-10 weeks for production-ready v1.0  
**MVP (Usable but Limited):** 3-4 weeks  

**Confidence Levels:**
- Week 1-2 (Foundation): 95% - Will work as planned
- Week 3 (Push Flow): 70% - Diff engine more complex than expected
- Week 4 (SDK): 80% - SDKs always take longer than planned
- Week 5-6 (Production): 40% - Security/monitoring needs more time

**Critical Unknowns:**
- Breaking change detection accuracy (could need full rewrite with AST)
- SQLite performance with concurrent agents (might need PostgreSQL)
- Storage growth rate (might need better compression/deduplication)

---

## Revised: Two-Path Approach

### Path A: MVP First (Recommended)

**Goal:** Usable system in 3-4 weeks, iterate based on real usage

**Scope:**
- ✅ Core push/pull workflow
- ✅ Simple version bumping (line count heuristics)
- ✅ Deduplication
- ❌ NO breaking change detection
- ❌ NO auto-branching
- ❌ NO multi-language support

**Timeline:** 3-4 weeks  
**Confidence:** 90%

### Path B: Full Spec (Original Plan)

**Goal:** Complete feature set including auto-branching

**Scope:**
- ✅ Everything from MVP
- ✅ Regex-based breaking detection (60% accurate)
- ✅ Experimental branching
- ✅ Production hardening

**Timeline:** 8-10 weeks  
**Confidence:** 60%

**Recommendation: Start with Path A, add Path B features in v1.1+**

---

## Phase 0: Risk Reduction (Week 0 - Before Implementation)

### Critical Prototypes to Build First

**Don't start full implementation until these are validated.**

#### Prototype 1: Breaking Change Detection (2 days)

**Goal:** Test if regex approach is viable

```python
# test_breaking_detection.py
test_cases = [
    # Collect 50 real code changes from:
    # - GitHub PRs marked "breaking"
    # - Your own refactoring history
    # - Claude Artifacts iterations
]

def test_detection_accuracy():
    correct = 0
    for old_code, new_code, is_breaking in test_cases:
        detected = detect_breaking_change(old_code, new_code)
        if detected == is_breaking:
            correct += 1
    
    accuracy = correct / len(test_cases)
    print(f"Accuracy: {accuracy:.2%}")
    
    # Decision criteria:
    # >70% = Proceed with regex
    # 50-70% = Add AST parsing to roadmap
    # <50% = Abandon this approach
```

**Success Criteria:** >60% accuracy or clear path to improvement

#### Prototype 2: SQLite Concurrency Test (1 day)

```go
// test_concurrent_writes.go
func TestConcurrentWrites(t *testing.T) {
    db := setupSQLite()
    
    // 50 goroutines writing simultaneously
    var wg sync.WaitGroup
    errors := 0
    
    for i := 0; i < 50; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            _, err := db.Exec("INSERT INTO commits ...")
            if err != nil {
                errors++
            }
        }(i)
    }
    
    wg.Wait()
    
    // Decision:
    // 0 errors = SQLite works
    // 1-5 errors = Add retry logic
    // >5 errors = Use PostgreSQL from start
}
```

**Success Criteria:** <10% error rate under load

#### Prototype 3: Storage Growth Analysis (1 day)

```python
# Generate realistic test data
repo = generate_test_repo(files=100)

for i in range(100):
    # Simulate agent iterations
    repo = mutate_repo(repo, mutation_rate=0.3)
    push(repo)

# Measure:
storage_mb = check_disk_usage()
dedup_rate = calculate_deduplication()

# Decision:
# <10MB per repo = Excellent
# 10-50MB = Acceptable
# >50MB = Need delta compression
```

**Success Criteria:** <20MB average per 100-commit repo

**STOP HERE IF ANY PROTOTYPE FAILS - REVISE APPROACH**

---

## Phase 1: Foundation (Week 1)

### Day 1-2: Project Setup & Core Storage
**Goal:** Get basic infrastructure running

```bash
# Initialize project
mkdir agent-scm && cd agent-scm
go mod init agent-scm
git init

# Create directory structure
mkdir -p {cmd/server,pkg/{storage,crypto,api},tests/{unit,integration,e2e}}
```

**Tasks:**
- [ ] Set up Go module with dependencies
- [ ] Create database schema (schema.sql)
- [ ] Implement content-addressed storage (blob store)
- [ ] Write hash functions (SHA256)
- [ ] Test blob deduplication

**Files to create:**
```
pkg/storage/
├── blob.go        # Blob storage with compression
├── tree.go        # Tree object management
└── db.go          # SQLite wrapper
```

**Validation:**
```go
// Test: Store and retrieve blobs
content := []byte("hello world")
hash := store.StoreBlob(content)
retrieved := store.GetBlob(hash)
assert.Equal(t, content, retrieved)
```

### Day 3-4: Agent Identity & Auth
**Goal:** Secure agent registration and request signing

**Tasks:**
- [ ] Generate Ed25519 keypairs
- [ ] Implement request signing (SignRequest)
- [ ] Implement signature verification (VerifySignature)
- [ ] Add timestamp validation (prevent replay)
- [ ] Write crypto tests

**Files to create:**
```
pkg/crypto/
├── identity.go    # Agent identity generation
├── signing.go     # Request signing/verification
└── auth.go        # Authentication middleware
```

**Validation:**
```bash
# Test agent registration flow
curl -X POST http://localhost:8080/v1/register \
  -H "Content-Type: application/json" \
  -d '{"public_key": "..."}'
```

### Day 5-7: API Foundation
**Goal:** Basic HTTP server with endpoints

**Tasks:**
- [ ] Set up HTTP server (net/http or gin)
- [ ] Add logging middleware
- [ ] Add error handling
- [ ] Implement /v1/register endpoint
- [ ] Implement /v1/repos (create repo)
- [ ] Add request validation

**Files to create:**
```
cmd/server/
└── main.go        # Server entry point

pkg/api/
├── server.go      # HTTP server setup
├── handlers.go    # Request handlers
├── middleware.go  # Auth, logging, etc.
└── errors.go      # Error responses
```

**Validation:**
```bash
# Start server
go run cmd/server/main.go

# Test endpoints
curl http://localhost:8080/health
curl -X POST http://localhost:8080/v1/register -d '{...}'
```

---

## Phase 2: Version Control Core (Week 2)

### Day 8-10: Diff Engine
**Goal:** Compute differences between file trees

**Tasks:**
- [ ] Implement tree creation from file map
- [ ] Implement diff computation (added/modified/deleted)
- [ ] Add line-level diff analysis
- [ ] Write diff tests with various scenarios

**Files to create:**
```
pkg/vcs/
├── diff.go        # Diff computation
├── tree.go        # Tree operations
└── commit.go      # Commit creation
```

**Validation:**
```go
// Test diff computation
oldTree := map[string]string{"file1.txt": "hash1"}
newTree := map[string]string{"file1.txt": "hash2", "file2.txt": "hash3"}
diff := ComputeDiff(oldTree, newTree)
assert.Contains(t, diff.Modified, "file1.txt")
assert.Contains(t, diff.Added, "file2.txt")
```

### Day 11-12: Semantic Versioning
**Goal:** Auto-detect version bumps from changes

**Tasks:**
- [ ] Parse current version (v1.2.3)
- [ ] Implement version bump logic (MAJOR/MINOR/PATCH)
- [ ] Analyze diffs to determine bump type
- [ ] Write version bump tests

**Files to create:**
```
pkg/vcs/
└── version.go     # Semantic versioning logic
```

**Validation:**
```go
// Test version bumping
currentVersion := "v0.1.0"
diff := &DiffResult{Added: []string{"new.py"}}
newVersion := BumpVersion(currentVersion, DetermineVersionBump(diff))
assert.Equal(t, "v0.2.0", newVersion)
```

### Day 13-14: Breaking Change Detection
**Goal:** Detect breaking changes in code

**Tasks:**
- [ ] Implement Python signature detection (regex)
- [ ] Implement JavaScript signature detection
- [ ] Implement Go signature detection
- [ ] Test with real code examples

**Files to create:**
```
pkg/vcs/
└── breaking.go    # Breaking change detection
```

**Validation:**
```go
// Test breaking change detection
oldCode := `def hello(name): pass`
newCode := `def hello(name, greeting): pass`
isBreaking := DetectPythonBreaking(oldCode, newCode)
assert.True(t, isBreaking)
```

---

## Phase 3: Push Flow (Week 3)

### Day 15-17: Push Endpoint
**Goal:** Complete push workflow

**Tasks:**
- [ ] Implement /v1/repos/:id/push endpoint
- [ ] Get current HEAD commit
- [ ] Hash incoming files
- [ ] Check which blobs already exist
- [ ] Store new blobs only
- [ ] Create tree object
- [ ] Compute diff vs previous tree
- [ ] Determine version bump
- [ ] Create commit
- [ ] Update branch HEAD
- [ ] Return result to agent

**Files to create:**
```
pkg/api/
└── push.go        # Push handler
```

**Validation:**
```bash
# Test push flow
curl -X POST http://localhost:8080/v1/repos/1/push \
  -H "Authorization: Agent agent-xxx:timestamp:signature" \
  -d '{"branch": "main", "files": {"main.py": "..."}}'
```

### Day 18-19: Auto-Branching Logic
**Goal:** Create experimental branches for risky changes

**Tasks:**
- [ ] Calculate risk score from diff
- [ ] Implement branch creation
- [ ] Auto-generate branch names (experiment-YYYY-MM-DD-HHMMSS)
- [ ] Link experimental branch to parent
- [ ] Write branching tests

**Files to create:**
```
pkg/vcs/
└── branch.go      # Branching logic
```

**Validation:**
```go
// Test experimental branching
diff := &DiffResult{
    Modified: []string{"api.py"},
    Stats: map[string]FileDiff{
        "api.py": {IsBreaking: true},
    },
}
decision := ShouldCreateExperimentalBranch(diff)
assert.True(t, decision.ShouldBranch)
```

### Day 20-21: Commit History & Tree Retrieval
**Goal:** Query commit history and file trees

**Tasks:**
- [ ] Implement /v1/repos/:id/commits
- [ ] Implement /v1/repos/:id/tree
- [ ] Implement /v1/repos/:id/blob/:hash
- [ ] Add pagination for commits
- [ ] Write retrieval tests

**Files to create:**
```
pkg/api/
├── commits.go     # Commit history handlers
└── tree.go        # Tree/blob handlers
```

---

## Phase 4: Client SDK (Week 4)

### Day 22-24: Python SDK
**Goal:** Easy-to-use Python client

**Tasks:**
- [ ] Implement identity management
- [ ] Implement request signing
- [ ] Create high-level methods (register, create_repo, push)
- [ ] Add error handling
- [ ] Write SDK tests

**Files to create:**
```
sdk/python/agent_scm/
├── __init__.py
├── client.py      # Main client class
├── crypto.py      # Signing utilities
└── exceptions.py  # Custom exceptions
```

**Validation:**
```python
from agent_scm import AgentClient

client = AgentClient("http://localhost:8080")
client.register()
repo = client.create_repo("my-project")
client.push(repo['id'], {"main.py": "..."})
```

### Day 25-26: Go SDK
**Goal:** Native Go client

**Tasks:**
- [ ] Port Python SDK to Go
- [ ] Use native crypto/ed25519
- [ ] Add context support
- [ ] Write Go SDK tests

**Files to create:**
```
sdk/go/agentscm/
├── client.go
├── crypto.go
└── types.go
```

### Day 27-28: CLI Tool
**Goal:** Command-line interface for agents

**Tasks:**
- [ ] Create CLI using cobra
- [ ] Commands: init, push, log, branches
- [ ] Config file support (~/.agent-scm/config.yaml)
- [ ] Pretty output formatting

**Files to create:**
```
cmd/agent-scm-cli/
├── main.go
└── commands/
    ├── init.go
    ├── push.go
    ├── log.go
    └── branches.go
```

**Validation:**
```bash
agent-scm-cli init
agent-scm-cli push ./my-project
agent-scm-cli log
```

---

## Phase 5: Production Readiness (Week 5-6)

### Week 5: Testing & Performance

**Day 29-31: Comprehensive Testing**
- [ ] Write 100+ unit tests (80% coverage minimum)
- [ ] Write 20+ integration tests
- [ ] Write 5+ E2E tests
- [ ] Add benchmarks for critical paths

**Day 32-33: Load Testing**
- [ ] Set up k6 load tests
- [ ] Test with 100 concurrent agents
- [ ] Profile and optimize bottlenecks
- [ ] Add caching where needed

**Day 34-35: Documentation**
- [ ] API documentation (OpenAPI/Swagger)
- [ ] SDK documentation
- [ ] Deployment guide
- [ ] Troubleshooting guide

### Week 6: Production Features

**Day 36-37: Monitoring & Metrics**
- [ ] Add Prometheus metrics
- [ ] Add structured logging (zerolog)
- [ ] Health check endpoints
- [ ] Database backup scripts

**Day 38-39: Security Hardening**
- [ ] Add rate limiting per agent
- [ ] Add request size limits
- [ ] Add CORS headers
- [ ] Add HTTPS/TLS support
- [ ] Security audit

**Day 40-42: Deployment**
- [ ] Create Dockerfile
- [ ] Create docker-compose.yml
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Production deployment guide
- [ ] Monitoring dashboard

---

## Quick Implementation Checklist

### Core Features (Must Have)
- [x] Content-addressed storage (blobs, trees)
- [x] Agent registration with Ed25519 keys
- [x] Request signing and verification
- [x] Repository creation
- [x] Push endpoint with deduplication
- [x] Diff computation
- [x] Semantic versioning
- [x] Breaking change detection
- [x] Experimental branching
- [x] Commit history
- [x] Python SDK

### Nice to Have
- [ ] JavaScript/Node SDK
- [ ] Branch merging API
- [ ] Webhook notifications
- [ ] GitHub integration
- [ ] Web UI dashboard
- [ ] Garbage collection (unused blobs)

### Production Features
- [ ] Rate limiting
- [ ] Metrics (Prometheus)
- [ ] Logging (structured)
- [ ] TLS/HTTPS
- [ ] Database backups
- [ ] Horizontal scaling

---

## Development Workflow

### Daily Development Loop

```bash
# 1. Start with tests (TDD)
vim tests/unit/new_feature_test.go

# 2. Write failing test
go test ./tests/unit/

# 3. Implement feature
vim pkg/vcs/new_feature.go

# 4. Make test pass
go test ./tests/unit/

# 5. Refactor
vim pkg/vcs/new_feature.go

# 6. Run all tests
make test

# 7. Commit
git add .
git commit -m "Add new feature"
```

### Testing Strategy

```bash
# Run tests frequently
make test-unit           # After each function
make test-integration    # After each endpoint
make test-e2e           # Before commits
make test-load          # Weekly

# Check coverage
make test-coverage
# Target: >80% coverage
```

### Performance Monitoring

```bash
# Profile CPU usage
go test -cpuprofile=cpu.prof -bench=.
go tool pprof cpu.prof

# Profile memory
go test -memprofile=mem.prof -bench=.
go tool pprof mem.prof

# Check binary size
go build -o agent-scm cmd/server/main.go
ls -lh agent-scm
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing
- [ ] Coverage >80%
- [ ] Load tests successful (100 agents, 10min)
- [ ] Security audit complete
- [ ] Documentation complete
- [ ] Database migration scripts ready
- [ ] Backup/restore tested

### Initial Deployment

```bash
# 1. Build Docker image
docker build -t agent-scm:v1.0.0 .

# 2. Run database migrations
sqlite3 /data/agent-scm.db < schema.sql

# 3. Start server
docker run -d \
  -p 8080:8080 \
  -v /data:/data \
  --name agent-scm \
  agent-scm:v1.0.0

# 4. Health check
curl http://localhost:8080/health

# 5. Register test agent
curl -X POST http://localhost:8080/v1/register -d '{...}'
```

### Monitoring Setup

```bash
# 1. Start Prometheus
docker run -d -p 9090:9090 prom/prometheus

# 2. View metrics
curl http://localhost:8080/metrics

# 3. Check logs
docker logs -f agent-scm
```

---

## Troubleshooting Guide

### Common Issues

**Issue: Signature verification fails**
```bash
# Check timestamp skew
date
# Should be within 5 minutes of server time

# Verify public key format
echo $PUBLIC_KEY | wc -c  # Should be 64 hex chars
```

**Issue: Blob storage full**
```bash
# Check disk usage
du -sh /data/blobs

# Run garbage collection
agent-scm-cli gc --dry-run
agent-scm-cli gc
```

**Issue: Slow push times**
```bash
# Profile push endpoint
curl -X POST ... -w "Time: %{time_total}s\n"

# Check blob cache hit rate
curl http://localhost:8080/metrics | grep blob_cache
```

---

## Success Metrics

### Week 1
- [ ] Can register agents
- [ ] Can create repositories
- [ ] Basic storage works

### Week 2
- [ ] Can push files
- [ ] Versions increment correctly
- [ ] Diffs compute accurately

### Week 3
- [ ] Full push flow works end-to-end
- [ ] Experimental branches auto-create
- [ ] Can retrieve commit history

### Week 4
- [ ] Python SDK works
- [ ] Can integrate in real agent code
- [ ] Documentation complete

### Week 5-6
- [ ] Production deployment successful
- [ ] 100 concurrent agents tested
- [ ] Monitoring operational

---

## Next Steps After v1.0

### v1.1 Features
- Branch merging API
- Webhook notifications (agent pushes trigger webhooks)
- Improved breaking change detection (AST parsing)

### v1.2 Features
- Web UI dashboard
- Multi-region replication
- S3 storage backend
- Delta compression (like Git pack files)

### v2.0 Features
- Distributed architecture
- P2P agent sync
- Smart contracts for agent attribution
- Decentralized storage (IPFS)

---

## Revised: MVP-First Timeline (3-4 Weeks)

### Week 1: Core Infrastructure
- [x] Project setup
- [x] Blob storage with deduplication
- [x] SQLite schema
- [x] Agent registration + Ed25519 auth
- [x] Basic HTTP server

**Deliverable:** Can register agents, store blobs

### Week 2: Push Workflow
- [x] Diff engine (hash comparison)
- [x] Simple version bumping (line count only)
- [x] Push endpoint
- [x] Commit creation
- [x] Tree/blob retrieval

**Deliverable:** Can push files, get history

### Week 3: SDK + Polish
- [x] Python SDK
- [x] CLI tool
- [x] Error handling
- [x] Basic tests (unit + integration)
- [x] Documentation

**Deliverable:** Usable by real agents

### Week 4: Production Basics
- [x] Docker deployment
- [x] Rate limiting
- [x] Logging
- [x] Basic monitoring
- [x] Load testing (20 agents)

**Deliverable:** Can deploy and run

**Total: 4 weeks to usable MVP**

### Post-MVP: Iterate Based on Real Usage

**After shipping MVP, gather data:**
```python
# What version bumps did agents actually need?
# Was MINOR/PATCH distinction useful?
# How often did breaking changes occur?
```

**Then add in priority order:**
1. Breaking change detection (if needed)
2. Auto-branching (if agents experiment a lot)
3. Better compression (if storage grows fast)
4. PostgreSQL (if SQLite can't handle load)

---

## Full Feature Timeline (8-10 Weeks)

If you need everything from spec:

### Weeks 1-4: MVP (as above)

### Week 5: Breaking Change Detection
- [ ] Implement regex patterns (Python/JS/Go)
- [ ] Test with real code samples
- [ ] Measure accuracy
- [ ] **Decision point:** Continue or pivot to AST?

### Week 6: Auto-Branching
- [ ] Risk scoring algorithm
- [ ] Experimental branch creation
- [ ] Branch listing/management
- [ ] Branch cleanup strategy

### Week 7: Multi-Language Support
- [ ] JavaScript breaking detection
- [ ] Go breaking detection
- [ ] Test with polyglot repos

### Week 8: Production Hardening
- [ ] Security audit
- [ ] Performance optimization
- [ ] PostgreSQL migration path
- [ ] Backup/restore procedures

### Weeks 9-10: Scale Testing
- [ ] 100 concurrent agents
- [ ] 1000 repos × 1000 commits
- [ ] Fix bottlenecks
- [ ] Production deployment

**Total: 8-10 weeks to full spec**

---

## Decision Points

### Week 0 (After Prototypes)
**Decision:** Proceed with implementation?
- ✅ If prototypes successful
- ❌ If fundamental issues found

### Week 4 (After MVP)
**Decision:** Ship MVP and iterate, or continue to full v1.0?
- **Ship MVP if:** Agents can use it, no critical gaps
- **Continue if:** Breaking detection/branching clearly needed

### Week 5 (After Breaking Detection Attempt)
**Decision:** Keep regex approach or switch to AST?
- **Keep regex if:** >60% accuracy achieved
- **Switch to AST if:** <60% accuracy, tree-sitter integration feasible
- **Abandon if:** Neither approach works well

### Week 8 (Before Production)
**Decision:** Deploy to production?
- ✅ If load tests pass (50+ agents, <1% error rate)
- ⚠️  If minor issues (deploy with warnings)
- ❌ If critical failures (more hardening needed)

---

## Risk Mitigation Strategies

### If Breaking Detection Doesn't Work
**Fallback:** Simple prompt-based versioning
```python
# Let agent specify version bump
client.push(repo, files, bump="major")  # Agent decides
```

### If SQLite Can't Handle Load
**Fallback:** PostgreSQL from start
```diff
- go mod: sqlite3
+ go mod: lib/pq
```
**Cost:** 2-3 days migration work

### If Storage Grows Too Fast
**Fallback 1:** Aggressive compression
```go
// Use zstd instead of gzip
compressed := zstd.Compress(content)  // 20% better ratio
```

**Fallback 2:** LFS-style storage
```python
# Large files go to separate store
if len(content) > 10_MB:
    store_in_s3(content)
```

### If Auto-Branching Creates Chaos
**Fallback:** Manual branching only
```python
# Agent explicitly creates branches
client.push(repo, files, branch="experiment-new-algo")
```

---

## Success Metrics by Week

### Week 1 ✓
- [ ] 100% test pass rate
- [ ] Can store/retrieve 10GB of blobs
- [ ] Auth flow works end-to-end

### Week 2 ✓
- [ ] Can push 100 files in <1 second
- [ ] Deduplication saves >50% space
- [ ] Version bumping works correctly

### Week 3 ✓
- [ ] SDK can complete full workflow
- [ ] Documentation clear enough for external dev to use
- [ ] Zero-state install works

### Week 4 (MVP Complete) ✓
- [ ] 10 agents can push concurrently
- [ ] System stable for 24 hours
- [ ] Can recover from crash

### Week 8 (Full v1.0 Target) ✓
- [ ] 50 agents can push concurrently
- [ ] Breaking detection >60% accurate
- [ ] Auto-branching reduces main branch breaks
- [ ] Production monitoring operational

---

## What Could Go Wrong

### Optimistic Scenario (30% probability)
- Prototypes all succeed
- MVP ships in 3 weeks
- Everything works as designed
- Timeline: 6 weeks total

### Realistic Scenario (50% probability)
- Some prototype challenges
- MVP ships in 4 weeks
- Breaking detection needs iteration
- Timeline: 8-10 weeks total

### Pessimistic Scenario (20% probability)
- Breaking detection doesn't work (need AST)
- SQLite concurrency issues (need PostgreSQL)
- Storage inefficient (need delta compression)
- Timeline: 12+ weeks, or pivot to Git wrapper

---

This roadmap provides a clear path from zero to production-ready agent source control system, **with realistic timelines and clear decision points**. Start with MVP, validate with real usage, then iterate.
