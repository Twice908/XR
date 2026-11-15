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
export interface TelemetryEvent {
  sessionId: string;
  studentId: string;
  timestamp: number;
  verb: XapiVerb;
  // The object is a flexible dictionary to hold specific data
  object: {
    action?: string;
    target?: string;
    value?: number | string;
  };
}