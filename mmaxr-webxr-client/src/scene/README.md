# Scene

## Purpose

Define the visual and spatial presentation layer for the WebXR lab environment.

## Responsibilities

- Describe the lab environment and its lighting.
- Specify the spectral readout shader surface.
- Present scene state supplied by other client concerns without owning
  assessment logic.
- Support the standalone-headset target of 72 FPS.

## Interface Contract

- Receive scene configuration and display state from the session and
  interaction concerns.
- Expose a Three.js/WebXR scene surface to the client application.
- Do not emit xAPI events or contain domain-specific lesson content.

## Dependencies

- Three.js and WebXR.
- Session configuration and interaction state.

## Tech Stack

- Three.js — scene graph, materials, lighting, and shader integration.
- WebXR — immersive presentation in supported browsers.

## Open Questions

- What is the minimum standalone-headset graphics profile?
- Which scene settings and spectral readout parameters should be configurable?
- How will the 72 FPS frame budget be measured on target devices?

## Status: NOT IMPLEMENTED
