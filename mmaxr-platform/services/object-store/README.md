# Object Store

## Purpose

Define an S3-compatible abstraction over MinIO for client and service object
upload and download workflows.

## Responsibilities

- Generate signed URLs for CSV and audio objects.
- Provide a controlled S3-compatible interface over MinIO.
- Keep object metadata and authorization aligned with pseudonymous sessions.
- Keep service-owned object reference metadata in its own Postgres schema or
  logical database; keep object contents in MinIO.
- Remain separate from the SQL LRS and xAPI statement path.

## Interface Contract

- Expose HTTP/JSON operations for authorized signed URL generation.
- Accept internal file forwarding at `POST /upload/base64` with `filename`,
  `contentType`, and `fileBase64` fields.
- Read and write objects through MinIO only; do not call or write to the LRS.
- Support CSV and explain-back audio object workflows.
- Do not expose MinIO credentials to clients or place raw object contents in
  xAPI.

## Dependencies

- MinIO for S3-compatible object storage.
- Shared Redis only if needed for namespaced rate limiting or idempotency.
- Service-owned Postgres schema or logical database for object reference
  metadata.

## Tech Stack

- Node.js/TypeScript — HTTP/JSON signed-URL API.
- S3-compatible SDK — signed URL generation and MinIO integration.
- MinIO — CSV and audio object storage.

## Open Questions

- Which signed URL operations, expiration limits, and authorization policies
  are required?
- How should object keys map to pseudonymous sessions without exposing
  identifiers?
- Which audio and CSV retention, deletion, and content-validation policies
  apply?

## Status: NOT IMPLEMENTED
