# MMAXR free-tier deployment

## UPDATE — no credit card, no Render/Railway/Oracle
Oracle needs a card for identity verification; Render and Railway trials are used up. Current plan:

1. **Backend = ONE container on your spare laptop** (`deploy/Dockerfile.single`, `docker-compose.single.yml`): all 8 services + Redis + a path gateway on port 8080. Measured locally: builds, all 8 services boot, `/health` and per-service routes answer, ~175 MB RAM idle (services are esbuild-bundled).
2. **Public HTTPS URL for it: Tailscale Funnel** (free, no card, stable `https://<machine>.<tailnet>.ts.net`, supports WebSockets) — `tailscale funnel 8080`. Alternative: Cloudflare Tunnel (named tunnels need a domain you own; quick `trycloudflare` URLs change every restart, testing only). *Not tested here — verify on your laptop.*
3. **Postgres + file storage: Supabase** (no card). **Frontends: Cloudflare Pages + Vercel Hobby** (no card). **Models: Cloudflare R2** (check whether it asks for a card on signup; otherwise Supabase Storage public bucket).
4. **Card-free cloud backup:** Back4app Containers (free, no card per its pricing page; 600 server-hours/month and small RAM — use the same single image). Koyeb's card policy is contradictory in sources; unverified.
5. The **LRS** later goes on the same laptop (it is the same machine, so `LRS_URL=http://host.docker.internal:8080`).

### Live now (Nov 2026)
| Piece | Where | Status |
|---|---|---|
| Postgres | Supabase project `M-XR` (Singapore), session pooler | Done; all services create their tables on boot (tested) |
| Telemetry bucket | Supabase Storage `mmaxr-telemetry` (private, S3 keys in `deploy/.env`) | Done; object-store reaches it (tested) |
| 3D models | Cloudflare Pages `mmaxr-assets.pages.dev` (49 files) + Supabase public bucket `mmaxr-models` (tooth, stomach: >25 MB) | Done; lesson-loader rewrites model URLs via `ASSET_BASE_URL` / `ASSET_OVERRIDES` |
| Web client | Cloudflare Pages `mmaxr.pages.dev`, builds from GitHub branch `main` (production branch) | Live; its `VITE_*` backend URLs still need setting |
| Instructor dashboard | Cloudflare Pages `mmaxr-dashboard.pages.dev` (static export) | Live; rebuild with `deploy/deploy-frontends.sh <backend-url>` |
| Backend container + Tailscale Funnel + LRS | Spare laptop | **Remaining** |

R2 needs a paid plan on file, so it is not used. Pages cannot take files over 25 MB, hence the Supabase bucket for two models.

Trade-off: the laptop must stay on and online, and the public URL is only as reliable as its connection. Sections below describing Oracle/Render are superseded.

Verified in this repo: the Docker image builds and `user-auth` boots and answers `/health`; the compose file validates.
Free-tier numbers are from vendor pages / blogs checked Nov 2026 — **re-check the pricing pages before relying on them**.

## Service → host map

| Piece | Free host | Why / caveat |
|---|---|---|
| Postgres (all services share one `mmaxr` DB; tables are auto-created) | **Supabase** Free | 500 MB, 2 active projects, pauses after ~1 week idle (ping it or upgrade). Use the *Session pooler* URI with `?sslmode=require`. |
| CSV/audio objects (`object-store`, `rubric-engine`) | **Supabase Storage (S3 protocol)** | 1 GB, 5 GB egress/mo. Create bucket `mmaxr-telemetry`; set `S3_ENDPOINT`, `S3_REGION`, keys. |
| Redis (sessions, rate limits) | Container on the VM (128 MB) | Upstash free is the alternative if no VM. |
| 8 Node services incl. WebSocket coach | **Oracle Cloud Always Free** ARM VM (up to 4 OCPU / 24 GB), `docker compose` | Always on, no cold starts, WS fine. Risk: "out of host capacity" in some regions; retry or pick another home region. |
| HTTPS / routing | Caddy in the same compose | Needs a hostname; `<ip>.sslip.io` works free. Mic + WebXR require HTTPS. |
| Web client (Vite static) | **Cloudflare Pages** | Free, global CDN. Build with `VITE_*` vars below. |
| Instructor dashboard (Next 16) | **Vercel Hobby** | Free for non-commercial use. |
| Big GLB models (up to ~29 MB, not in git) | **Cloudflare R2** (10 GB, free egress) | Upload models there and point the client at it (open item — see below). |
| xAPI LRS (Yet SQL LRS) | **Your spare laptop — last** | Expose with Tailscale or Cloudflare Tunnel; its own Postgres (the laptop's, or a second Supabase project). |

**Fallback if Oracle is unavailable:** Render free web services (sleep after idle → cold start, WS drops) + Upstash Redis free. Fly.io no longer has a free tier; Railway is ~$5 credit/month.

**What Supabase does NOT cover:** long-running Node services / WebSockets (Edge Functions are short-lived Deno), Redis, the LRS binary. Supabase Auth is unused — the app has its own `user-auth`.

## Steps
1. Supabase: create project → copy pooler URI; Storage → create bucket `mmaxr-telemetry` → enable S3 connection, make keys.
2. Oracle: create A1.Flex VM (Ubuntu), open 80/443, install Docker, clone repo.
3. `cp deploy/.env.example deploy/.env`, fill secrets (`openssl rand -hex 32` for JWT/INTERNAL keys).
4. `docker compose -f deploy/docker-compose.prod.yml up -d --build`
5. Cloudflare Pages (root `mmaxr-webxr-client`, build `pnpm build`, output `dist`) with:
   ```
   VITE_USER_AUTH_URL=https://API_HOST/user-auth
   VITE_SESSION_AUTH_URL=https://API_HOST/session-auth/auth/session
   VITE_LABS_URL=https://API_HOST/lesson-loader
   VITE_LESSONS_URL=https://API_HOST/lesson-loader/lessons
   VITE_TELEMETRY_URL=https://API_HOST/xapi-emitter/events
   VITE_SENSOR_UPLOAD_URL=https://API_HOST/sensor-stream/upload
   VITE_AI_COACH_WS=wss://API_HOST/coach
   VITE_REWARDS_URL=https://API_HOST/rewards
   ```
   then set `AI_COACH_ALLOWED_ORIGINS` to the Pages URL.

   **Gamification (branch `gamification`).** Card packs, Learning Rings and the collection live on this branch;
   `main` stays the plain client. Turn on preview builds for `gamification` (Pages → `mmaxr` → Settings → Builds →
   Branch control), copy the `VITE_*` variables above into the **Preview** environment, and add the preview URL
   (`https://gamification.mmaxr.pages.dev`) to `AI_COACH_ALLOWED_ORIGINS`. `VITE_GAMIFICATION=false` builds the
   plain client from the same code. The dashboard preview is `deploy/deploy-frontends.sh <backend-url> gamification`
   (→ `https://gamification.mmaxr-dashboard.pages.dev`). The backend serves both clients: the rewards service only
   adds `/rewards/*`.
6. Vercel: import `mmaxr-analysis/apps/instructor-dashboard`, point its API URLs at `API_HOST`.
7. Last: LRS on the laptop, then set `LRS_URL`.

## Open items
- Services use `cors()` open to all origins; tighten to the Pages/Vercel origins before real students.
- Models are git-ignored; decide R2 upload + asset base URL (lesson-loader currently serves `/assets` from disk).
- `object-store` returns a URL built from `S3_ENDPOINT`; Supabase private buckets need signed URLs if the client must fetch them.
- Supabase free DB (500 MB) will fill with xAPI events; plan retention or the LRS move.
