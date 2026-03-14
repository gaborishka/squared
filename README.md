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

## Notes

- Cloud Run reads runtime secrets from Secret Manager.
- Cloud SQL uses private connectivity through Serverless VPC Access; desktop production goes through the hosted app instead of any direct DB path.
- Browser Live sessions use short-lived server-minted Gemini auth tokens instead of exposing the long-lived API key in the frontend bundle.

## License

MIT
