// 1. The xAPI Verbs (What the student does)
export enum XapiVerb {
  PREDICTED = "predicted",
  ACTED = "acted",
  OBSERVED = "observed",
  NOTICED_ANOMALY = "noticed_anomaly",
  INVESTIGATED = "investigated",
  REVISED_MODEL = "revised_model",
  EXPLAINED = "explained",
  TRANSFERRED = "transferred",
}

// 2. The Rubric Dimensions (What we score)
export enum RubricDimension {
  PREDICTION_DISCIPLINE = "prediction_discipline",
  RETRIEVAL_EFFORT = "retrieval_effort",
  REVISION_QUALITY = "revision_quality",
  CAUSAL_COHERENCE = "causal_coherence",
  METACOGNITIVE_CALIBRATION = "metacognitive_calibration",
  TRANSFER = "transfer",
}

// 3. The Standard Event Payload (What gets sent to the database)
/** Where a session was recorded. Drives which stats the rubric engine scores on. */
export type DeviceType = "web" | "vr";

export interface TelemetryEvent {
  sessionId: string;
  studentId: string;
  timestamp: number;
  verb: XapiVerb;
  /** web = browser (mouse/touch), vr = headset client (hands, head, gaze). */
  device?: DeviceType;
  // The object is a flexible dictionary to hold specific data
  object: {
    action?: string;
    target?: string;
    value?: number | string;
    /** Extra structured evidence for the rubric engine (colours, confidence, timings...). */
    data?: Record<string, unknown>;
  };
}

// 4. The Lesson Contract (Shared between WebXR and Unity) — see section 6

// 5. The 30Hz Sensor Data Row (CSV format)
export interface SensorDataRow {
  timestamp: number;
  head_x: number;
  head_y: number;
  head_z: number;
  hand_x: number;
  hand_y: number;
  hand_z: number;
}
// 6. chemistry lesson contract

export type LessonContract = PhysicsLessonContract | ChemistryLessonContract | MetalsLessonContract | BiologyLessonContract | OpticsLessonContract | MotionLessonContract;

export interface PhysicsLessonContract {
  lessonId: string;
  type: "physics_bohr";
  title: string;
  modelUrl: string;
  subject?: string;
  summary?: string;
  durationMinutes?: number;
  difficulty?: string;
  simulation: {
    atomicNumber: number;
    nInitial: number;
    nFinal: number;
    anomalyTrialNumber: number;
    anomalyShiftMultiplier: number;
  };
}

export interface ChemistryIndicator {
  id: string;
  name: string;
  source: string;
  isPhTest?: boolean;
  /** The browser only receives `neutral` (the colour of the liquid in the bottle). acid/base stay server-side. */
  colors?: {
    neutral?: string;
    acid?: string;
    base?: string;
  };
}

export interface ChemistrySolution {
  id: string;
  name: string;
  formula: string;
  type: "acid" | "base" | "neutral";
  ph: number;
}

export interface ChemistryLessonContract {
  lessonId: string;
  type: "chemistry_indicators";
  title: string;
  modelUrl: string;
  subject?: string;
  summary?: string;
  durationMinutes?: number;
  difficulty?: string;
  assets?: {
    testTube?: string;
    flask?: string;
    dropper?: string;
    testTubeRack?: string;
  };
  config: {
    totalTestTubes: number;
    requiredIndicatorsToSelect: number;
  };
  indicators: ChemistryIndicator[];
  /**
   * Legacy only (Unity prototype via /lessons/active). The web client never receives this: the
   * assignment lives in lesson-loader and tests are run through POST /sessions/:id/chemistry/test.
   */
  assignedSolutions?: ChemistrySolution[]; 
}

// 7. Experiment catalog entry (GET /lessons on lesson-loader)
export interface LessonSummary {
  lessonId: string;
  type: "physics_bohr" | "chemistry_indicators" | "chemistry_metals" | "biology_digestive_system" | "physics_optics" | "physics_mechanics_sandbox";
  title: string;
  subject: string | null;
  summary: string | null;
  durationMinutes: number | null;
  difficulty: string | null;
}

// 8. Accounts (user-auth)
export type UserRole = "student" | "instructor";

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  createdAt: string;
}


// 9. Chemistry lab: what the server discloses, and only at submission
export interface ChemistryRevealTube {
  tube: number;
  id: string;
  name: string;
  formula: string;
  type: "acid" | "base" | "neutral";
  ph: number;
}


// 10. Metals & Non-Metals lab
export type MaterialKind = "metal" | "non-metal";

export interface MetalsOutcome {
  id: string;
  label: string;
}

export interface MetalsTool {
  id: string;
  name: string;
  property: string;
  group: "Physical" | "Chemical";
  question: string;
  outcomes: MetalsOutcome[];
}

