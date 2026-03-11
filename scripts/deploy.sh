#!/usr/bin/env bash
set -euo pipefail
trap 'echo ""; echo "ERROR: Deployment failed. Check output above."; exit 1' ERR

# ─── Defaults ───────────────────────────────────────────────────────────────────
REGION="us-central1"
PROJECT=""

# ─── Parse flags ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --region) REGION="$2"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

# ─── Resolve GEMINI_API_KEY ─────────────────────────────────────────────────────
if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  for envfile in .env.local .env; do
    if [[ -f "$envfile" ]]; then
      echo "Reading GEMINI_API_KEY from $envfile..."
      set -a; source "$envfile"; set +a
      break
    fi
  done
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Error: GEMINI_API_KEY not set. Export it or add to .env / .env.local"
  exit 1
fi

# ─── Resolve project ────────────────────────────────────────────────────────────
if [[ -z "$PROJECT" ]]; then
  PROJECT=$(gcloud config get-value project 2>/dev/null || true)
fi

if [[ -z "$PROJECT" ]]; then
  echo "Error: --project flag required or set via 'gcloud config set project'"
  exit 1
fi

echo "═══════════════════════════════════════════════"
echo "  Deploying Squared to GCP"
echo "  Project: $PROJECT"
echo "  Region:  $REGION"
echo "═══════════════════════════════════════════════"

# ─── Enable required APIs ────────────────────────────────────────────────────────
echo ""
echo "→ Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT" \
  --quiet

# ─── Terraform init + create Artifact Registry ──────────────────────────────────
export TF_VAR_project_id="$PROJECT"
export TF_VAR_region="$REGION"
export TF_VAR_gemini_api_key="$GEMINI_API_KEY"

echo ""
echo "→ Initializing Terraform..."
terraform -chdir=infra init -input=false

echo ""
echo "→ Creating Artifact Registry (if needed)..."
terraform -chdir=infra apply -auto-approve \
  -var="image_tag=bootstrap" \
  -target=google_artifact_registry_repository.squared

# ─── Build and push Docker image ────────────────────────────────────────────────
IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT}/squared/squared:${IMAGE_TAG}"

echo ""
echo "→ Configuring Docker auth for Artifact Registry..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet --project="$PROJECT"

echo ""
echo "→ Building Docker image..."
export GEMINI_API_KEY
docker build \
  --build-arg GEMINI_API_KEY \
  --platform linux/amd64 \
  -t "$IMAGE_URI" \
  .

echo ""
echo "→ Pushing image to Artifact Registry..."
docker push "$IMAGE_URI"

# ─── Terraform apply (full) ──────────────────────────────────────────────────────
echo ""
echo "→ Deploying Cloud Run service..."
export TF_VAR_image_tag="$IMAGE_TAG"
terraform -chdir=infra apply -auto-approve

# ─── Output ──────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════"
SERVICE_URL=$(terraform -chdir=infra output -raw service_url)
echo "  Deployed successfully!"
echo "  URL: ${SERVICE_URL}"
echo "═══════════════════════════════════════════════"
