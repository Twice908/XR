# Session Auth

## Purpose

Define the HTTP/JSON contract for pseudonymous session creation and shared
session timing.

## Responsibilities

- Create pseudonymous assessment sessions without requiring direct learner
  identifiers.
- Provide a shared clock reference for session events.
- Apply Redis-backed rate limiting to session creation and related endpoints.
- Persist service-owned session metadata in its own Postgres schema or logical
  database.

## Interface Contract

- Expose HTTP/JSON session-auth endpoints to authorized clients.
- Return pseudonymous session context and shared clock information.
- Keep rate-limit state in namespaced Redis keys.
- Do not own xAPI statement storage, sensor payload storage, or object storage.

## Dependencies

- PostgreSQL schema or logical database owned by session-auth.
- Shared Redis for rate limiting.
- Client consumers including `mmaxr-webxr-client` and `mmaxr-openxr-client`.

## Tech Stack

- Node.js/TypeScript — shared platform runtime and typed HTTP/JSON boundaries.
- PostgreSQL — service-owned session metadata.
- Redis — shared rate-limit state.

## Open Questions

- Which pseudonymous session fields and lifecycle transitions are required?
- What rate limits, windowing strategy, and client response apply?
- What clock source and precision define the shared session clock?

## Status: NOT IMPLEMENTED
