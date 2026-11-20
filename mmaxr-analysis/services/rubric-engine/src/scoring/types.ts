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
  checkpoints: {
    id: string;
    n: number;
    selection: { glands: number; juices: number; nutrients: number; allCorrect: boolean };
    coverageFirst: number;
    coverageFinal: number;
    revisions: number;
    inputMode: 'voice' | 'typed';
    speakMs: number;
    thinkMs: number;
  }[];
  final: { correct: number; total: number } | null;
}

export interface MotionTruth {
  trials: { id: string; n: number; scenario: string; kind: 'prediction' | 'transfer'; anomaly: boolean; match: boolean; confidence: number; thinkMs: number; coverage: number | null; words: number }[];
  total: number;
}

export interface TruthInfo {
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
  lessonType: 'chemistry_indicators' | 'chemistry_metals' | 'biology_digestive_system' | 'physics_motion' | 'physics_bohr' | 'unknown';
  device: Device;
  complete: boolean;
  dimensions: DimensionResult[];
  overall: { points: number; max: number; percent: number | null };
  deviceStats: { kind: Device; items: StatItem[] };
  metrics: Record<string, number | boolean | string | null>;
}

export const RUBRIC_VERSION = 'chem-1.0';

export const LABELS: Record<DimensionKey, string> = {
  predictionDiscipline: 'Prediction discipline',
  retrievalEffort: 'Retrieval effort',
  revisionQuality: 'Revision quality',
  causalCoherence: 'Causal coherence',
  metacognitiveCalibration: 'Metacognitive calibration',
  transfer: 'Transfer',
};
