#!/usr/bin/env bash
set -euo pipefail

PROJECT=""
REGION="us-central1"
ROTATE_DB_PASSWORD=0
DB_INSTANCE_NAME="${DB_INSTANCE_NAME:-squared-pg}"
DB_NAME="${DB_NAME:-squared}"
DB_USER="${DB_USER:-squared}"
PG_SSLMODE_VALUE="${PGSSLMODE:-disable}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --region) REGION="$2"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --db-instance) DB_INSTANCE_NAME="$2"; shift 2 ;;
    --db-instance=*) DB_INSTANCE_NAME="${1#*=}"; shift ;;
    --db-name) DB_NAME="$2"; shift 2 ;;
    --db-name=*) DB_NAME="${1#*=}"; shift ;;
    --db-user) DB_USER="$2"; shift 2 ;;
    --db-user=*) DB_USER="${1#*=}"; shift ;;
    --rotate-db-password) ROTATE_DB_PASSWORD=1; shift ;;
    *) echo "Unknown flag: $1"; exit 1 ;;
  esac
done

for envfile in .env.local .env; do
  if [[ -f "$envfile" ]]; then
    set -a
    source "$envfile"
    set +a
    break
  fi
done

if [[ -z "$PROJECT" ]]; then
  PROJECT=$(gcloud config get-value project 2>/dev/null || true)
fi

if [[ -z "$PROJECT" ]]; then
  echo "Error: --project flag required or set via 'gcloud config set project'"
  exit 1
fi

if [[ -z "${GEMINI_API_KEY:-}" ]]; then
  echo "Error: GEMINI_API_KEY is required."
  exit 1
fi

if [[ -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  echo "Error: GOOGLE_CLIENT_SECRET is required."
  exit 1
fi

SECRET_GEMINI="squared-gemini-api-key"
SECRET_GOOGLE_CLIENT_SECRET="squared-google-client-secret"
SECRET_DB_PASSWORD="squared-db-password"
SECRET_DATABASE_URL="squared-database-url"

ensure_secret() {
  local secret_name="$1"
  if ! gcloud secrets describe "$secret_name" --project="$PROJECT" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" \
      --project="$PROJECT" \
      --replication-policy="automatic" \
      >/dev/null
  fi
}

latest_secret_value() {
  local secret_name="$1"
  gcloud secrets versions access latest \
    --secret="$secret_name" \
    --project="$PROJECT" \
    2>/dev/null || true
}

add_secret_version_if_changed() {
  local secret_name="$1"
  local next_value="$2"
  local current_value
  current_value="$(latest_secret_value "$secret_name")"
  if [[ "$current_value" == "$next_value" ]]; then
    return 0
  fi

  printf '%s' "$next_value" | gcloud secrets versions add "$secret_name" \
    --project="$PROJECT" \
    --data-file=- \
    >/dev/null
}

generate_password() {
  node -e "const crypto = require('crypto'); const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_%@'; const bytes = crypto.randomBytes(24); let out=''; for (let i = 0; i < 24; i += 1) out += chars[bytes[i] % chars.length]; console.log(out);"
}

ensure_secret "$SECRET_GEMINI"
ensure_secret "$SECRET_GOOGLE_CLIENT_SECRET"
ensure_secret "$SECRET_DB_PASSWORD"
ensure_secret "$SECRET_DATABASE_URL"

db_password="$(latest_secret_value "$SECRET_DB_PASSWORD")"
if [[ -z "$db_password" ]] || [[ "$ROTATE_DB_PASSWORD" -eq 1 ]]; then
  db_password="$(generate_password)"
fi

instance_json="$(gcloud sql instances describe "$DB_INSTANCE_NAME" \
  --project="$PROJECT" \
  --format=json)"

private_ip="$(printf '%s' "$instance_json" | node -e "const payload = JSON.parse(require('fs').readFileSync(0, 'utf8')); const addresses = Array.isArray(payload.ipAddresses) ? payload.ipAddresses : []; const match = addresses.find((entry) => entry.type === 'PRIVATE'); if (match?.ipAddress) process.stdout.write(match.ipAddress);")"

if [[ -z "$private_ip" ]]; then
  echo "Error: Cloud SQL instance '$DB_INSTANCE_NAME' does not have a private IP yet."
  exit 1
fi

existing_user="$(gcloud sql users list \
  --instance="$DB_INSTANCE_NAME" \
  --project="$PROJECT" \
  --format='value(name)' \
  | awk -v target="$DB_USER" '$1 == target { print $1; exit }')"

if [[ -z "$existing_user" ]]; then
  gcloud sql users create "$DB_USER" \
    --instance="$DB_INSTANCE_NAME" \
    --password="$db_password" \
    --project="$PROJECT" \
    >/dev/null
else
  gcloud sql users set-password "$DB_USER" \
    --instance="$DB_INSTANCE_NAME" \
    --password="$db_password" \
    --project="$PROJECT" \
    >/dev/null
fi

encoded_password="$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$db_password")"
database_url="postgres://${DB_USER}:${encoded_password}@${private_ip}:5432/${DB_NAME}?sslmode=${PG_SSLMODE_VALUE}"

add_secret_version_if_changed "$SECRET_GEMINI" "$GEMINI_API_KEY"
add_secret_version_if_changed "$SECRET_GOOGLE_CLIENT_SECRET" "$GOOGLE_CLIENT_SECRET"
add_secret_version_if_changed "$SECRET_DB_PASSWORD" "$db_password"
add_secret_version_if_changed "$SECRET_DATABASE_URL" "$database_url"

echo "Secrets bootstrap completed for project '$PROJECT'."
