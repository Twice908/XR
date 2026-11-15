# Coach

## Purpose

Define the native client's WebSocket boundary to the `mmaxr-ai` voice coach.

## Responsibilities

- Specify the WebSocket connection lifecycle to `mmaxr-ai`.
- Support proactive, on-request, and off voice-channel modes.
- Coordinate coach availability with the active session.
- Keep coach interaction voice-only; do not add a text interface.

## Interface Contract

- Use the `mmaxr-ai` WebSocket endpoint configured for the current environment.
- Match the WebXR client's voice-channel modes and backend contract.
- Do not send raw sensor streams by default or emit xAPI directly.

## Dependencies

- `mmaxr-ai` WebSocket service.
- Session concern for session lifecycle and pseudonymous context.
- Recording concern only where explain-back capture is explicitly coordinated.

## Tech Stack

- .NET WebSocket support available to Unity — coach transport; API choice remains
  open.

## Open Questions

- What message protocol, authentication, and reconnect behavior does
  `mmaxr-ai` require?
- How are coach modes controlled and persisted for a session?
- What voice data, if any, is retained by the coach service?

## Status: NOT IMPLEMENTED
