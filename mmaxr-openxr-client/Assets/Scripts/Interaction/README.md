# Interaction

## Purpose

Define learner interaction boundaries for the native OpenXR assessment client.

## Responsibilities

- Describe XR Interaction Toolkit-based interaction.
- Specify hand input using XR Hands.
- Expose prediction marker placement, action triggering, and anomaly hooks.
- Provide interaction state to scene and telemetry concerns without owning
  scoring.

## Interface Contract

- Use XR Interaction Toolkit 3.x and XR Hands 1.9.0+ input capabilities.
- Expose interactions consistent with `mmaxr-webxr-client` and
  `mmaxr-contracts`.
- Do not duplicate shared schema types or introduce domain-specific lesson
  logic.

## Dependencies

- OpenXR runtime.
- XR Interaction Toolkit 3.x.
- XR Hands 1.9.0+.
- Scene and Telemetry concerns.

## Tech Stack

- XR Interaction Toolkit 3.x — Unity XR interaction primitives.
- XR Hands 1.9.0+ — hand tracking and joint data.
- OpenXR — runtime input integration.

## Open Questions

- Which interaction profiles and hand-tracking capabilities are required?
- What is the fallback behavior when hand tracking is unavailable?
- How should prediction and action events map to shared contract payloads?

## Status: NOT IMPLEMENTED
