# Agent-SCM Technical Spec (Bun Edition)

## Scope Changes

- Runtime stack is now `Bun + TypeScript + Hono + Drizzle + SQLite`.
- SDK deliverables are removed for v1.0. Agents integrate via HTTP API directly.
- Core v1.0 API and behavior remain aligned with original spec where practical.

## Implementation Stack

- API Server: Bun `Bun.serve()` with Hono route layer.
- Database: SQLite in WAL mode, accessed through Drizzle ORM.
- Blob Storage: filesystem content-addressed storage (`/data/blobs/ab/cd/hash`).
- Auth: Ed25519 request signatures verified server-side.
- Validation: Zod request schemas.

## API Surface

Implemented endpoints:

- `POST /v1/register`
- `GET /v1/agent/me`
- `POST /v1/repos`
- `GET /v1/repos`
- `GET /v1/repos/:id`
- `POST /v1/repos/:id/check-hashes`
- `POST /v1/repos/:id/push`
- `GET /v1/repos/:id/commits`
- `GET /v1/repos/:id/commits/:hash`
- `GET /v1/repos/:id/tree`
- `GET /v1/repos/:id/blob/:hash`
- `GET /v1/repos/:id/branches`
- `POST /v1/repos/:id/branches/:name/merge`
- `GET /v1/repos/:id/diff`
- `GET /health`
- `GET /metrics`

## Core Behavior

- Full snapshot push flow with server-side dedup and commit creation.
- Semantic versioning engine: `MAJOR/MINOR/PATCH`.
- Regex-based breaking change detection for `.py`, `.js/.ts`, `.go`.
- Risk-scored experimental branching for high-risk changes.
- Auto-generated commit messages when custom message is omitted.

## Exclusions

- No SDK packages in this repository.
- No web dashboard.
- No AST parser in v1.0 (regex detector only).

## Operational Notes

- Use `bun run dev` for local development.
- Use `bun test` for test suite.
- Use `bun run check` for static type validation.
- Configure using env vars: `PORT`, `DB_PATH`, `BLOBS_DIR`, `RATE_LIMIT`, `MAX_BLOB_SIZE`, `MAX_REQUEST_AGE`.
