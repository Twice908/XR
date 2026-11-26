#!/usr/bin/env bash
# Rebuild + redeploy the instructor dashboard to Cloudflare Pages with the backend's public URL baked in.
# Needs `npx wrangler login` once. The web client (project "mmaxr") builds itself from GitHub: set its
# VITE_* variables in Cloudflare > Pages > mmaxr > Settings, then retry the deployment.
# usage: deploy/deploy-frontends.sh https://<machine>.<tailnet>.ts.net [branch]
#   branch defaults to main (production). Any other branch, e.g. gamification, becomes a preview at
#   https://<branch>.mmaxr-dashboard.pages.dev and leaves production untouched.
set -euo pipefail
API="${1:?usage: $0 https://backend-public-url [branch]}"; API="${API%/}"
BRANCH="${2:-main}"
cd "$(dirname "$0")/../mmaxr-analysis/apps/instructor-dashboard"
STATIC_EXPORT=1 NEXT_PUBLIC_API_BASE="$API/rubric-engine" NEXT_PUBLIC_AUTH_BASE="$API/user-auth" NEXT_PUBLIC_REWARDS_BASE="$API/rewards" npx next build
# SPA shells for the dynamic routes (served by public/_redirects; the target must sit outside /sessions/* and /students/*)
mkdir -p out/_shell && cp out/sessions/_.html out/_shell/sessions.html && cp out/students/_.html out/_shell/students.html
npx wrangler@4 pages deploy out --project-name mmaxr-dashboard --branch "$BRANCH" --commit-dirty=true
