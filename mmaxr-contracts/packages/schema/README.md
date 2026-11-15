# @mmaxr/schema

## Purpose

Provide the single source of truth for shared assessment and telemetry
contracts, publishable as an npm package for the WebXR client.

## Responsibilities

- Specify the xAPI verb enum and event payload TypeScript types.
- Specify the rubric dimension enum, sensor CSV column names, and session
  manifest shape.
- Provide plain JSON Schema mirrors under `unity/` for Unity clients using
  Newtonsoft.Json.
- Provide a human-readable specification under `docs/`.
- Keep shared contracts pseudonymous and domain-agnostic.

## Interface Contract

Placeholder exports:

- `verbs` — xAPI verb enum.
- `event types` — TypeScript event payload types.
- `rubric enum` — rubric dimension enum.
- `sensor column names` — sensor CSV column specification.
- `session manifest shape` — session manifest type/shape.

Unity consumption path: `packages/schema/unity/` contains the plain JSON Schema
files intended to describe compatible JSON payloads for Newtonsoft.Json
consumers. No schema files are implemented yet.

## Dependencies

- TypeScript type definitions for the npm package surface.
- A web-side runtime validation library; Zod or Ajv remains to be selected.
- No dependency on a specific curriculum, exam, syllabus, subject, or topic.

## Tech Stack

- TypeScript — provides typed contracts in a package publishable to the WebXR
  client.
- JSON Schema under `unity/` — provides a language-neutral mirror consumable by
  Unity with Newtonsoft.Json.
- Zod or Ajv — provides runtime validation on the web side; final selection is
  open.

## Open Questions

- Which runtime validation library, Zod or Ajv, will be used by web consumers?
- What xAPI profile and event payload fields are required?
- Which sensor columns, units, and timestamp conventions define the 30 Hz CSV
  contract?
- What fields and versioning rules belong in the session manifest?

## Status: NOT IMPLEMENTED
