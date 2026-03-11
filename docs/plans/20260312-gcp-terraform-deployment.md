# GCP Deployment with Terraform IaC

## Overview
Deploy Squared to Google Cloud Run with full Terraform IaC to satisfy hackathon requirements:
- **Mandatory**: at least one Google Cloud service + proof of GCP deployment
- **Bonus**: automated Cloud deployment via scripts/infrastructure-as-code

Single container serves Express backend (API + static frontend). SQLite is ephemeral (acceptable for demo).

## Context
- `server/index.ts` — Express, already reads `PORT` env var (Cloud Run compatible), serves static via `SQUARED_STATIC_DIR`, health check at `/api/health`
- `vite.config.ts` — bakes `GEMINI_API_KEY` into frontend bundle at build time (needs Docker build arg)
- `server/config/paths.ts` — SQLite at `SQUARED_DATA_DIR/database.sqlite`, uploads at `SQUARED_DATA_DIR/uploads/`
- `tsconfig.server.json` — server builds to `dist-server/`
- `package.json` — `npm run build:web` (Vite) + `npm run build:server` (tsc)
- `better-sqlite3` — native Node addon, needs `npm rebuild` in Docker for Linux

## Development Approach
- No tests needed — infrastructure/config files only
- Each task creates specific files and verifies they work
- **CRITICAL: update this plan file when scope changes during implementation**

## Implementation Steps

### Task 1: Create Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [x] Create `.dockerignore` (node_modules, .env*, .git, electron/, release/, dist/, dist-server/, dist-electron/, *.sqlite, .playwright-cli/, build/, infra/, *.tfstate, .terraform/)
- [x] Create multi-stage `Dockerfile`:
  - Stage 1 `builder`: node:22-slim, copy `package.json` + `package-lock.json`, `npm ci`, accept `GEMINI_API_KEY` as build arg, copy source, `npm run build:web`, `npm run build:server`
  - Stage 2 `production`: node:22-slim, copy `package.json` + `package-lock.json`, `npm ci --omit=dev`, rebuild `better-sqlite3` for Linux, copy `dist/` + `dist-server/` from builder, set env vars (`SQUARED_STATIC_DIR=dist`, `SQUARED_DATA_DIR=/data`, `PORT=8080`), expose 8080, CMD `node dist-server/server/index.js`
  - Note: only `dist/`, `dist-server/`, `package.json`, `package-lock.json` needed in production (no TS source)
  - Note: `/tmp` on Cloud Run is tmpfs backed by container memory — keep uploads small for demo
- [x] Test Docker build locally: `docker build --build-arg GEMINI_API_KEY=test -t squared .`
- [x] Test Docker run locally: `docker run -p 8080:8080 squared` → `/api/health` returns `{"ok":true}` ✓

### Task 2: Create Terraform infrastructure

**Files:**
- Create: `infra/main.tf`
- Create: `infra/variables.tf`
- Create: `infra/outputs.tf`

- [x] Create `infra/variables.tf` with: `project_id`, `region` (default `us-central1`), `gemini_api_key` (sensitive), `image_tag` (default `latest`)
- [x] Create `infra/main.tf` with:
  - `google` provider with project and region
  - `google_artifact_registry_repository` — Docker repo named `squared`
  - `google_cloud_run_v2_service` — service named `squared`, container from Artifact Registry image, env vars (`GEMINI_API_KEY`, `SQUARED_STATIC_DIR=dist`, `SQUARED_DATA_DIR=/tmp/data`), 1Gi memory / 1 CPU, startup probe on `/api/health`
  - `google_cloud_run_v2_service_iam_member` — allow unauthenticated access (`allUsers`, `roles/run.invoker`)
- [x] Create `infra/outputs.tf` — output `service_url` from Cloud Run service
- [x] Add to `.gitignore`: `*.tfstate`, `*.tfstate.backup`, `.terraform/`, `.terraform.lock.hcl`
- [x] Verify: `cd infra && terraform init && terraform validate` ✓

### Task 3: Create deploy script

**Files:**
- Create: `scripts/deploy.sh`

- [x] Create `scripts/deploy.sh` with all steps (flags, env parsing, API enable, Docker build/push, Terraform apply, output URL)
- [x] Make executable: `chmod +x scripts/deploy.sh`
- [x] Verify script is syntactically valid: `bash -n scripts/deploy.sh` ✓

### Task 4: Verify end-to-end deployment

- [x] Run `scripts/deploy.sh` against GCP project `agile-stratum-486012-v3`
- [x] Verify Cloud Run service is accessible at https://squared-j2gx3ygtta-uc.a.run.app
- [x] Verify `/api/health` returns `{"ok":true}` ✓
- [ ] Verify frontend loads and connects to Gemini

### Task 5: Update documentation

- [x] Add "Deployment" section to `CLAUDE.md` with:
  - Prerequisites (gcloud CLI, Terraform, Docker, GCP project)
  - Quick deploy: `./scripts/deploy.sh --project=YOUR_PROJECT`
  - Architecture note: single Cloud Run container
- [ ] Move this plan to `docs/plans/completed/`

## Technical Details

### Docker image structure
```
/app
├── dist/               # Vite-built frontend (static)
├── dist-server/        # Compiled Express server
│   └── server/
│       └── index.js    # Entry point
├── node_modules/       # Production deps only (with better-sqlite3 rebuilt for Linux)
├── package.json
├── package-lock.json
└── /data               # Runtime: SQLite + uploads (ephemeral, tmpfs)
```

### Environment variables on Cloud Run
| Variable | Source | Purpose |
|----------|--------|---------|
| `PORT` | Cloud Run (auto) | Server listen port |
| `GEMINI_API_KEY` | Terraform var → Cloud Run env | Gemini API (runtime for future, build-time for current frontend) |
| `SQUARED_STATIC_DIR` | Hardcoded `dist` | Serve frontend |
| `SQUARED_DATA_DIR` | Hardcoded `/tmp/data` | SQLite + uploads |

### Terraform resources
1. `google_artifact_registry_repository` — Docker image storage
2. `google_cloud_run_v2_service` — container hosting
3. `google_cloud_run_v2_service_iam_member` — public access

## Post-Completion
- Screen-record the `deploy.sh` execution for hackathon submission proof
- Create architecture diagram showing: User → Cloud Run → Express → (Gemini Live API, SQLite)
- Consider adding Cloud Build trigger for CI/CD (bonus but not required)
