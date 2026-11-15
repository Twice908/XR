# Telemetry

## Purpose

Define capture and upload boundaries for shared assessment events and native
sensor telemetry.

## Responsibilities

- Emit xAPI events using the Unity xAPI Wrapper and shared contract definitions.
- Buffer sensor data at 30 Hz for post-session upload.
- Keep raw sensor and gaze streams separate from xAPI.
- Use pseudonymous identifiers and preserve event/sample timing.

## Interface Contract

- Consume event and sensor contract definitions from JSON Schemas synced from
  `mmaxr-contracts/packages/schema/unity/` into `Assets/Schemas/`.
- Send xAPI events to `mmaxr-platform`.
- Upload 30 Hz sensor CSV after the session through the platform sensor-stream
  flow.
- Match the WebXR client's backend contract; do not introduce client-specific
  event definitions.

## Dependencies

- Unity xAPI Wrapper.
- `mmaxr-contracts` JSON Schemas copied into `Assets/Schemas/`.
- `mmaxr-platform` event and sensor-stream endpoints.
- Interaction and EyeGaze concerns as data sources.

## Tech Stack

- Unity xAPI Wrapper — xAPI event integration.
- Newtonsoft.Json — JSON payload handling.
- Unity-supported CSV handling — 30 Hz sensor buffer format, details open.

## Open Questions

- Which sensor and gaze fields and units are required by the shared contract?
- What are platform authentication, batch-size, retry, and acknowledgment
  requirements?
- How will timing remain consistent between xAPI events and sensor samples?

## Status: NOT IMPLEMENTED