/** How a sample looks. Nothing here says what it is. */
export interface MetalsSample {
  slot: number;
  color: string;
  colorHex: string;
  state: "solid" | "liquid";
  lustre: "shiny" | "dull";
  texture: string;
}

export interface MetalsLessonContract {
  lessonId: string;
  type: "chemistry_metals";
  title: string;
  modelUrl: string;
  subject?: string;
  summary?: string;
  durationMinutes?: number;
  difficulty?: string;
  assets?: { hammer?: string; bunsenBurner?: string };
  config: { totalSamples: number; testBudget: number; minTestsPerSample: number; requirePredictionBeforeTest: boolean };
  tools: MetalsTool[];
  /** Present when the lesson was requested for a session. */
  samples?: MetalsSample[];
  uiSchema?: { classifications: { id: MaterialKind; label: string }[] };
}

export interface MetalsRevealSample {
  sample: number;
  id: string;
  name: string;
  formula: string;
  type: MaterialKind;
  anomaly: boolean;
  why: string;
  results: Record<string, string>;
  oxideLitmus: string;
}


// 11. Human Digestive System: guided journey
export interface BiologyOption {
  id: string;
  label: string;
}

export interface BiologyCheckpoint {
  id: string;
  organName: string;
  prompt: string;
  /** Camera and look-at in full-body (VR) space. */
  cameraPosition: { x: number; y: number; z: number };
  lookAtTarget: { x: number; y: number; z: number };
  /** Where the organ sits on the teaching torso model. */
  modelAnchor: { x: number; y: number; z: number };
  /** Close-up model shown beside the torso at this stop. */
  detail: "tooth" | "stomach" | "liver" | "salivary" | "pancreas" | null;
}

export interface BiologyScenario {
  id: string;
  question: string;
  options: BiologyOption[];
}

export interface BiologyLessonContract {
  lessonId: string;
  type: "biology_digestive_system";
  title: string;
  modelUrl: string;
  subject?: string;
  summary?: string;
  durationMinutes?: number;
  difficulty?: string;
  assets: { digestiveSystem: string; stomach: string; liver: string; tooth: string };
  /** Salivary glands and pancreas have no downloaded model: the client builds them procedurally. */
  config: { isGuidedTour: boolean; requireAudioExplanation: boolean; minExplanationWords: number; maxRevisions: number };
  choices: { glands: BiologyOption[]; juices: BiologyOption[]; components: BiologyOption[]; nutrients: BiologyOption[] };
  checkpoints: BiologyCheckpoint[];
  transfer: { scenarios: BiologyScenario[] };
}

export interface BiologyReveal {
  checkpoint: string;
  explanation: string;
  answer: { glands: BiologyOption[]; juices: BiologyOption[]; components: BiologyOption[]; nutrients: BiologyOption[]; targetNutrient: string };
  selectionScore: { glands: number; juices: number; components: number; nutrients: number; allCorrect: boolean };
  keywords: { keyword: string; matched: boolean }[];
  coverage: number;
}

export interface BiologyFinalResult {
  correct: number;
  total: number;
  results: { id: string; correct: boolean; answer: string; yourAnswer: string; explanation: string }[];
}


// 12. Light: Reflection & Spherical Mirrors (optics lab)
export interface OpticsOption {
  id: string;
  label: string;
}

export type OpticsMirror = "concave" | "convex";
export type OpticsImageField = "position" | "size" | "nature" | "orientation";

/** A predicted or expected image, as option ids. */
export type OpticsImage = Record<OpticsImageField, string>;

export interface OpticsSurface {
  id: string;
  name: string;
  predictionPrompt: string;
  /** Server-side only: id of the right prediction option. Stripped before the browser sees the lesson. */
  result?: string;
  explanation?: string;
  /** Server-side only: words the student's explanation of this run must draw on (any one per group). */
  anchors?: string[][];
}

export interface OpticsLaw {
  id: string;
  /** Neutral heading: it must not give the law away. */
  topic: string;
  /** Drawn for this session (from `variants`): angle from the normal, downward tilt, and which side the laser comes from. Public: they only aim the laser. */
  incidentAngleDeg: number;
  elevationDeg: number;
  side: "left" | "right";
  /** Server-side only: the pool this session's values are drawn from. */
  variants?: { i: number; e: number }[];
  anchors?: string[][];
  incident: string;
  predictionPrompt: string;
  options: OpticsOption[];
  /** Server-side only. */
  answer?: string;
  statement?: string;
  explanation?: string;
}

export interface OpticsRule {
  id: string;
  description: string;
  /** What the student fires: shown before the prediction, with this session's numbers filled in. */
  incident: string;
  /** Drawn for this session: size of the ray's offset or angle, and which side of the axis it is on. Public: it only places the ray. */
  params: { n: number; where: "above" | "below" };
  variants?: { n: number }[];
  anchors?: string[][];
  /** The answer options for this ray, in this session's order. */
  options?: OpticsOption[];
  /** Server-side only: id of the outcome this ray follows. */
  reflected?: string;
  explanation?: string;
}

