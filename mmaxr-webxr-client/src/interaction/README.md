# Interaction

## Purpose

Define learner input and action interactions for the WebXR assessment.

## Responsibilities

- Specify hand-joint tracking input.
- Describe prediction marker placement and action triggering.
- Provide hooks for anomaly injection without defining domain-specific
  anomalies.
- Make interaction state available to scene and telemetry concerns.

## Interface Contract

- Provide normalized interaction state to the scene and telemetry concerns.
- Expose prediction placement, action trigger, and anomaly hook boundaries.
- Do not emit xAPI directly or define curriculum- or topic-specific behavior.

## Dependencies

- WebXR input capabilities.
- `@iwsdk/xr-input` is the proposed hand-joint library; `xrlib` is an
  alternative under consideration.
- Scene concern for presenting interaction state.

## Tech Stack

- WebXR — browser XR input and session integration.
- `@iwsdk/xr-input` — proposed access to hand joints; library selection remains
  open.

## Open Questions

- Should hand joints use `@iwsdk/xr-input` or `xrlib`?
- What input capabilities are required when hand tracking is unavailable?
- What stable action shape should be exposed to telemetry and simulation
  contracts?

## Status: NOT IMPLEMENTED
