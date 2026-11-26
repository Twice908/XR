#!/usr/bin/env bash
# Runs redis, the 9 services and a gateway on $PORT (Render injects PORT). Exits if any child dies so the host restarts it.
set -u
cd /app
export NODE_OPTIONS="--max-old-space-size=40"
redis-server --save "" --appendonly no --maxmemory 48mb --maxmemory-policy allkeys-lru --daemonize no &
run() { (cd "$1" && PORT="$2" exec node dist/index.cjs) & }
run mmaxr-platform/services/session-auth 3004
run mmaxr-platform/services/xapi-emitter 3001
run mmaxr-platform/services/object-store 3006
run mmaxr-platform/services/sensor-stream 3005
run mmaxr-platform/services/lesson-loader 3007
run mmaxr-platform/services/user-auth 3008
run mmaxr-platform/services/rewards 3009
run mmaxr-analysis/services/rubric-engine 3002
run mmaxr-ai/services/ai-coach 3003
caddy run --config deploy/Caddyfile.single --adapter caddyfile &
wait -n
echo "a child exited; stopping" >&2
kill 0
