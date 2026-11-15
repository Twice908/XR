# @mmaxr/domain-simulation

## Purpose

Define a deterministic, domain-swappable simulation contract and manifest
surface without implementing simulation logic.

## Responsibilities

- Specify the stable interface for model state, allowed actions, expected
  outputs, and anomaly definitions.
- Keep any future domain-specific configuration behind the simulation
  interface and only in this package.
- Describe the JSON manifest that a Unity client can load.
- Remain pure TypeScript and JSON configuration, with no rendering code.

## Interface Contract

Placeholder exports:

- `SimulationInterface` — stable contract for model state, allowed actions,
  and expected outputs.
- `AnomalyDefinition` — contract for describing an anomaly.
- JSON manifest — domain-simulation configuration intended for client loading.

Unity consumption path: the Unity client loads the exported JSON manifest as
JSON and uses the plain JSON Schema contracts under
`packages/schema/unity/` as the cross-engine schema reference. No interface
implementation, anomaly definitions, or manifest is included yet.

## Dependencies

- `@mmaxr/schema` for shared event, manifest, and validation contracts as
  applicable.
- JSON configuration for simulation data.
- No rendering engine or domain-specific package dependency.

## Tech Stack

- TypeScript — supports a stable typed simulation interface for the WebXR
  client.
- JSON configuration — provides a language-neutral manifest consumable by
  Unity.
- No rendering code — keeps the simulation contract independent of client
  presentation.

## Open Questions

- What is the minimal stable shape for model state, allowed actions, and
  expected outputs?
- How should the simulation manifest identify its compatible contract version?
- How will deterministic behavior be specified and verified across WebXR and
  Unity consumers?

## Status: NOT IMPLEMENTED
