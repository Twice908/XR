#!/usr/bin/env bash
# Rebuild + redeploy the instructor dashboard to Cloudflare Pages with the backend's public URL baked in.
# Needs `npx wrangler login` once. The web client (project "mmaxr") builds itself from GitHub: set its
# VITE_* variables in Cloudflare > Pages > mmaxr > Settings, then retry the deployment.
# usage: deploy/deploy-frontends.sh https://<machine>.<tailnet>.ts.net
set -euo pipefail
API="${1:?usage: $0 https://backend-public-url}"; API="${API%/}"
cd "$(dirname "$0")/../mmaxr-analysis/apps/instructor-dashboard"
STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE="$API/rubric-engine" NEXT_PUBLIC_AUTH_BASE="$API/user-auth" npx next build
npx wrangler@4 pages deploy out --project-name mmaxr-dashboard --branch main --commit-dirty=true
