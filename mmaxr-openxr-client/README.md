# mmaxr-openxr-client

Native Unity + OpenXR client scaffold for MMAXR Lab. This client is deferred to
Phase 2; this repository currently contains documentation and folder
placeholders only.

## Folder tree

```text
mmaxr-openxr-client/
├── Assets/
│   ├── Schemas/
│   └── Scripts/
│       ├── Scene/
│       ├── Interaction/
│       ├── Telemetry/
│       ├── Coach/
│       ├── Recording/
│       ├── Session/
│       └── EyeGaze/
└── ProjectSettings/
```

## XR plugin setup

When implementation begins:

1. Open the project with Unity 6.6 or newer and install the OpenXR Plugin.
2. Enable OpenXR for the intended build target and configure the target runtime
   and required interaction profiles.
3. Install XR Interaction Toolkit 3.x and XR Hands 1.9.0 or newer; configure
   hand tracking features supported by the target runtime.
4. Configure Single-Pass Instanced rendering and the target device's Vulkan +
   Multiview settings. Confirm runtime and device support before relying on
   these options.
5. Add Newtonsoft.Json and the Unity xAPI Wrapper when their versions and
   compatibility have been selected.

Exact package versions beyond the stated minimums and target-device settings
remain to be confirmed.

## Schema sync

Copy the plain JSON Schema files from
`mmaxr-contracts/packages/schema/unity/` into `Assets/Schemas/` when updating
contracts. Treat `mmaxr-contracts` as the sole source of truth: do not recreate
schema types in this client. Review contract changes before syncing and follow
the shared contract versioning and downstream notification policy.

## Backend configuration

Configure the `mmaxr-platform` HTTP endpoint and `mmaxr-ai` WebSocket endpoint
for the selected environment through project-appropriate configuration. Boot
sessions through `mmaxr-platform` session-auth. Do not commit credentials or
environment-specific secrets.

## Interface contract

This client must remain aligned with `mmaxr-webxr-client` and the shared
`mmaxr-contracts` contracts:

- Consume the shared JSON Schemas; use the same session, event, and telemetry
  contract rather than client-specific duplicates.
- Send xAPI events to `mmaxr-platform`; keep raw sensor and gaze streams out of
  xAPI.
- Capture sensor telemetry at 30 Hz and upload it post-session through the
  platform sensor-stream flow.
- Connect to `mmaxr-ai` by WebSocket for the voice channel, supporting
  proactive, on-request, and off modes. Do not add a text interface to the
  coach.
- Upload explain-back audio through the platform's object-store flow.
- Keep identifiers pseudonymous, assessment domain-agnostic, and analysis
  deterministic.

Native eye/gaze dwell is the distinguishing capability of this Phase 2 client.
Access and capture of gaze data must follow runtime capability and privacy
requirements.

## Tech stack

- Unity 6.6+ and OpenXR — native immersive client runtime.
- XR Interaction Toolkit 3.x and XR Hands 1.9.0+ — interaction and hand input.
- Newtonsoft.Json — JSON serialization and schema-backed payload handling.
- Unity xAPI Wrapper — xAPI event integration.
- Single-Pass Instanced rendering with Vulkan + Multiview — target rendering
  configuration, subject to device support.

## Status: NOT IMPLEMENTED
