# mmaxr-webxr-client

Single-app WebXR client for MMAXR Lab, organized by internal concern.

## Folder tree

```text
mmaxr-webxr-client/
├── src/
│   ├── scene/
│   ├── interaction/
│   ├── telemetry/
│   ├── coach/
│   ├── recording/
│   └── session/
└── README.md
```

## Development setup

Development requires `mmaxr-infra` to be running and `mmaxr-contracts` linked
as a local file dependency. Configure the `mmaxr-ai` WebSocket endpoint and
`mmaxr-platform` HTTP endpoint in the local `.env` file. Use the endpoint
variable names and values defined by those services; they are not specified
here.

Vite is the build tool. Run `pnpm dev:all` from the repo root (backend, web
client and dashboard together), or `pnpm --filter ./mmaxr-webxr-client dev` for
this client alone. Endpoints can be overridden with `VITE_*` variables (see
`src/config.ts`).

## Client contract

- Consume shared types and schemas from `mmaxr-contracts`.
- Emit xAPI events to `mmaxr-platform`; do not include raw sensor streams in
  xAPI.
- Send coach traffic to `mmaxr-ai` over WebSocket, with voice-channel operation
  modes: proactive, on-request, and off. Do not provide a text interface to the
  AI coach.
- Upload buffered 30 Hz sensor CSV through the `mmaxr-platform`
  `sensor-stream` endpoint.
- Upload explain-back audio to object storage through the platform's configured
  storage flow.
- Target a 72 FPS frame budget on a standalone headset.
- Use pseudonymous identifiers only and keep assessment domain-agnostic.

## Tech stack

- Three.js and WebXR for rendering and immersive browser access.
- `@iwsdk/xr-input` for hand-joint input; the alternative `xrlib` remains open.
- WebSocket for the AI coach connection and `fetch` for platform HTTP requests.
- Standard S3 SDK against MinIO for object storage.
- Vite is recommended; the build framework remains unselected.

## Status

Pure TypeScript + Three.js, no UI framework. Styling follows the Astryx design
system's tokens and conventions (`src/styles/tokens.css`) without depending on
Astryx, which is React-only.

- Sign in / create account / forgot password / delete account (`user-auth`).
- Experiment list from the lesson catalog (`GET /lessons`).
- Interactive chemistry indicator lab: tool selection, prediction gate,
  dropper animation, notebook table, pH paper, reveal; fires `PREDICTED`,
  `ACTED`, `OBSERVED`, `EXPLAINED`, `REVISED_MODEL`, `INVESTIGATED` xAPI events.
- Desktop and phone browsers. Immersive (headset) UI is not built yet.
