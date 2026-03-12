#!/usr/bin/env bash
set -euo pipefail

echo "=== Squared — Google OAuth Setup ==="
echo ""

# Get project info
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  echo "Error: No GCP project configured. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi
echo "GCP Project: $PROJECT_ID"

# Enable People API (optional, for user profile access)
echo ""
echo "Enabling People API..."
gcloud services enable "people.googleapis.com" --project="$PROJECT_ID" --quiet 2>/dev/null || echo "  (Skipped — may require additional permissions)"

# Open credentials page
CONSOLE_URL="https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
echo ""
echo "Opening Google Cloud Console..."
echo "  $CONSOLE_URL"
open "$CONSOLE_URL" 2>/dev/null || xdg-open "$CONSOLE_URL" 2>/dev/null || echo "  (Please open the URL above manually)"

echo ""
echo "=== Follow these steps in the browser ==="
echo ""
echo "1. If you don't have an OAuth consent screen yet:"
echo "   - Go to 'OAuth consent screen' (left sidebar)"
echo "   - Select 'External' user type -> Create"
echo "   - App name: Squared, Support email: your email"
echo "   - Save and Continue through all steps"
echo ""
echo "2. Create OAuth Client ID:"
echo "   - Click '+ CREATE CREDENTIALS' -> 'OAuth client ID'"
echo "   - Application type: 'Web application'"
echo "   - Name: 'Squared Web'"
echo "   - Authorized redirect URIs:"
echo "     * http://localhost:5173/api/auth/callback"
echo "     * https://YOUR_PRODUCTION_URL/api/auth/callback"
echo "   - Click 'Create'"
echo ""
echo "3. Copy the Client ID and Client Secret from the dialog."
echo ""

# Read credentials from user
read -r -p "Enter Client ID: " CLIENT_ID
read -r -p "Enter Client Secret: " CLIENT_SECRET

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Error: Client ID and Secret are required."
  exit 1
fi

# Save to .env.local
ENV_FILE=".env.local"
touch "$ENV_FILE"

# Remove old OAuth values if present
grep -v "^GOOGLE_CLIENT_ID=" "$ENV_FILE" | grep -v "^GOOGLE_CLIENT_SECRET=" | grep -v "^# Google OAuth" > "$ENV_FILE.tmp" 2>/dev/null || true
mv "$ENV_FILE.tmp" "$ENV_FILE"

cat >> "$ENV_FILE" << EOF

# Google OAuth
GOOGLE_CLIENT_ID="$CLIENT_ID"
GOOGLE_CLIENT_SECRET="$CLIENT_SECRET"
APP_URL="http://localhost:5173"
EOF

echo ""
echo "  Credentials saved to $ENV_FILE"
echo ""
echo "Done! Run 'npm run dev' to start."
