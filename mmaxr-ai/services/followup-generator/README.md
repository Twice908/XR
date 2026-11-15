# Follow-up Generator

## Purpose

Define a post-session service that generates "explain why" questions from a
learner's own action trace without grading the learner.

## Responsibilities

- Retrieve the authorized learner action trace from `mmaxr-platform` LRS query
  API.
- Generate post-session questions grounded in that trace.
- Emit process-pattern flags to `mmaxr-analysis`.
- Reuse the deterministic guardrails package for generated text.
- Avoid grades, scores, canonical-answer disclosure, or direct learner
  identifiers.

## Interface Contract

- Expose an HTTP API for authorized post-session generation requests.
- Consume xAPI verbs and rubric dimension enum from `mmaxr-contracts`.
- Fetch only the requested pseudonymous session's xAPI trace through the
  platform LRS query API.
- Return follow-up questions and process-pattern flags; do not return a grade
  or mastery judgment.
- Send process-pattern flags to `mmaxr-analysis` using its configured API
  contract.

## Dependencies

- `mmaxr-platform` LRS query API.
- `mmaxr-contracts` for verbs and rubric dimensions.
- `mmaxr-analysis` process-pattern flag ingestion contract.
- `packages/guardrails` for deterministic output filtering.
- A generation provider, to be selected.

## Tech Stack

- Node.js/TypeScript — typed HTTP service and shared package runtime.
- HTTP/JSON — request, LRS query, and analysis integration boundaries.
- Generation provider SDK — implementation choice remains open; output is
  filtered through deterministic guardrails.

## Open Questions

- Which provider and model, if any, will generate follow-up questions?
- What LRS query authorization and trace-size limits apply?
- What is the schema and allowed vocabulary for process-pattern flags?
- How are questions validated as trace-grounded without grading?

## Status: NOT IMPLEMENTED
