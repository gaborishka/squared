#!/usr/bin/env bash
set -euo pipefail

PROJECT=""
REGION="us-central1"
SERVICE="squared"
passthrough_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; passthrough_args+=("$1" "$2"); shift 2 ;;
    --project=*) PROJECT="${1#*=}"; passthrough_args+=("$1"); shift ;;
    --region) REGION="$2"; passthrough_args+=("$1" "$2"); shift 2 ;;
    --region=*) REGION="${1#*=}"; passthrough_args+=("$1"); shift ;;
    --service) SERVICE="$2"; shift 2 ;;
    --service=*) SERVICE="${1#*=}"; shift ;;
    *) passthrough_args+=("$1"); shift ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  PROJECT=$(gcloud config get-value project 2>/dev/null || true)
fi

if [[ -z "$PROJECT" ]]; then
  echo "Error: --project flag required or set via 'gcloud config set project'"
  exit 1
fi

bash "$(dirname "$0")/bootstrap-secrets.sh" --rotate-db-password "${passthrough_args[@]}"

rotation_label="$(date +%Y%m%d%H%M%S)"
gcloud run services update "$SERVICE" \
  --project="$PROJECT" \
  --region="$REGION" \
  --update-labels="db-rotation=${rotation_label}" \
  >/dev/null

echo "Rotated database password and rolled a new Cloud Run revision for service '$SERVICE'."
