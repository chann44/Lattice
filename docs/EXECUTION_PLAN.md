# Execution Plan (One-Go Build)

## Objective

Deliver an end-to-end Agent-SCM backend in one run using Bun + TypeScript + Drizzle + SQLite, with tests and deployment assets, excluding SDKs.

## Task Tracker

- [x] Switch implementation stack to Bun/TypeScript.
- [x] Define Bun-first technical spec update.
- [x] Set up Drizzle schema and SQLite initialization.
- [x] Implement auth middleware (Ed25519 signatures + replay window).
- [x] Implement rate limiting and request validation.
- [x] Implement content-addressed blob store with gzip compression.
- [x] Implement push workflow, diffing, commit generation, and semantic versioning.
- [x] Implement regex-based breaking detection and experimental branching.
- [x] Implement repo/commit/tree/blob/branch/diff API endpoints.
- [x] Add unit and integration tests.
- [ ] Add load test harness.
- [ ] Add Docker/Compose and CI workflow.
- [ ] Run final full verification and record results.

## Verification Gates

1. `bun run check` passes.
2. `bun test` passes.
3. Lifecycle integration test passes (register → repo → push → history).
4. Server boots with default config and exposes `/health`.

## Deferred Enhancements

- AST-based breaking detection.
- Resource quotas + GC job + branch TTL cleaner.
- Advanced merge conflict resolution.
