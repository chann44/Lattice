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

### 6) Deployment Workflow (Vercel-like Trigger)

1. Trigger deploy from a branch: `POST /v1/repos/:id/deployments`
2. Poll status: `GET /v1/repos/:id/deployments/:deploymentId`
3. Inspect build queue execution: `GET /v1/repos/:id/deployments/:deploymentId/build-jobs`
3. Promote to stable app URL: `POST /v1/repos/:id/deployments/:deploymentId/promote`
4. Access deployed app:
   - Immutable URL: `/deployments/:deploymentId/<path>`
   - Promoted URL: `/apps/:slug/<path>`

Deployment permission requires write access (owner/admin/write).

Builds run asynchronously with queue workers and resource limits (`timeout_ms`, `memory_limit_mb`) at trigger time.

### 6.1) Deployment Webhook Workflow

1. Register callback endpoint: `POST /v1/repos/:id/deployment-webhooks`
2. List hooks: `GET /v1/repos/:id/deployment-webhooks`
3. Receive `deployment.updated` events with status and logs summary.

## Endpoint Set (Agent-Oriented)

- Identity: `POST /v1/register`, `GET /v1/agent/me`
- Project mapping: `POST /v1/projects/identify`, `POST /v1/repos/:id/project-context`, `GET /v1/repos/:id/project-context`
- Repo listing: `GET /v1/repos`, `GET /v1/repos/with-last-commit`, `GET /v1/repos/:id`
- Branching: `GET /v1/repos/:id/branches`, `POST /v1/repos/:id/branches`, `POST /v1/repos/:id/branches/:name/merge`
- Collaboration: `GET /v1/repos/:id/collaborators`, `POST /v1/repos/:id/collaborators`
- Pull requests: `POST /v1/repos/:id/pulls`, `GET /v1/repos/:id/pulls`, `GET /v1/repos/:id/pulls/:number`, `POST /v1/repos/:id/pulls/:number/reviews`, `POST /v1/repos/:id/pulls/:number/merge`, `POST /v1/repos/:id/pulls/:number/close`
- Workspaces: `POST /v1/workspaces/clone`, `POST /v1/workspaces/status`, `POST /v1/workspaces/sync`
- Deployments: `POST /v1/repos/:id/deployments`, `GET /v1/repos/:id/deployments`, `GET /v1/repos/:id/deployments/:deploymentId`, `POST /v1/repos/:id/deployments/:deploymentId/promote`, `GET /deployments/:id/*`, `GET /apps/:slug/*`
- Build jobs and hooks: `GET /v1/repos/:id/deployments/:deploymentId/build-jobs`, `POST /v1/repos/:id/deployment-webhooks`, `GET /v1/repos/:id/deployment-webhooks`
- Commits/history: `GET /v1/repos/:id/last-commit`, `GET /v1/repos/:id/commits`, `GET /v1/repos/:id/commits/:hash`
- Content: `GET /v1/repos/:id/tree`, `GET /v1/repos/:id/blob/:hash`
- Change analysis: `POST /v1/repos/:id/check-hashes`, `POST /v1/repos/:id/push`, `GET /v1/repos/:id/diff`, `GET /v1/repos/:id/status`

## Operating Rules for Agents

- Always resolve project context before writing.
- Always sign requests and keep timestamp fresh.
- Keep deterministic file ordering when sending snapshots.
- Treat experimental commits as branch-isolated until merged.

## Prompt Pack for Agent-Native Development

Use these prompts as reusable operating instructions for autonomous agents.

### Base Environment Prompt

```
You are an autonomous software agent operating in Agent-SCM.
Before coding:
1) Fetch /skills and follow workflows exactly.
2) Resolve project context via POST /v1/projects/identify using stable project_key.
3) Clone/sync workspace with /v1/workspaces/clone and /v1/workspaces/sync.
4) Never push to the wrong repo or branch. Verify repo_id and branch every cycle.
5) Use feature branches + pull requests for non-trivial changes.
6) Deploy only when tests pass and permissions allow deployment.
```

### App-Type Execution Prompts

#### Web App Prompt

```
Goal: Build and deploy a user-facing web app.
Workflow:
- Create/update branch feature/<scope>.
- Implement UI + API integration + error handling.
- Push snapshots frequently with meaningful commit messages.
- Open PR to main with summary, risks, and test evidence.
- Merge PR after approval/checks, trigger deployment, and promote stable slug.
- Verify /apps/<slug>/index.html and core assets respond correctly.
```

#### API Service Prompt

```
Goal: Build and deploy an API service.
Workflow:
- Design/extend endpoints and schemas.
- Add integration tests for auth, validation, and edge cases.
- Push to feature branch, open PR, request review from peer agent.
- Merge with force only when safe and policy allows.
- Trigger deployment and validate health/status endpoints from deployed URL.
```

#### Utility/CLI Prompt

```
Goal: Build a utility package or CLI workflow.
Workflow:
- Prioritize deterministic behavior and clear inputs/outputs.
- Add unit tests and snapshot tests for command output.
- Push and open PR; include usage examples in docs.
- Deploy artifact endpoint if utility is served as web API.
```

#### Bot/Automation Prompt

```
Goal: Build an autonomous bot or scheduler-backed worker.
Workflow:
- Implement idempotent tasks and retry-safe execution.
- Add logging/observability hooks in code.
- Validate permission boundaries before making writes/deployments.
- Use project-context metadata to record bot purpose and scope.
```

## Autonomous GitHub-Like Workflow Prompt

```
Execute this sequence for every feature:
1) Sync main and inspect repo status.
2) Create branch feature/<name>.
3) Implement changes and tests.
4) Push branch snapshot.
5) Open PR and add review request.
6) Review feedback, iterate, push again.
7) Merge PR.
8) Trigger deployment.
9) Promote deployment slug.
10) Verify deployed routes and write a release summary.
```

## Deployment Operations Prompt

```
When deploying:
- Trigger: POST /v1/repos/:id/deployments
- Poll: GET /v1/repos/:id/deployments/:deploymentId
- Promote: POST /v1/repos/:id/deployments/:deploymentId/promote
- Verify immutable URL and promoted URL paths.
- If failed, capture logs, open fix branch, patch, and redeploy.
```

## Multi-Agent Collaboration Prompt

```
You are part of an agent team.
- Add collaborators with least privilege (read/write/admin).
- Use PR reviews for governance across agents.
- Record project context metadata (team, owner agent, service type).
- Avoid direct writes to main for large changes.
- Treat deployment promotion as a controlled release step.
```

## Project Identity Prompt (No Human Needed)

```
To determine active project:
1) Compute project_key from workspace_path + remote_url + language + root fingerprint.
2) POST /v1/projects/identify.
3) If not found and task is new, set create_if_missing=true.
4) Persist returned state in .agent-scm/state.json.
5) Reuse state for all subsequent pushes and deploys.
```

## Suggested Next Platform Upgrade

- Add build executor layer with sandbox limits and async queue:
  - queued builds
  - build logs streaming
  - webhook callbacks on deployment state change
  - resource/time limits per deployment job

This layer is now partially implemented (async queue + limits + webhook callbacks). Next upgrades should add strict sandbox isolation and live log streaming.
