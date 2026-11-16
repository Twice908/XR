# Instructor Dashboard

## Purpose

Define a read-only instructor interface for reviewing assessment process
evidence, deterministic rubric results, follow-up flags, and explain-back audio.

## Responsibilities

- Present a timeline view of the learner's pseudonymous action trace.
- Display rubric scores for all six dimensions with links to their evidence.
- Display process-pattern flags returned by `followup-generator`.
- Provide authorized explain-back audio playback from object storage.
- Keep the dashboard read-only and separate from scoring and generation logic.

## Interface Contract

- Consume rubric results from `rubric-engine`.
- Consume xAPI timeline data from `mmaxr-platform/lrs`.
- Consume process-pattern flags from the follow-up analysis API.
- Resolve audio playback through authorized object-store access.
- Do not call an LLM, calculate scores, mutate records, or expose direct
  identifiers.

## Dependencies

- `rubric-engine` HTTP API.
- `mmaxr-platform` LRS query API.
- `mmaxr-platform` object-store signed URL API.
- Follow-up generator process-pattern flag API.
- `mmaxr-contracts` for shared event and rubric dimension definitions.

## Tech Stack

- React with Vite — proposed lightweight dashboard app; no state-management
  library until the demonstrated needs justify one.
- TypeScript — typed contracts and API response handling.
- Browser audio playback — explain-back review through authorized object
  access.

## Open Questions

- Should the dashboard use React + Vite or Next.js?
- What role and session authorization model applies to instructor access?
- Which timeline filters and evidence navigation affordances are required?
- How are signed audio URLs refreshed during playback?

## Status: NOT IMPLEMENTED
