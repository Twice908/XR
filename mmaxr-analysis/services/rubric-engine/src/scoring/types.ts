export type Device = 'web' | 'vr' | 'unknown';

/** One xAPI statement as stored by the xapi-emitter. */
export interface EventRow {
  id: number;
  verb: string;
  timestamp: number;
  object_data: {
    action?: string;
    target?: string;
    value?: string | number;
    data?: Record<string, unknown>;
  } | null;
  device?: string | null;
}

export interface Sample {
  t: number;
  head: [number, number, number];
  hand: [number, number, number];
}

export interface SensorData {
  /** Which client wrote the CSV: web (head_x...) or Unity/VR (headX, leftX, rightX...). */
  format: 'web' | 'vr';
  samples: Sample[];
}

/** The hidden answers for a session, read from the lesson service. Never sent by the browser. */
export interface BiologyTruth {
  /** How many organs the student has walked through, out of how many. */
  visited: number;
  stops: number;
  /** The quiz questions answered so far (the ones dealt to this session). */
  quiz: { id: string; organ: string; correct: boolean; thinkMs: number }[];
  quizTotal: number;
  final: { correct: number; total: number; explainCoverage?: number | null; inputMode?: 'voice' | 'typed' | null; speakMs?: number } | null;
}

export interface MotionTruth {
  trials: { id: string; n: number; scenario: string; kind: 'prediction' | 'transfer'; anomaly: boolean; match: boolean; confidence: number; thinkMs: number; coverage: number | null; words: number; inputMode?: 'voice' | 'typed' | null; speakMs?: number }[];
  total: number;
}

/** Light: Reflection & Spherical Mirrors. Per-case scores are the number of correct image fields (0-4). */
export interface OpticsTruth {
  plane: { correct: number; total: number };
  laws?: { correct: number; total: number };
  rules: { correct: number; total: number };
  cases: { id: string; mirror: 'concave' | 'convex'; anomaly: boolean; firstScore: number; finalScore: number | null; revised: boolean }[];
  /** One entry per explanation the student gave, as measured by the lesson service. */
  explanations?: {
    required: number;
    given: { kind: string; id: string; inputMode: 'voice' | 'typed'; speakMs: number; dwellMs: number; thinkMs: number; words: number; pasted: number; blurs: number }[];
  };
  submitted: boolean;
}

export interface ReasoningTruth {
  words: number;
  inputMode: 'voice' | 'typed';
  speakMs: number;
  quality: { evidence: number; causal: number; coverage: number; score: number } | null;
}

/** Sound & Waves sandbox: per-task results and how each explanation was given, as measured by the lesson service. */
export interface SoundTruth {
  tasks: { id: string; tool: 'wave' | 'echo' | 'sonar'; match: boolean; anomaly: boolean; hasCalc: boolean; calcAttempts: number; calcOk: boolean }[];
  total: number;
  explanations: { required: number; given: { id: string; inputMode: 'voice' | 'typed'; speakMs: number; dwellMs: number; thinkMs: number; words: number; pasted: number; blurs: number }[] };
  submitted: boolean;
}

/** Atom Builder, Ionic Bonding and Plant vs Animal Cell: per-mission results held by the lesson service. */
export type MissionsLabType = 'chemistry_atom_builder' | 'chemistry_ionic_bonding' | 'biology_cell_explorer';
export interface MissionsTruth {
  labType: MissionsLabType;
  missions: { id: string; attempts: number; hintsUsed: number; hintsAvailable: number; met: boolean; questions: { id: string; answered: boolean; correct: boolean; thinkMs: number }[] }[];
  submitted: boolean;
}

export interface TruthInfo {
  sound?: SoundTruth;
  missions?: MissionsTruth;
  /** What the student said about their own conclusions (indicators and metals labs). */
  reasoning?: ReasoningTruth | null;
  optics?: OpticsTruth;
  /** Motion, forces and gravitation sandbox: per-trial results held by the lesson service. */
  motion?: MotionTruth;
  /** Digestive-system journey: per-stop results held by the lesson service. */
  biology?: BiologyTruth;
  tubes: { tube: number; type: string; ph: number }[];
  /** What the student locked in at submission, held by the server. */
  submission: { tubes: { tube: number; conclusion: string | null; ph: number | null }[] } | null;
}

export type DimensionKey =
  | 'predictionDiscipline'
  | 'retrievalEffort'
  | 'revisionQuality'
  | 'causalCoherence'
  | 'metacognitiveCalibration'
  | 'transfer';

export interface DimensionResult {
  key: DimensionKey;
  label: string;
  /** 0-3, or null when the dimension is not assessed for this session. */
  score: number | null;
  max: 3;
  /** One sentence a person can check against the evidence. */
  basis: string;
  /** Stable ids of the xAPI events the score rests on (capped). */
  evidence: number[];
  measures: Record<string, number | string | null>;
}

export interface StatItem {
  label: string;
  value: string;
  hint: string;
}

export interface Report {
  rubricVersion: string;
  lessonType: 'chemistry_indicators' | 'chemistry_metals' | 'biology_digestive_system' | 'biology_respiratory_system' | 'physics_optics' | 'physics_waves_sound' | 'physics_motion' | 'physics_bohr' | MissionsLabType | 'unknown';
  device: Device;
  complete: boolean;
  dimensions: DimensionResult[];
  overall: { points: number; max: number; percent: number | null };
  deviceStats: { kind: Device; items: StatItem[] };
  metrics: Record<string, number | boolean | string | null>;
}

/** 2.0: one set of score bands for every lab, click-time action stamps, provisional overall for unfinished sessions. */
export const RUBRIC_VERSION = 'rubric-2.0';

export const LABELS: Record<DimensionKey, string> = {
  predictionDiscipline: 'Prediction discipline',
  retrievalEffort: 'Retrieval effort',
  revisionQuality: 'Revision quality',
  causalCoherence: 'Causal coherence',
  metacognitiveCalibration: 'Metacognitive calibration',
  transfer: 'Transfer',
};
