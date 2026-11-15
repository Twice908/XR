# LRS

## Purpose

Define a platform wrapper around the SQL Learning Record Store and its
authorized query surface for `mmaxr-analysis`.

## Responsibilities

- Provide the platform's LRS integration boundary backed by SQL LRS and
  Postgres.
- Persist and retrieve xAPI statements through the SQL LRS.
- Expose an authorized query API for `mmaxr-analysis`.
- Keep LRS records distinct from MinIO objects and raw sensor streams.

## Interface Contract

- Provide HTTP/JSON operations for LRS statement access and analysis queries.
- Apply access control and pseudonymous session scoping to query results.
- Treat the SQL LRS as the source for xAPI statements.
- Do not store CSV or binary sensor streams in the LRS.

## Dependencies

- SQL LRS backed by a service-owned Postgres schema or logical database.
- `xapi-emitter` as the statement ingestion/forwarding consumer.
- `mmaxr-analysis` as an authorized query API consumer.

## Tech Stack

- Node.js/TypeScript — typed platform HTTP/JSON wrapper and query boundary.
- PostgreSQL — SQL LRS persistence.
- SQL LRS — xAPI statement storage and query implementation.

## Open Questions

- Which SQL LRS implementation and xAPI profile will be used?
- What query shapes, pagination, and authorization are required by
  `mmaxr-analysis`?
- How are LRS migrations and upgrades coordinated with service-owned schema
  changes?

## Status: NOT IMPLEMENTED
