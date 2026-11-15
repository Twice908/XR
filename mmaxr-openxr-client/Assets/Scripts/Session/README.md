# Session

## Purpose

Define native-client startup and session lifecycle against
`mmaxr-platform` session-auth.

## Responsibilities

- Boot the client through the platform session-auth flow.
- Provide pseudonymous session context to internal concerns.
- Coordinate session lifecycle and completion with telemetry and recording.
- Read service endpoints from environment-appropriate configuration.

## Interface Contract

- Authenticate through `mmaxr-platform` session-auth.
- Consume the shared session manifest contract from `mmaxr-contracts`.
- Provide no direct learner identifiers to client modules.
- Match session lifecycle and backend expectations of the WebXR client.

## Dependencies

- `mmaxr-platform` session-auth.
- `mmaxr-contracts` schemas copied into `Assets/Schemas/`.
- Telemetry, Coach, and Recording concerns.

## Tech Stack

- Unity networking APIs — HTTP session-auth; exact API remains open.
- Newtonsoft.Json — session payload handling against the shared schema.

## Open Questions

- What are the session-auth endpoint, credentials, and token lifecycle?
- Which manifest fields are required for client boot?
- What behavior is required when authentication or backend connectivity fails?

## Status: NOT IMPLEMENTED
