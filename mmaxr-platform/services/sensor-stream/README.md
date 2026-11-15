# Sensor Stream

## Purpose

Define post-session ingestion and object storage of sensor telemetry, separate
from xAPI statement handling.

## Responsibilities

- Accept post-session CSV and binary sensor uploads.
- Store uploaded objects in MinIO.
- Write a session manifest linking the stored telemetry to the pseudonymous
  xAPI session ID.
- Keep upload and manifest reference metadata in its own Postgres schema or
  logical database; keep object contents in MinIO.
- Keep raw sensor content out of the LRS and xAPI statements.

## Interface Contract

- Expose HTTP/JSON upload and completion endpoints for post-session data.
- Write data objects and the related manifest to MinIO only; do not call or
  write to the LRS.
- Link data using pseudonymous session identifiers and the xAPI session ID.
- Return upload/storage status without exposing object-store credentials.

## Dependencies

- MinIO for sensor objects and session manifests.
- Shared Redis if required for namespaced upload idempotency or coordination.
- Service-owned Postgres schema or logical database for upload and manifest
  reference metadata.
- `mmaxr-contracts` for the shared session-manifest and sensor-column
  contracts.

## Tech Stack

- Node.js/TypeScript — HTTP/JSON upload coordination.
- S3-compatible SDK — MinIO object operations.
- MinIO — CSV, binary telemetry, and manifest object storage.

## Open Questions

- Which upload formats, maximum sizes, and content validation rules apply?
- Which manifest fields need a Postgres reference in addition to the manifest
  object stored in MinIO?
- How are partial uploads, retries, retention, and deletion handled?

## Status: NOT IMPLEMENTED
