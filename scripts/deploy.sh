#!/usr/bin/env bash
set -euo pipefail
trap 'echo ""; echo "ERROR: Deployment failed. Check output above."; exit 1' ERR

REGION="us-central1"
PROJECT=""
STATE_BUCKET=""
STATE_BUCKET_LOCATION="${TF_STATE_BUCKET_LOCATION:-US}"
STATE_PREFIX="${TF_STATE_PREFIX:-squared/infra}"
APP_URL_VALUE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --region) REGION="$2"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --state-bucket) STATE_BUCKET="$2"; shift 2 ;;
    --state-bucket=*) STATE_BUCKET="${1#*=}"; shift ;;
    --app-url) APP_URL_VALUE="$2"; shift 2 ;;
    --app-url=*) APP_URL_VALUE="${1#*=}"; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

for envfile in .env.local .env; do
  if [[ -f "$envfile" ]]; then
    echo "Reading env vars from $envfile..."
    set -a
    source "$envfile"
    set +a
    break
  fi
done

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Error: GEMINI_API_KEY not set. Export it or add to .env / .env.local"
  exit 1
fi

if [[ -z "${GOOGLE_CLIENT_ID:-}" ]] || [[ -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required."
  echo "Run: bash scripts/setup-google-oauth.sh"
  exit 1
fi

if [[ -z "$PROJECT" ]]; then
  PROJECT=$(gcloud config get-value project 2>/dev/null || true)
fi

if [[ -z "$PROJECT" ]]; then
  echo "Error: --project flag required or set via 'gcloud config set project'"
  exit 1
fi

if [[ -z "$APP_URL_VALUE" ]]; then
  APP_URL_VALUE="${APP_URL:-}"
fi

if [[ -z "$APP_URL_VALUE" ]]; then
  APP_URL_VALUE="$(gcloud run services describe squared --project="$PROJECT" --region="$REGION" --format='value(status.url)' 2>/dev/null || true)"
fi

if [[ -z "$APP_URL_VALUE" ]]; then
  echo "Error: APP_URL is required for hosted auth and production desktop routing."
  exit 1
fi

if [[ -z "$STATE_BUCKET" ]]; then
  STATE_BUCKET="${TF_STATE_BUCKET:-${PROJECT}-squared-tfstate}"
fi

echo "═══════════════════════════════════════════════"
echo "  Deploying Squared to GCP"
echo "  Project:       $PROJECT"
echo "  Region:        $REGION"
echo "  App URL:       $APP_URL_VALUE"
echo "  TF state:      gs://$STATE_BUCKET/$STATE_PREFIX"
echo "═══════════════════════════════════════════════"

echo ""
echo "→ Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  compute.googleapis.com \
  servicenetworking.googleapis.com \
  vpcaccess.googleapis.com \
  monitoring.googleapis.com \
  --project="$PROJECT" \
  --quiet

echo ""
echo "→ Ensuring Terraform state bucket exists..."
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" --project="$PROJECT" >/dev/null 2>&1; then
  export TF_VAR_project_id="$PROJECT"
  export TF_VAR_region="$REGION"
  export TF_VAR_state_bucket_name="$STATE_BUCKET"
  export TF_VAR_bucket_location="$STATE_BUCKET_LOCATION"
  terraform -chdir=infra-bootstrap init -input=false
  terraform -chdir=infra-bootstrap apply -auto-approve
fi

echo ""
echo "→ Initializing Terraform backend..."
terraform_init_args=(
  -chdir=infra
  init
  -input=false
  -backend-config="bucket=${STATE_BUCKET}"
  -backend-config="prefix=${STATE_PREFIX}"
)

if [[ -f infra/terraform.tfstate ]]; then
  terraform_init_args+=( -migrate-state -force-copy )
else
  terraform_init_args+=( -reconfigure )
fi

terraform "${terraform_init_args[@]}"

export TF_VAR_project_id="$PROJECT"
export TF_VAR_region="$REGION"
export TF_VAR_google_client_id="$GOOGLE_CLIENT_ID"
export TF_VAR_app_url="$APP_URL_VALUE"
export TF_VAR_image_tag="bootstrap"

if [[ -n "${ALERT_NOTIFICATION_EMAILS:-}" ]]; then
  export TF_VAR_alert_notification_emails="$(node -e "const raw = process.env.ALERT_NOTIFICATION_EMAILS || ''; const values = raw.split(',').map((value) => value.trim()).filter(Boolean); process.stdout.write(JSON.stringify(values));")"
fi

echo ""
echo "→ Provisioning deploy prerequisites..."
terraform -chdir=infra apply -auto-approve \
  -target=google_project_service.required \
  -target=google_artifact_registry_repository.squared \
  -target=google_compute_global_address.private_service_range \
  -target=google_service_networking_connection.private_vpc_connection \
  -target=google_vpc_access_connector.cloud_run \
  -target=google_sql_database_instance.squared \
  -target=google_sql_database.squared \
  -target=google_service_account.cloud_run \
  -target=google_secret_manager_secret.gemini_api_key \
  -target=google_secret_manager_secret.google_client_secret \
  -target=google_secret_manager_secret.database_url \
  -target=google_secret_manager_secret.db_password

IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT}/squared/squared:${IMAGE_TAG}"

echo ""
echo "→ Configuring Docker auth for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet --project="$PROJECT"

echo ""
echo "→ Building Docker image..."
docker build \
  --platform linux/amd64 \
  -t "$IMAGE_URI" \
  .

echo ""
echo "→ Pushing image to Artifact Registry..."
docker push "$IMAGE_URI"

echo ""
echo "→ Publishing runtime secrets..."
bash scripts/bootstrap-secrets.sh \
  --project="$PROJECT" \
  --region="$REGION"

echo ""
echo "→ Deploying Cloud Run service..."
export TF_VAR_image_tag="$IMAGE_TAG"
terraform -chdir=infra apply -auto-approve

echo ""
echo "═══════════════════════════════════════════════"
SERVICE_URL=$(terraform -chdir=infra output -raw service_url)
echo "  Deployed successfully!"
echo "  URL: ${SERVICE_URL}"
echo "═══════════════════════════════════════════════"
