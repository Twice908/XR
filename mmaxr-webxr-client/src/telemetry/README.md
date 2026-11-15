# Telemetry

## Purpose

Describe how assessment events and sampled sensor data are buffered and sent to
`mmaxr-platform`.

## Responsibilities

- Emit xAPI events using verbs and payload contracts from `mmaxr-contracts`.
- Buffer sensor CSV at 30 Hz.
- Batch-upload sensor CSV after the session through the platform
  `sensor-stream` endpoint.
- Keep raw sensor streams out of xAPI and use pseudonymous identifiers only.

## Interface Contract

- Accept assessment events and interaction/sensor samples from session,
  interaction, and recording concerns as applicable.
- Send xAPI events to `mmaxr-platform`.
- Upload the 30 Hz CSV buffer as a post-session batch to
  `mmaxr-platform` `sensor-stream`.
- Preserve event and sample ordering as required by the shared contracts.

## Dependencies

- `mmaxr-contracts` for xAPI event and sensor CSV contracts.
- `mmaxr-platform` for event emission and sensor-stream upload.
- Interaction and session concerns as data sources.

## Tech Stack

- `fetch` — HTTP requests to `mmaxr-platform`.
- xAPI — assessment event representation.
- CSV sampled at 30 Hz — sensor telemetry representation.

## Open Questions

- What are the platform endpoint paths, authentication requirements, and
  retry/acknowledgment semantics?
- Which sensor columns and timestamp conventions are defined by
  `mmaxr-contracts`?
- What are the maximum batch size and local-buffer retention requirements?

## Status: NOT IMPLEMENTED
