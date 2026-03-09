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
- `GET /v1/repos/with-last-commit`
- `GET /v1/repos/:id`
- `GET /v1/repos/:id/status`
- `GET /v1/repos/:id/last-commit`
- `POST /v1/repos/:id/branches`
- `POST /v1/repos/:id/check-hashes`
- `POST /v1/repos/:id/push`
- `GET /v1/repos/:id/commits`
- `GET /v1/repos/:id/commits/:hash`
- `GET /v1/repos/:id/tree`
- `GET /v1/repos/:id/blob/:hash`
- `GET /v1/repos/:id/branches`
- `POST /v1/repos/:id/branches/:name/merge`
- `GET /v1/repos/:id/collaborators`
- `POST /v1/repos/:id/collaborators`
- `POST /v1/repos/:id/pulls`
- `GET /v1/repos/:id/pulls`
- `GET /v1/repos/:id/pulls/:number`
- `POST /v1/repos/:id/pulls/:number/reviews`
- `POST /v1/repos/:id/pulls/:number/merge`
- `POST /v1/repos/:id/pulls/:number/close`
- `POST /v1/projects/identify`
- `POST /v1/repos/:id/project-context`
- `GET /v1/repos/:id/project-context`
- `POST /v1/workspaces/clone`
- `POST /v1/workspaces/status`
- `POST /v1/workspaces/sync`
- `POST /v1/repos/:id/deployments`
- `GET /v1/deploy/templates/docker`
- `GET /v1/deploy/templates`
- `GET /v1/deploy/templates/docker-compose`
- `GET /v1/repos/:id/deployments`
- `GET /v1/repos/:id/deployments/:deploymentId`
- `GET /v1/repos/:id/deployments/:deploymentId/build-jobs`
- `GET /v1/repos/:id/build-jobs/:jobId`
- `GET /v1/repos/:id/build-jobs/:jobId/logs`
- `GET /v1/repos/:id/deployments/:deploymentId/links`
- `POST /v1/repos/:id/secrets`
- `GET /v1/repos/:id/secrets`
- `DELETE /v1/repos/:id/secrets/:key`
- `POST /v1/repos/:id/jobs`
- `GET /v1/repos/:id/jobs`
- `GET /v1/repos/:id/jobs/:jobId`
- `GET /v1/repos/:id/jobs/:jobId/logs`
- `POST /v1/repos/:id/jobs/:jobId/cancel`
- `POST /v1/repos/:id/domains`
- `GET /v1/repos/:id/domains`
- `DELETE /v1/repos/:id/domains/:domain`
- `POST /v1/repos/:id/deployments/:deploymentId/promote`
- `POST /v1/repos/:id/deployment-webhooks`
- `GET /v1/repos/:id/deployment-webhooks`
- `GET /deployments/:id/*`
- `GET /apps/:slug/*`
- `GET /v1/repos/:id/diff`
- `GET /skills`
- `GET /health`
- `GET /metrics`

## Core Behavior

- Full snapshot push flow with server-side dedup and commit creation.
- Semantic versioning engine: `MAJOR/MINOR/PATCH`.
- Regex-based breaking change detection for `.py`, `.js/.ts`, `.go`.
- Risk-scored experimental branching for high-risk changes.
- Auto-generated commit messages when custom message is omitted.
- Collaboration model with `admin/write/read` roles.
- Pull request lifecycle for agent-native review and merge flows.
- Stable project context identification (`project_key`) for autonomous agents.
- Async deployment executor with queued build jobs and webhook callbacks.
- Deployment runtimes: `static` and `docker` with framework-aware template guidance.
- Encrypted repo-scoped secrets with environment support (`dev`, `preview`, `prod`).
- General job runner for shell/docker commands with secret injection and masked logs.
- Runtime proxy support on deployment/app routes for docker-backed services (`/apps/:slug/*`, `/deployments/:id/*`).

## Exclusions

- No SDK packages in this repository.
- No web dashboard.
- No AST parser in v1.0 (regex detector only).

## Operational Notes

- Use `bun run dev` for local development.
- Use `bun test` for test suite.
- Use `bun run check` for static type validation.
- Configure using env vars: `PORT`, `DB_PATH`, `BLOBS_DIR`, `RATE_LIMIT`, `MAX_BLOB_SIZE`, `MAX_REQUEST_AGE`.
