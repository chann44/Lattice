# Agent-SCM (Bun + TypeScript)

Project name: Lattice.

Server-first Agent-SCM implementation using Bun, Hono, Drizzle, and SQLite.

## Quick Start

```bash
bun install
bun run dev
```

Server starts on `http://localhost:8080` by default.

## Commands

```bash
bun run dev
bun run start
bun run check
bun test
```

## Configuration

- `PORT` (default `8080`)
- `DB_PATH` (default `./data/agent-scm.db`)
- `BLOBS_DIR` (default `./data/blobs`)
- `MAX_BLOB_SIZE` (default `52428800`)
- `RATE_LIMIT` (default `100`)
- `MAX_REQUEST_AGE` (default `300`)

## Documentation

- `docs/TECH_SPEC_BUN.md` active technical spec
- `docs/EXECUTION_PLAN.md` execution tracker
- `docs/README.md` complete docs index
