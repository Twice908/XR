# AI Coach

## Purpose

Define the voice-only, real-time coaching service boundary for the MMAXR Lab
assessment client.

## Responsibilities

- Provide a WebSocket voice channel using the selected voice LLM provider.
- Scope provider context to authorized session configuration; keep domain
  content out of shared service logic.
- Support instructor-configurable `proactive`, `on-request`, and `off`
  intervention modes.
- Consume session-auth tokens and keep session state in Redis.
- Pass every learner-facing output through the deterministic guardrails
  package.
- Never state numerical values or canonical answers.

## Interface Contract

- Accept an authorized WebSocket connection with a session-auth token.
- Target sub-500 ms end-to-end response latency; measure this as a service SLO
  under a defined test environment.
- Consume shared xAPI verbs and rubric dimension enum from `mmaxr-contracts`
  where required for session context.
- Expose voice-channel interaction only; no text interface.
- Use `packages/guardrails` to block or rewrite output containing numerical
  patterns or canonical-answer text before delivery.

## Dependencies

- Session-auth token issuer and shared Redis session state.
- `mmaxr-contracts` for shared event and rubric definitions.
- `packages/guardrails` for deterministic answer-leak filtering.
- Selected voice LLM provider SDK and service credentials.

## Tech Stack

- Node.js/TypeScript — shared typed service runtime.
- WebSocket — real-time voice-channel transport.
- OpenAI Realtime API SDK — initial proposed voice provider; final selection
  remains subject to confirmation.
- Redis — session state and mode/configuration coordination.

## Open Questions

- Which provider, model, region, and audio formats meet latency and privacy
  requirements?
- What exact end-to-end latency measurement boundary defines the sub-500 ms
  target?
- How are instructor mode changes authorized and synchronized with an active
  session?
- What voice data may the provider retain, and how is retention configured?

## Status: NOT IMPLEMENTED
