# xAPI Emitter

## Purpose

Define an HTTP/JSON ingestion service for client xAPI statements and forwarding
to the Learning Record Store.

## Responsibilities

- Receive client xAPI events.
- Validate statements against the versioned schema from `mmaxr-contracts`.
- Forward accepted statements to the LRS.
- Use Redis idempotency keys to prevent duplicate statement forwarding.
- Keep raw sensor streams out of xAPI.

## Interface Contract

- Accept HTTP/JSON xAPI statements from clients.
- Reject invalid statements according to the selected contract version.
- Forward valid statements to the configured SQL LRS endpoint.
- Use namespaced Redis keys for idempotency; define key scope and retention
  before implementation.
- Do not store raw sensor CSV or binary sensor data in xAPI.

## Dependencies

- `mmaxr-contracts` schema as the source of truth for event validation.
- Shared Redis for idempotency.
- SQL LRS endpoint for statement persistence.
- Service-owned Postgres schema or logical database for any emitter-owned
  operational metadata.

## Tech Stack

- Node.js/TypeScript — typed HTTP/JSON ingestion and schema integration.
- `mmaxr-contracts` — canonical xAPI event schema.
- Redis — idempotency state.
- SQL LRS — durable xAPI statement store.

## Open Questions

- Which schema versions are accepted concurrently during rollout?
- What idempotency key, scope, and retention period are required?
- What LRS failure and retry response semantics should clients observe?

## Status: NOT IMPLEMENTED