export interface OpticsCase {
  id: string;
  objectPosition: string;
  /** Object distance as a multiple of the focal length; null = at infinity. Public: it only places the candle. */
  uOverF: number | null;
  predictionPrompt: string;
  /** Server-side only. */
  expectedImage?: OpticsImage;
  isAnomaly?: boolean;
  anomalyExplanation?: string;
}

export interface OpticsLessonContract {
  lessonId: string;
  type: "physics_optics";
  title: string;
  modelUrl: string;
  subject?: string;
  summary?: string;
  durationMinutes?: number;
  difficulty?: string;
  assets: { laser: string; planeMirror: string; mirrorStand: string };
  config: { hasLaserPointer: boolean; hasMovableObject: boolean; focalLengthM: number; maxExplanationWords?: number; minExplanationWords: number; requireAudioExplanation: boolean; minExplainDwellMs?: number };
  planeMirror: { predictionOptions: OpticsOption[]; scenarios: OpticsSurface[] };
  lawsOfReflection: { laws: OpticsLaw[] };
  rayRules: { outcomes: OpticsOption[]; rules: OpticsRule[] };
  imageFields: Record<OpticsImageField, OpticsOption[]>;
  sphericalMirrors: { mirrorType: OpticsMirror; cases: OpticsCase[] }[];
  uiSchema: { hasPredictionDropdowns: boolean; predictionFields: string[]; hasRayTracingToggle: boolean };
  /** Server-side only: textbook uses disclosed at lock-in. */
  uses?: { mirror: string; examples: string[]; why: string }[];
}

/** What the lesson service says about an explanation: only whether it was accepted, never why it would fail. */
export interface OpticsExplainResult {
  ok: true;
  words: number;
}

export type OpticsTrialKind = "plane" | "law" | "rule" | "case";

export interface OpticsTrialResult {
  kind: OpticsTrialKind;
  id: string;
  match: boolean;
  /** plane / rule: the true outcome id. case: the expected image. */
  outcome?: string;
  image?: OpticsImage;
  fields?: Record<OpticsImageField, boolean>;
  anomaly?: boolean;
  explanation: string;
}

export interface OpticsRevealCase {
  id: string;
  mirror: OpticsMirror;
  objectPosition: string;
  expected: OpticsImage;
  yours: OpticsImage | null;
  fields: Record<OpticsImageField, boolean>;
  anomaly: boolean;
  explanation: string;
}

export interface OpticsReveal {
  planeCorrect: number;
  planeTotal: number;
  lawsCorrect: number;
  lawsTotal: number;
  laws: { id: string; statement: string }[];
  rulesCorrect: number;
  rulesTotal: number;
  tableCorrect: number;
  tableTotal: number;
  cases: OpticsRevealCase[];
  uses: { mirror: string; examples: string[]; why: string }[];
}

// ---------------- Motion, Forces & Gravitation ----------------

export interface MotionField {
  id: string;
  label: string;
  unit: string;
}
export type MotionInput = { type: 'numeric'; fields: MotionField[] } | { type: 'choice'; options: { id: string; label: string }[] };
export interface MotionTrial {
  id: string;
  kind: 'prediction' | 'transfer';
  anomaly: boolean;
  /** Which simulation to run once the prediction is locked; null for a question with no simulation. */
  action: string | null;
  prompt: string;
  input: MotionInput;
  /** This session's values for the animation (masses, forces, distances…). They only drive the picture. */
  params: Record<string, unknown>;
  /** True when the student must explain the surprise before the explanation is shown. */
  needsExplanation: boolean;
}
export interface MotionScenario {
  id: string;
  tabName: string;
  title: string;
  setup: string;
  trials: MotionTrial[];
}
export interface MotionLessonContract {
  lessonId: string;
  type: 'physics_mechanics_sandbox';
  /** Not used: the sandbox is built from the individual models in `assets`. */
  modelUrl?: string;
  subject: string;
  title: string;
  summary: string;
  durationMinutes: number;
  assets: { car: string; crate: string; feathers: string; cradle: string; pipe: string; trackStraight: string; trackCurve: string };
  config: { enableScenarioSwitcher: boolean; minExplanationWords: number };
  scenarios: MotionScenario[];
  uiSchema: { hasTabs: boolean; hasForceSlider: boolean; hasPlayPauseButton: boolean };
}
export interface MotionObservation {
  trial: string;
  match: boolean;
  fieldMatch: Record<string, boolean>;
  answer: Record<string, number | string>;
  outcome: string;
  /** The law the question was about, revealed with the result. */
  law: { name: string; formula?: string } | null;
  explanation: string | null;
}
export interface MotionExplanationResult {
  keywords: { keyword: string; matched: boolean }[];
  coverage: number;
  explanation: string;
}
