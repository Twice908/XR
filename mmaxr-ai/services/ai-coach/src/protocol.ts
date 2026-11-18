import type { SecretTube } from '@mmaxr/guardrails';

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
}

export interface TruthTube {
  tube: number;
  name: string;
  formula: string;
  type: string;
  ph: number;
}

export interface Hello {
  lessonId: string;
  title: string;
  /** The lesson type, e.g. chemistry_indicators. */
  labType: string;
  summary?: string;
  /** Used only by the deterministic answer guard. Never put into a prompt before the reveal. */
  secrets?: SecretTube[];
}

export type EventKind = 'prediction_mismatch' | 'revision' | 'ph_unlocked' | 'ready_to_submit' | 'idle';

export type ClientMessage =
  | ({ type: 'hello' } & Hello)
  | { type: 'mode'; mode: Mode }
  | { type: 'ask'; text: string; snapshot?: Snapshot }
  | { type: 'event'; kind: EventKind; detail?: string; snapshot?: Snapshot }
  | { type: 'reveal'; truth: TruthTube[]; snapshot?: Snapshot };

export type CoachReason = 'reply' | 'nudge' | 'wrapup';

export type ServerMessage =
  | { type: 'ready'; mode: Mode; provider: string; model: string; configured: boolean }
  | { type: 'thinking' }
  | { type: 'coach'; id: string; text: string; reason: CoachReason; provider: string; blocked: boolean; degraded: boolean }
  | { type: 'mode'; mode: Mode }
  | { type: 'coach_off' }
  | { type: 'error'; message: string };
