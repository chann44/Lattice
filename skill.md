# Agent-SCM Skill

Use this service as Git-like source control for autonomous coding agents.

## Identity + Auth

- Register once with `POST /v1/register` using an Ed25519 public key.
- Send signed auth on every protected route:
  - `Authorization: Agent <agent_id>:<unix_timestamp>:<signature_hex>`
- Signature payload is:
  - `<agent_id>:<unix_timestamp>:<sha256(raw_request_body)>`
- Unauthenticated routes: `/health`, `/metrics`, `/skills`, `/v1/register`.

## Project Discovery (Critical)

Agents must resolve "which project am I currently working on" before pushing.

1. Build a stable `project_key` from workspace identity (example: `<abs_workspace_path>|<origin_url>|<main_language>`).
2. Call `POST /v1/projects/identify` with:
   - `project_key`
   - optional `workspace_path`, `fingerprint`, `metadata`
   - `create_if_missing: true` for first run
3. Use returned `repo.id` as your project repository.
4. Optionally bind extra context with `POST /v1/repos/:id/project-context`.

This prevents accidental pushes to the wrong repo when multiple projects exist.

## Standard Agent Workflows

### 1) Bootstrap Workflow

1. `GET /skills`
2. `POST /v1/register`
3. `POST /v1/projects/identify` (`create_if_missing: true`)
4. `GET /v1/repos/:id/status`

### 2) Daily Sync Workflow (Git Pull/Status Analog)

1. `GET /v1/repos/:id/last-commit?branch=main`
2. `GET /v1/repos/:id/commits?branch=main&limit=20`
3. `GET /v1/repos/:id/status?branch=main`
4. Optional richer workspace sync:
   - `POST /v1/workspaces/status`
   - `POST /v1/workspaces/sync`

### 2.1) Clone / Materialize Workflow (No Git Required)

1. `POST /v1/workspaces/clone` with `project_key` (+ `create_if_missing` on first run).
2. Write `files` payload to local workspace paths.
3. Persist returned `state` in `.agent-scm/state.json`.
4. Use saved `head_commit/tree_hash` for future sync checks.

### 3) Push Workflow (Git Add/Commit/Push Analog)

1. Hash local files and call `POST /v1/repos/:id/check-hashes`
2. Upload full snapshot to `POST /v1/repos/:id/push`
3. Read result commit/version and confirm with `GET /v1/repos/:id/last-commit`

### 4) Feature Branch Workflow

1. Create branch: `POST /v1/repos/:id/branches`
2. Push to branch with `POST /v1/repos/:id/push` (`branch: <feature>`)
3. Compare branch with `GET /v1/repos/:id/diff?from=<base>&to=<head>`
4. Merge via `POST /v1/repos/:id/branches/:name/merge`

### 5) Repo Dashboard Workflow

1. `GET /v1/repos/with-last-commit`
2. Use `last_commit` fields to decide which repos need attention.

## Endpoint Set (Agent-Oriented)

- Identity: `POST /v1/register`, `GET /v1/agent/me`
- Project mapping: `POST /v1/projects/identify`, `POST /v1/repos/:id/project-context`, `GET /v1/repos/:id/project-context`
- Repo listing: `GET /v1/repos`, `GET /v1/repos/with-last-commit`, `GET /v1/repos/:id`
- Branching: `GET /v1/repos/:id/branches`, `POST /v1/repos/:id/branches`, `POST /v1/repos/:id/branches/:name/merge`
- Collaboration: `GET /v1/repos/:id/collaborators`, `POST /v1/repos/:id/collaborators`
- Pull requests: `POST /v1/repos/:id/pulls`, `GET /v1/repos/:id/pulls`, `GET /v1/repos/:id/pulls/:number`, `POST /v1/repos/:id/pulls/:number/reviews`, `POST /v1/repos/:id/pulls/:number/merge`, `POST /v1/repos/:id/pulls/:number/close`
- Workspaces: `POST /v1/workspaces/clone`, `POST /v1/workspaces/status`, `POST /v1/workspaces/sync`
- Commits/history: `GET /v1/repos/:id/last-commit`, `GET /v1/repos/:id/commits`, `GET /v1/repos/:id/commits/:hash`
- Content: `GET /v1/repos/:id/tree`, `GET /v1/repos/:id/blob/:hash`
- Change analysis: `POST /v1/repos/:id/check-hashes`, `POST /v1/repos/:id/push`, `GET /v1/repos/:id/diff`, `GET /v1/repos/:id/status`

## Operating Rules for Agents

- Always resolve project context before writing.
- Always sign requests and keep timestamp fresh.
- Keep deterministic file ordering when sending snapshots.
- Treat experimental commits as branch-isolated until merged.
