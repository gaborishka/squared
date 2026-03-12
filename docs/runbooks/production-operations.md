# Production Operations Runbook

## Health checks

- Cloud Run health endpoint: `GET /api/health`
- Cloud Monitoring uptime check: `Squared API health`
- Alert policy: `Squared API health check failing`

## Standard deploy

1. Ensure `.env.local` contains `GEMINI_API_KEY`, `APP_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`.
2. Run:
   ```bash
   ./scripts/deploy.sh --project=YOUR_PROJECT --app-url=https://YOUR_SERVICE_URL
   ```
3. Verify:
   - Cloud Run revision becomes healthy
   - `GET https://YOUR_SERVICE_URL/api/health` returns `{"ok":true}`
   - login flow and one authenticated API request succeed

## Rotate database password

1. Run:
   ```bash
   ./scripts/rotate-db-password.sh --project=YOUR_PROJECT --region=us-central1
   ```
2. The script:
   - generates a new password
   - updates the Cloud SQL user
   - publishes new Secret Manager versions for DB password and `DATABASE_URL`
   - forces a new Cloud Run revision
3. Verify the new revision becomes healthy and the app can still create a project and save a run.

## Cloud Run incident recovery

1. Check recent revisions and logs:
   ```bash
   gcloud run services describe squared --region=us-central1
   gcloud run services logs read squared --region=us-central1 --limit=200
   ```
2. If the latest revision is bad, redeploy the previous known-good image tag:
   ```bash
   ./scripts/deploy.sh --project=YOUR_PROJECT --app-url=https://YOUR_SERVICE_URL
   ```
   Set `TF_VAR_image_tag` manually first if you need a specific rollback tag.
3. Confirm `/api/health` and login flow recover.

## Cloud SQL incident recovery

1. Inspect instance status:
   ```bash
   gcloud sql instances describe squared-pg --project=YOUR_PROJECT
   ```
2. Verify the instance has a private IP and is in `RUNNABLE` state.
3. If credentials drifted, rerun:
   ```bash
   ./scripts/bootstrap-secrets.sh --project=YOUR_PROJECT --region=us-central1
   ```
4. If the app still cannot connect, rotate the DB password and redeploy Cloud Run.

## Auth/Gemini troubleshooting

- `401 Unauthorized` from `/api/*`: verify session cookie and OAuth client config.
- `Failed to create Live auth token`: verify `GEMINI_API_KEY` secret exists and the user is authenticated.
- Browser Live session failures after login: verify `/api/live/auth-token` returns `200` for the authenticated session.
