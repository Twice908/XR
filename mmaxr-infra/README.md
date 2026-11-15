# mmaxr-infra

> **LOCAL PILOT ONLY.** This Compose stack is for local development and pilot
> testing only. It is not production-ready. No Kubernetes or managed cloud
> deployment is supported or included.

## What it provides

- One PostgreSQL 16 instance with separate logical databases for platform
  services and the SQL LRS.
- Redis for pilot-scale session state, rate limiting, and idempotency.
- MinIO-compatible AIStor Free for S3-compatible CSV and audio object storage.
- Yet Analytics SQL LRS, backed by the local PostgreSQL instance.

## Prerequisites

- Docker Engine or Docker Desktop with Docker Compose v2 (`docker compose`).
- `curl` for the documented health checks.
- Available localhost ports listed below.

## Step-by-step local boot

1. Copy `.env.example` to `.env`.
2. Replace the local placeholder credentials in `.env`. Keep `.env`
   untracked; never commit real secrets.
3. From this directory, run `./scripts/up.sh`.
4. Wait for Postgres, Redis, and object-store health checks and for SQL LRS to
   finish starting. The LRS may take longer than its database dependency.
5. Create the bucket if it does not already exist. In the object-store console
   at `http://localhost:9001`, sign in with `S3_ACCESS_KEY` and
   `S3_SECRET_KEY`, then create the bucket named by `S3_BUCKET`.
6. Configure downstream local services with the host-facing endpoints from
   `.env.example`. Containers on this Compose network should use service
   hostnames such as `postgres`, `redis`, and `minio` and their container ports.

Postgres initialization creates the service-owned databases
`mmaxr_session_auth`, `mmaxr_xapi_emitter`, `mmaxr_sensor_stream`,
`mmaxr_lrs`, and `mmaxr_object_store`. SQL LRS has a separate `lrsql` database
owned by its dedicated `lrsql` role. Init scripts run only when the Postgres
data volume is first created; changing database credentials later requires a
deliberate credential rotation, not just editing `.env`.

## Port map

| Service | Host port | Container port | Local URL |
|---|---:|---:|---|
| PostgreSQL | 5432 | 5432 | `localhost:5432` |
| Redis | 6379 | 6379 | `localhost:6379` |
| MinIO-compatible S3 API | 9000 | 9000 | `http://localhost:9000` |
| Object-store console | 9001 | 9001 | `http://localhost:9001` |
| SQL LRS xAPI API | 8080 | 8080 | `http://localhost:8080/xapi` |

Ports are bound to loopback. Changing a published port or a shared environment
variable name is a breaking change for downstream projects and requires
coordinated updates.

## Health checks

Run these commands from this directory:

```sh
set -a
. ./.env
set +a
docker compose ps
docker compose exec postgres pg_isready -U "$POSTGRES_USER" -d postgres
docker compose exec redis redis-cli ping
curl --fail http://localhost:9000/minio/health/live
curl --fail --user "$LRS_KEY:$LRS_SECRET" "$LRS_ENDPOINT/about"
```

Postgres, Redis, and MinIO have Compose health checks. The final request checks
the SQL LRS xAPI `about` endpoint using its configured local credentials.

## Shared environment contract

`.env.example` is the canonical local variable-name template. It includes
`POSTGRES_URL`, service-specific database URLs and ports, `REDIS_URL`,
`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `LRS_ENDPOINT`, `LRS_KEY`,
`LRS_SECRET`, the `MINIO_*` aliases used by platform services, and endpoint
stubs for the downstream apps and services. AI-provider keys such as
`OPENAI_API_KEY` and `XAI_API_KEY` are commented out for users to fill in
locally if needed. Do not rename or repurpose shared variables without treating
the change as a breaking interface change.

The official `quay.io/minio/aistor` image is used for MinIO-compatible local
object storage. The MinIO community server is now distributed as source rather
than prebuilt community images; this scaffold uses the official AIStor Free
image, pinned by digest in `.env.example`. Review its current license and
container guidance before use.

The host-facing S3 endpoint is `S3_ENDPOINT`; services running in Compose use
`S3_INTERNAL_ENDPOINT`. SQL LRS uses a separate database and credentials from
platform service databases.

## Key rotation

For local development:

1. Rotate the credential in the owning service (Postgres role, object-store
   root account, or SQL LRS API account) using that service's supported
   administrative interface.
2. Update the matching value in `.env` and all downstream service
   configuration.
3. Recreate affected containers with
   `docker compose up -d --force-recreate <service>` and verify the health
   checks.

Changing `.env` alone does not update credentials stored in persistent
volumes. For a fresh, disposable local pilot, `./scripts/reset.sh` can
reinitialize all state, but it destroys all stored data. This is not a
production secret-rotation procedure.

## Lifecycle scripts

- `./scripts/up.sh` validates configuration and starts the stack.
- `./scripts/down.sh` stops and removes containers but preserves named volumes.
- `./scripts/reset.sh` removes containers and named volumes after confirmation;
  pass `--yes` only when intentionally accepting data loss.

## Status: NOT IMPLEMENTED
