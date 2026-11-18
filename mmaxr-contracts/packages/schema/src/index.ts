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

export type LessonContract = PhysicsLessonContract | ChemistryLessonContract;

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
  type: "physics_bohr" | "chemistry_indicators";
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
