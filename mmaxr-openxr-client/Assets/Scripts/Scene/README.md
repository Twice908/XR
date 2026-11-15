# Scene

## Purpose

Define the native OpenXR client's visual and spatial presentation boundary.

## Responsibilities

- Describe the immersive lab environment, lighting, and visual readouts.
- Present state supplied by session and interaction concerns.
- Preserve performance for the standalone headset target.
- Keep lesson content and assessment logic outside scene presentation.

## Interface Contract

- Consume scene configuration and interaction state from the client.
- Provide presentation to the active OpenXR session.
- Do not define schema types or emit xAPI events.

## Dependencies

- Unity 6.6+ and OpenXR.
- Session and Interaction concerns.
- Shared contracts from `mmaxr-contracts` where scene configuration uses them.

## Tech Stack

- Unity 6.6+ — native application runtime.
- OpenXR — XR session and device integration.
- Single-Pass Instanced rendering — target rendering mode, subject to device
  support.

## Open Questions

- Which standalone headset and graphics profile define the performance target?
- Which scene configuration is shared with the WebXR client?
- What performance budget applies to scene rendering and native gaze input?

## Status: NOT IMPLEMENTED
