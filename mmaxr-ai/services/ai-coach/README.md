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

## Phase 3: quick answers

Two kinds of question are answered without the model (`src/intents.ts`): instant, free, and unable to leak anything.
They do not count toward the questions-per-minute limit, and the reply carries `quick`.

- **"Say that again"** (repeat, pardon, what did you say…): the coach's last reply, word for word.
- **"What do I do now?"** (what's next, I'm lost…): the narration line the student heard last, which is their current
  step. The browser names it with `{type:'floor', narrating:true, cue:'<cue id>'}`; the lines come with the lab
  context (`narration`, by cue id). Before any narration has played, the question goes to the model.

Only a whole utterance matches, after filler ("um", "sorry", "can you", "please") is stripped; "what do I do with the
ammeter?" is a real question and goes to the model.

## Phase 4: spoken questions transcribed on the server

For browsers that cannot transcribe speech themselves (no Web Speech API, e.g. a headset browser), the browser sends
the recording: `{type:'audio_ask', format:'webm'|'ogg'|'mp4'|'wav'|'mpeg', data:<base64>}`. The server answers
`{type:'transcript', text}` so the student sees what was heard, then handles it like a typed question
(`inputMode: 'voice'`), quick answers included. `ready.sttAvailable` says whether the server can do this.

- Engine (`src/voice/stt.ts`): ffmpeg turns the recording into 16 kHz mono WAV (first 30 s), then whisper.cpp
  (`WHISPER_BIN`, `WHISPER_MODEL`, e.g. `ggml-base.en.bin`) transcribes it locally: free and offline. Whisper's
  non-speech markers ("[BLANK_AUDIO]") are dropped. At most `WHISPER_CONCURRENCY` (2) run at once across students.
- Errors come back as an empty `transcript` with `error`: `empty` (nothing heard), `failed`, `unavailable`,
  `too_large` (over 2 MB of audio), `limit` (10 recordings a minute). No reply follows.
- Talking again (`floor {talking:true}`) or a newer recording stops a transcription in progress.
- The questions-per-minute limit now lives in the session, so typed and spoken questions share it; quick answers stay
  free. WebSocket messages are capped at 3 MB.

## Phase 5: streamed replies

With a provider that streams (Anthropic), the coach does not wait for the whole reply. As each sentence is finished it
is guarded, sent as `{type:'coach_part', id, seq, text}`, and queued for speech while the model keeps writing; its
`coach_audio` has the same `seq`. The closing `coach` message (`streamed: true`) carries the whole text, and a streamed
reply's audio ends with an empty `last: true` piece (the last sentence is only known when writing ends).

- Safety: each sentence is guarded together with everything already said, so the check is the same as for a whole
  reply. If a sentence would leak, the guard's redirect is sent in its place, the reply ends, and the model's stream is
  stopped (no more tokens are paid for).
- If the stream fails before anything is said, the lab's fallback line is sent as a whole reply; if it fails part-way,
  the reply ends with what was said (`degraded: true`).
- Providers without streaming (OpenAI, Gemini here) still answer with whole replies.
- Timed against a local stand-in writing at a model's pace (first token 0.5 s): first sentence 1.5 s, its audio
  2.0 s, whole text 3.1 s. Without streaming the first audio would come after about 3.6 s.
- `ANTHROPIC_BASE_URL` points the provider at another endpoint (default https://api.anthropic.com).
