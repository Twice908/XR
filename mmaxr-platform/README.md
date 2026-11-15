# mmaxr-platform

Backend platform scaffold for MMAXR Lab. The platform is split into five
independently deployable HTTP/JSON services and contains documentation only.

## Folder tree

```text
mmaxr-platform/
├── services/
│   ├── session-auth/
│   ├── xapi-emitter/
│   ├── sensor-stream/
│   ├── lrs/
│   └── object-store/
└── README.md
```

## Architecture and technology choice

Services use Node.js and TypeScript for a shared language/runtime across the
HTTP API boundaries and consistent typed integration with
`mmaxr-contracts`. PostgreSQL backs service-owned persistence and the SQL LRS;
Redis is shared for rate limits and idempotency; MinIO backs binary/object
storage. These dependencies are provided by `mmaxr-infra`.

Each service exposes an HTTP/JSON API and owns a separate Postgres schema (or
logical database if required by deployment). Redis is shared, but keys must be
namespaced by service and purpose. No message queue is introduced; direct
HTTP calls and Redis-backed pilot-scale coordination are sufficient.

The LRS remains distinct from MinIO object storage. `sensor-stream` and
`object-store` use MinIO for object data and never connect to the LRS; their
service-owned Postgres schemas are limited to operational/reference metadata.
Raw sensor streams are not xAPI statements.

## Shared `.env` contract

Use a local, untracked `.env` for development configuration. Do not commit
credentials or production secrets. The following names define the proposed
shared configuration contract; exact values and ports come from the running
`mmaxr-infra` setup:

```dotenv
NODE_ENV=development

SESSION_AUTH_PORT=
XAPI_EMITTER_PORT=
SENSOR_STREAM_PORT=
LRS_PORT=
OBJECT_STORE_PORT=

SESSION_AUTH_DATABASE_URL=
XAPI_EMITTER_DATABASE_URL=
SENSOR_STREAM_DATABASE_URL=
LRS_DATABASE_URL=
OBJECT_STORE_DATABASE_URL=

REDIS_URL=
MINIO_ENDPOINT=
MINIO_REGION=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=
MINIO_FORCE_PATH_STYLE=

SQL_LRS_BASE_URL=
SQL_LRS_API_KEY=
MMAXR_CONTRACTS_SCHEMA_PATH=
```

Each service receives only the variables it needs. `*_DATABASE_URL` values
must identify that service's own database or schema. Keep shared credentials
out of logs and API responses. `SQL_LRS_BASE_URL` and its credentials are for
the xAPI forwarding integration; the LRS service itself connects to its
service-owned Postgres schema.

## Migration strategy

- Keep database ownership and migrations inside each service; do not create a
  shared migration project.
- Give each service a dedicated Postgres schema by default. A deployment may
  instead assign a separate logical database, but a service must not write to
  another service's schema.
- Apply versioned, forward-only migrations per service during that service's
  deployment or local startup. Record applied versions in that service's
  migration history.
- Review schema changes for compatibility with active consumers. Coordinate
  breaking API or data-contract changes with downstream projects and bump
  contract versions where applicable.
- Object payloads live in MinIO; do not store raw sensor streams or audio in
  the LRS or service relational tables.

## Local run order

`mmaxr-infra` must already be running with PostgreSQL, Redis, MinIO, and the SQL
LRS available.

1. Configure each service's environment values from the shared `.env` contract.
2. Apply migrations for `session-auth`, `xapi-emitter`, `sensor-stream`,
   `lrs`, and `object-store` against their own schemas.
3. Start `lrs` and `object-store`; verify the SQL LRS and MinIO integration
   paths are available.
4. Start `session-auth`.
5. Start `xapi-emitter` after the LRS and Redis are available; provide the
   matching `mmaxr-contracts` schema.
6. Start `sensor-stream` after MinIO is available.

Services that have no runtime dependency on one another may be started in
parallel after their dependencies are ready.

## Shared constraints

- Use pseudonymous identifiers only.
- Validate xAPI statements against `mmaxr-contracts`; do not put raw sensor
  streams in xAPI.
- Keep analysis deterministic. Do not add machine learning or custom-trained
  models.
- Do not add Kubernetes, curriculum/exam/syllabus coupling, or hard-coded
  subject/topic content.
- Do not merge the LRS and object-store responsibilities.

## Status: NOT IMPLEMENTED
