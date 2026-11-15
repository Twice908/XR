# Rubric Engine

## Purpose

Define an HTTP service that deterministically scores the six formative
assessment rubric dimensions over xAPI traces and aligned sensor data.

## Responsibilities

- Retrieve xAPI traces through `mmaxr-platform` LRS query API.
- Retrieve authorized sensor CSVs through object-store signed URLs.
- Normalize and align evidence for deterministic scoring.
- Score prediction discipline, retrieval effort, revision quality, causal
  coherence, metacognitive calibration, and transfer.
- Return per-dimension scores with evidence references that let a human audit
  every score.
- Avoid machine learning and learned scoring.

## Interface Contract

- Expose an HTTP API for authorized rubric evaluation and result retrieval.
- Consume xAPI via `mmaxr-platform/lrs` and sensor CSVs via authorized
  object-store signed URLs.
- Return deterministic, versioned per-dimension scores and evidence
  references, including stable event IDs for trace evidence.
- Use pseudonymous assessment/session identifiers only.
- Do not return or persist direct identifiers or unnecessary raw sensor data.

## Dependencies

- `mmaxr-platform` LRS query API for xAPI statements.
- Object-store signed URLs for aligned sensor CSV data.
- `mmaxr-contracts` for event, sensor, session, and rubric dimension contracts.
- `followup-generator` process-pattern flags where included in analysis
  responses.

## Tech Stack

- Node.js/TypeScript — aligns with platform and shared contract types and
  supports a typed HTTP boundary.
- HTTP/JSON — service API and upstream query interfaces.
- Pure TypeScript functions — deterministic, independently unit-testable
  dimension scoring.

## Open Questions

- What is the normalized evidence shape for xAPI statements and aligned sensor
  samples?
- What score scale, missing-data behavior, and rubric versioning rules apply?
- How should sensor record references be represented for human audit?
- What authorization and pagination limits apply to LRS and object-store data?

## Status: NOT IMPLEMENTED
