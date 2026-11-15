# EyeGaze

## Purpose

Define the native eye/gaze dwell capability that distinguishes this Phase 2
client from the WebXR client.

## Responsibilities

- Specify native eye/gaze input and dwell interaction boundaries.
- Make gaze-derived assessment signals available to interaction and telemetry
  concerns.
- Respect runtime/device capability and privacy requirements.
- Keep gaze sampling separate from xAPI event payloads and shared schema types.

## Interface Contract

- Expose gaze/dwell signals through a defined internal boundary.
- Use shared telemetry contracts from `mmaxr-contracts`; do not create
  client-specific schema definitions.
- Keep raw gaze streams out of xAPI and use pseudonymous session context only.

## Dependencies

- OpenXR runtime and target hardware supporting eye/gaze input.
- Interaction and Telemetry concerns.
- Shared sensor schema from `mmaxr-contracts`.

## Tech Stack

- OpenXR — native XR runtime boundary.
- Unity XR APIs or runtime-supported eye-tracking extension — exact API depends
  on target hardware and runtime support.

## Open Questions

- Which devices and runtimes expose compatible eye/gaze data?
- What consent, calibration, sampling, and retention requirements apply?
- Which derived dwell signals are needed without retaining unnecessary raw gaze
  data?

## Status: NOT IMPLEMENTED
