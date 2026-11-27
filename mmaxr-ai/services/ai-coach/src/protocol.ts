export type Mode = 'proactive' | 'on_request' | 'off';
export const MODES: Mode[] = ['proactive', 'on_request', 'off'];

/** Everything below is what the student can already see on screen. Hidden answers never travel in a snapshot. */
export interface TestView {
  tool: string;
  predicted: string | null;
  observed: string;
  matched: boolean;
  recorded: string | null;
}
export interface TubeView {
  n: number;
  tests: TestView[];
  conclusion: string | null;
  revisions: number;
  recordedPh: number | null;
}
export interface Snapshot {
  phase: string;
  tools: string[];
  activeTool: string | null;
  tubes: TubeView[];
  /** Lab-specific plain-language state. When present it replaces the tube list in the prompt. */
  lines?: string[];
  /** What the student has currently called each item, so the coach may repeat their own claim back. */
  claims?: { n: number; verdict: string }[];
}

/** The hidden answers, read by the coach from the lesson service. Never supplied by the browser. */
export interface TruthTube {
  tube: number;
  name: string;
  formula: string;
  type: string;
  ph: number;
  /** Plain-language facts used only for the wrap-up (metals and biology labs). */
  facts?: string;
  /** Words that would give this item's answer away (biology). Defaults to the name and formula. */
  terms?: string[];
  /** Biology: true while this stop's answer has not yet been revealed to the student. */
  open?: boolean;
}

export interface Hello {
  lessonId: string;
  title: string;
  /** The lesson type, e.g. chemistry_indicators. */
  labType: string;
  summary?: string;
  /** Speak the coach's replies aloud (Piper on the server). Text is always sent as well. Default off. */
  voice?: boolean;
}

export type EventKind = 'prediction_mismatch' | 'revision' | 'ph_unlocked' | 'ready_to_submit' | 'idle';

export type ClientMessage =
  | ({ type: 'hello' } & Hello)
  | { type: 'mode'; mode: Mode }
  /** Turn spoken replies on or off for this session. */
  | { type: 'voice'; on: boolean }
  /** `inputMode` says whether the student typed the question or spoke it (transcribed in the browser). */
  | { type: 'ask'; text: string; snapshot?: Snapshot; inputMode?: 'typed' | 'voice' }
  | { type: 'event'; kind: EventKind; detail?: string; snapshot?: Snapshot }
  /**
   * Who has the floor, as the browser sees it. `narrating`: a recorded narration line is playing. `talking`: the
   * student is holding the talk button. Send each field when it changes; omitted fields keep their last value.
   * Talking stops any coach reply in progress. Nudges wait for a quiet moment and are dropped otherwise.
   */
  | { type: 'floor'; narrating?: boolean; talking?: boolean }
  /** Stop the coach reply in progress (`id`, or whichever is current): no more text or audio for it. */
  | { type: 'cancel'; id?: string }
  | { type: 'reveal'; snapshot?: Snapshot };

export type CoachReason = 'reply' | 'nudge' | 'wrapup';

export type ServerMessage =
  /** `voiceAvailable`: the server can speak (a TTS engine is set up). `voice`: this session has spoken replies on. */
  | { type: 'ready'; mode: Mode; provider: string; model: string; configured: boolean; voiceAvailable: boolean; voice: boolean }
  /** A reply has started; `id` is the id its `coach` and `coach_audio` messages will carry. */
  | { type: 'thinking'; id: string }
  /** The reply text, always sent first. `voice` is true when audio for this `id` will follow as `coach_audio`. */
  | { type: 'coach'; id: string; text: string; reason: CoachReason; provider: string; blocked: boolean; degraded: boolean; voice: boolean }
  /**
   * Spoken audio for a reply, one sentence per message, in order (`seq` from 0). `last` marks the final piece.
   * `data` is base64 MP3. When speech fails part-way, a last piece with `error: true` and no data ends the reply.
   */
  | { type: 'coach_audio'; id: string; seq: number; last: boolean; format: 'mp3'; data: string; text: string; error?: boolean }
  | { type: 'voice'; on: boolean; available: boolean }
  /**
   * A reply was stopped: the browser should drop it (stop its audio, discard pieces still to come). `superseded`: the
   * student asked something new. `talking`: the student started talking. `narration`: a narration line started over a
   * nudge (a reply to a question is never cancelled by narration; the browser plays it after the line). `cancelled`:
   * the browser asked.
   */
  | { type: 'coach_cancelled'; id: string; reason: 'superseded' | 'talking' | 'narration' | 'cancelled' }
  | { type: 'mode'; mode: Mode }
  | { type: 'coach_off' }
  | { type: 'error'; message: string };

export interface Assignment {
  submitted: boolean;
  tubes: TruthTube[];
}
