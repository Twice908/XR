# Session

## Purpose

Define client bootstrapping and lifecycle against `mmaxr-platform`
session-auth.

## Responsibilities

- Start the client using the platform session-auth flow.
- Hold the pseudonymous session context needed by internal concerns.
- Coordinate session start, active state, and completion notifications.
- Provide service endpoints through runtime configuration, not hard-coded
  values.

## Interface Contract

- Bootstrap against `mmaxr-platform` session-auth.
- Provide a pseudonymous session context to interaction, telemetry, coach, and
  recording concerns.
- Coordinate session completion with telemetry batch upload and recording
  upload.
- Do not create or expose direct learner identifiers.

## Dependencies

- `mmaxr-platform` session-auth and configured platform endpoints.
- `mmaxr-contracts` session manifest shape.
- Internal telemetry, coach, and recording concerns for session lifecycle.

## Tech Stack

- `fetch` — HTTP communication with `mmaxr-platform`.
- `mmaxr-contracts` — shared session manifest and event contracts.

## Open Questions

- What are the session-auth endpoint, credentials, and token lifecycle?
- Which session manifest fields are required at client boot?
- What should the client do when session authentication or service connectivity
  fails?

## Status: NOT IMPLEMENTED
