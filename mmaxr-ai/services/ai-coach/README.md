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

## Status (text channel, voice-ready)

Implemented for the chemistry indicators lab:

- Provider layer: Anthropic, OpenAI and Gemini behind one interface (`src/providers`).
  Pick with `AI_COACH_PROVIDER` or switch live with `POST /admin/provider` (instructor token).
  There is no automatic fallback between providers; if the active one is unavailable the coach
  falls back to deterministic Socratic prompts and flags the message as `degraded`.
- Keys come from `ai-coach/.env` (see `.env.example`): `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`.
- Modes `proactive | on_request | off`; unprompted nudges are rate limited.
- The model is only told what the student can already see. Hidden answers go to the deterministic
  guard (`packages/guardrails`) and to the prompt only after the student submits.
- WebSocket messages are JSON (`src/protocol.ts`); the same messages can carry transcribed speech and be
  spoken back, which is the intended next step. Realtime audio is not implemented.
- Sessions are verified against `session-auth` before the socket is accepted.


## Voice (phase 1: the coach speaks)

- Replies can be spoken. The browser opts in with `hello.voice: true` or `{type:'voice', on:true}`; the server answers
  `{type:'voice', on, available}`. Text is always sent first (`coach`, with `voice: true` when audio follows), then the
  audio arrives as `coach_audio` messages, one sentence each (`seq`, `last`, base64 MP3). A newer reply stops the
  older one's audio. Speech failure ends the reply with an `error: true` piece; the text has already been shown.
- What is spoken is the guarded text: the answer-leak guard runs before any speech is made.
- Engine: Piper on the server (`PIPER_BIN`, `PIPER_MODEL`, the narration's Jenny voice) encoded by `lame` to 64 kbps
  mono MP3, with recent sentences cached. Without Piper set up, `voiceAvailable` is false and replies stay text-only.
- Student questions are limited to `AI_COACH_ASKS_PER_MINUTE` (default 5) per session; other messages to 40 a minute.
- The lab's public context (benches, concept ideas, tool and stop names, narration lines; never answers) is read once
  per session from the lesson loader (`/internal/lessons/:lessonId/context`), on the first question, and kept in the
  system prompt, which is prompt-cached (Anthropic) so later questions read it from the cache.

## Voice (phase 2: who speaks when)

One voice at a time, in this order (`src/floor.ts`):

1. **The student**, holding the talk button (`{type:'floor', talking:true}`): the coach reply in progress stops
   (`coach_cancelled`, reason `talking`), whether it is still thinking or part-way through being spoken.
2. **Narration** (`{type:'floor', narrating:true|false}`), played by the browser: never interrupted. It stops a nudge
   in progress (reason `narration`) but never a reply to a question; the browser plays that after the line.
3. **A reply to a question**: always answered. A new question replaces the one still being answered (reason
   `superseded`). A reply cancelled before it is sent is not kept in the conversation history.
4. **Nudges** (proactive mode): only in a quiet moment, not while the student talks, narration plays, the 8 s after a
   line ends, or while another reply is in progress. Otherwise they are dropped, not delayed.

The browser can stop a reply with `{type:'cancel', id}`. `thinking` now carries the reply's `id`. A narrating or
talking state the browser never clears expires (30 s and 60 s). Floor and cancel messages have their own cap
(120 a minute), apart from the 40 a minute for other messages and the 5 questions a minute.
