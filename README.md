<p align="center">
  <img src="logo-squared-v5.svg" alt="Squared" width="160" />
</p>

<h1 align="center">Squared</h1>

<p align="center">
  AI-powered real-time speech coaching built on Google Gemini 2.5 Flash Live API
</p>

<p align="center">
  <a href="https://squared-j2gx3ygtta-uc.a.run.app/">Live App</a> · <a href="https://www.youtube.com/watch?v=8bbCrbCSGy0">Demo Video</a>
</p>

---

Squared helps speakers improve through two real-time modes:

- **Rehearsal** — interactive voice feedback where the AI coach listens, watches, and interrupts with coaching cues
- **Presentation** — silent visual-only HUD overlay for live presentations with real-time metrics

Additional capabilities include saved run history, project memory grounded by Gemini, and a native desktop (Electron) client.

Requires camera and microphone permissions.

## Screenshots

| | |
|---|---|
| ![Landing Page](docs/screenshots/CleanShot%202026-03-14%20at%2022.58.24@2x.png) | ![Project Dashboard](docs/screenshots/CleanShot%202026-03-14%20at%2022.59.01@2x.png) |
| **Landing Page** — Google OAuth sign-in | **Project Dashboard** — deck preview, stats, and session launcher |
| ![Rehearsal Mode](docs/screenshots/CleanShot%202026-03-14%20at%2023.01.11@2x.png) | ![Run Analysis](docs/screenshots/CleanShot%202026-03-14%20at%2023.01.19@2x.png) |
| **Rehearsal Mode** — live metrics HUD with AI voice coaching | **Run Analysis** — post-session score breakdown and actionable insights |
| ![Session History](docs/screenshots/CleanShot%202026-03-14%20at%2023.01.28@2x.png) | ![Game Plan](docs/screenshots/CleanShot%202026-03-14%20at%2023.01.42@2x.png) |
| **Session History** — all rehearsal runs with scores and trends | **Game Plan** — per-slide breakdown with issues, cues, and recovery notes |
| ![Predicted Questions](docs/screenshots/CleanShot%202026-03-14%20at%2023.01.53@2x.png) | ![Desktop Audience Agent](docs/screenshots/CleanShot%202026-03-14%20at%2023.02.11@2x.png) |
| **Predicted Questions** — AI-generated audience questions with suggested answers | **Desktop Audience Agent** — screen capture selector for live audience monitoring |
| ![Desktop Rehearsal with Delivery Cues](docs/screenshots/CleanShot%202026-03-14%20at%2023.02.23@2x.png) | ![Desktop Rehearsal with Pattern Memory](docs/screenshots/CleanShot%202026-03-14%20at%2023.02.33@2x.png) |
| **Delivery Cues** — real-time audience-aware coaching overlay | **Pattern Memory** — cross-session coaching that remembers past performance |
| ![Terraform Deploy](docs/screenshots/CleanShot%202026-03-14%20at%2023.33.22@2x.png) | |
| **Infrastructure Deploy** — one-command Terraform + Cloud Run deployment | |

## Local development

### Prerequisites

- `Node.js` 22+
- `npm`
- `Docker`
- `GEMINI_API_KEY`
- Google OAuth client credentials for hosted auth flows

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env defaults:
   ```bash
   cp .env.example .env.local
   ```
3. Start local Postgres:
   ```bash
   npm run db:up
   ```
4. Start the web app and API:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:5173](http://localhost:5173).

### Desktop development

Use:

```bash
npm run dev:desktop
```

In development the Electron shell still talks to the local API server. In packaged production builds it loads the hosted `APP_URL` directly.

## Deployment

Deployment is driven by Terraform plus shell scripts:

- `infra-bootstrap/` creates the remote GCS bucket for Terraform state.
- `infra/` manages Artifact Registry, Cloud Run, Cloud SQL, Secret Manager wiring, and IAM.
- `scripts/bootstrap-secrets.sh` publishes runtime secrets and manages the Cloud SQL app user password.
- `scripts/rotate-db-password.sh` rotates the Cloud SQL password and updates Secret Manager.

Run:

```bash
./scripts/deploy.sh --project=YOUR_GCP_PROJECT --app-url=https://YOUR_SERVICE_URL
```

The deploy flow:

1. enables required GCP APIs
2. ensures the Terraform state bucket exists
3. initializes Terraform with the GCS backend
4. provisions prereqs (Artifact Registry, Cloud SQL, secret containers, IAM)
5. builds and pushes the container image
6. publishes secret versions to Secret Manager
7. applies the full Cloud Run deployment

## Environment variables

Required:

- `GEMINI_API_KEY`
- `APP_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Local development also uses:

- `DATABASE_URL`
- `PGSSLMODE`

Optional:

- `TF_STATE_BUCKET`
- `TF_STATE_BUCKET_LOCATION`
- `TF_STATE_PREFIX`

## Tech stack

- **Frontend:** React 19, TypeScript, Vite 6, Tailwind CSS 4, Motion (animations), Lucide React (icons)
- **Backend:** Express 5, PostgreSQL, Google Gemini Live API
- **Desktop:** Electron 36
- **Infrastructure:** GCP Cloud Run, Cloud SQL, Secret Manager, Artifact Registry, Terraform

## Architecture

### Component Architecture

<p align="center">
  <img src="docs/architecture/Squared — Component Architecture.png" alt="Component Architecture" />
</p>

`App.tsx` routes to three top-level views: **Home** (dashboard with project setup, run analysis, and game plan), **RehearsalMode** (interactive voice coaching via `useLiveAPI`), and **PresentationMode** (silent HUD overlay). Desktop builds add Electron-only components like `DualAgentOverlay` and the Delivery/Audience APIs.

### Real-Time Data Flow

<p align="center">
  <img src="docs/architecture/Squared — Real-Time Data Flow.png" alt="Real-Time Data Flow" />
</p>

Microphone audio (PCM 16 kHz via AudioWorklet) and camera frames (0.5 fps canvas captures) stream over WebSocket to **Gemini 2.5 Flash Live API**. Gemini returns tool calls (`updateIndicators`), AI voice audio, and transcripts. Local **MediaPipe** analysis (468 face + 33 pose landmarks) runs in parallel for eye contact and posture detection. Post-session data persists through the Express API with **pgvector** embeddings for cross-run memory retrieval.

### API Sequence Diagram

<p align="center">
  <img src="docs/architecture/Squared — API Sequence Diagram.png" alt="API Sequence Diagram" />
</p>

Four phases: **Authentication** (Google OAuth callback flow), **Project Setup** (create project + upload PPTX slides), **Live Session** (server mints ephemeral Gemini token, browser opens WebSocket stream), and **Post-Session** (persist run data, generate game plan, compute embeddings for memory similarity).

### GCP Infrastructure

<p align="center">
  <img src="docs/architecture/Squared — GCP Infrastructure.png" alt="GCP Infrastructure" />
</p>

Cloud Run (Node.js 22) serves both the React frontend and Express API. Cloud SQL (PostgreSQL 17 + pgvector) connects via private VPC peering. Secret Manager stores all credentials (Gemini key, OAuth secrets, DB password) with IAM-scoped access. Artifact Registry holds Docker images; GCS stores Terraform state.

## Notes

- Cloud Run reads runtime secrets from Secret Manager.
- Cloud SQL uses private connectivity through Serverless VPC Access; desktop production goes through the hosted app instead of any direct DB path.
- Browser Live sessions use short-lived server-minted Gemini auth tokens instead of exposing the long-lived API key in the frontend bundle.

## License

MIT
