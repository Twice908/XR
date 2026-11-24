# Spare-laptop setup (backend + public URL)

Runs the 8 Node services + Redis + gateway as ONE Docker container (~175 MB RAM). Postgres and storage stay on Supabase.

## 1. Install (once)
| Tool | Why | Get it |
|---|---|---|
| Docker Desktop (Mac/Windows) or Docker Engine + compose plugin (Linux) | runs the backend container | docker.com |
| Git | clone the repo | git-scm.com |
| Tailscale | free public HTTPS URL (Funnel), no card, no domain | tailscale.com/download |

## 2. Get the code and the secrets
```bash
git clone https://github.com/Twice908/XR.git && cd XR && git checkout main
```
`deploy/.env` is **git-ignored**. Copy it from your main Mac (AirDrop / USB / password manager) to `XR/deploy/.env` on the laptop. Do not email or commit it. It holds the Supabase password + S3 keys, JWT/INTERNAL keys and the model URLs.
Add your AI coach key there too (`GEMINI_API_KEY`, or `CLAUDE_API_KEY` / `OPENAI_API_KEY` and `AI_COACH_PROVIDER`), and set
`AI_COACH_ALLOWED_ORIGINS=https://mmaxr.pages.dev` (comma-separate more origins if needed).

## 3. Start the backend
```bash
docker compose -f deploy/docker-compose.single.yml up -d --build
curl localhost:8080/health          # -> ok
curl localhost:8080/lesson-loader/health
docker compose -f deploy/docker-compose.single.yml logs -f   # expect "Database connected", "Connected to Redis"
```
(`HOST_PORT=8099 ...` if 8080 is busy.) `restart: unless-stopped` brings it back after a reboot once Docker starts.

## 4. Public HTTPS URL with Tailscale Funnel
1. Install Tailscale and sign in (Google/GitHub login).
2. In the admin console (login.tailscale.com/admin): **DNS** -> enable MagicDNS + HTTPS certificates; then in **Access controls** allow Funnel for this device (the console offers a one-click "Enable Funnel" prompt the first time you run the command below).
3. Run:
```bash
tailscale funnel --bg 8080
tailscale funnel status      # shows https://<laptop>.<tailnet>.ts.net
```
4. Test from your phone on mobile data: `https://<laptop>.<tailnet>.ts.net/lesson-loader/health`.

## 5. Point the frontends at it (from your main Mac)
- Cloudflare -> Pages -> `mmaxr` -> Settings -> Variables and secrets (Production), with `API=https://<laptop>.<tailnet>.ts.net`:
```
VITE_USER_AUTH_URL=$API/user-auth
VITE_SESSION_AUTH_URL=$API/session-auth/auth/session
VITE_LABS_URL=$API/lesson-loader
VITE_LESSONS_URL=$API/lesson-loader/lessons
VITE_TELEMETRY_URL=$API/xapi-emitter/events
VITE_SENSOR_UPLOAD_URL=$API/sensor-stream/upload
VITE_AI_COACH_WS=wss://<laptop>.<tailnet>.ts.net/coach
```
  then Deployments -> Retry (or push to `main`).
- Dashboard: `deploy/deploy-frontends.sh https://<laptop>.<tailnet>.ts.net`

## 6. Keep it alive
- Plug in power; set sleep to "never" on AC (Mac: System Settings -> Battery/Lock Screen; Windows: Power & sleep; Linux: `systemctl mask sleep.target`).
- Docker Desktop -> Settings -> start at login. Tailscale -> run at login.
- Funnel persists across reboots with `--bg`.

## 7. Later: the LRS (Yet SQL LRS) on the same laptop
Reuse `mmaxr-infra/` (its own Postgres + `sql-lrs`, ARM64 image note in its README), then add `LRS_URL=http://host.docker.internal:8080` to `deploy/.env`.
