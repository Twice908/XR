# Coach

## Purpose

Define the voice-channel client connection to `mmaxr-ai` without adding a text
interface.

## Responsibilities

- Specify a WebSocket connection to the `mmaxr-ai` service.
- Support proactive, on-request, and off coach modes.
- Define the voice-channel boundary and its relationship to the active session.
- Keep coaching interaction separate from raw sensor telemetry and xAPI
  emission.

## Interface Contract

- Connect to the configured `mmaxr-ai` WebSocket endpoint.
- Expose voice-channel operations and the three supported modes to the client.
- Do not expose a text-chat interface.
- Do not place raw sensor streams in xAPI or send them to the coach by default.

## Dependencies

- `mmaxr-ai` WebSocket service.
- Session concern for session lifecycle and pseudonymous context.
- Recording concern where voice capture is explicitly part of explain-back.

## Tech Stack

- WebSocket — bidirectional connection to `mmaxr-ai`.
- Browser voice capabilities — voice-channel interaction; concrete APIs remain
  open.

## Open Questions

- What message protocol, authentication, and reconnection behavior does
  `mmaxr-ai` require?
- How are proactive and on-request modes enabled and disabled by session
  policy?
- What voice data, if any, is retained by the coach service?

## Status: NOT IMPLEMENTED
