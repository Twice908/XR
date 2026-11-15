import { XapiVerb, TelemetryEvent } from "@mmaxr/schema";
import { SpectralSimulation } from "@mmaxr/domain-simulation";

console.log("--- STARTING LESSON SIMULATION ---");

const sessionId = "sess_12345";
const studentId = "student_anon_01";
const sim = new SpectralSimulation(1); // Start with Hydrogen (Z=1)

// Helper to mimic sending data to the backend
function logEvent(verb: XapiVerb, object: any) {
  const event: TelemetryEvent = {
    sessionId,
    studentId,
    timestamp: Date.now(),
    verb,
    object
  };
  console.log(`[xAPI Emitter] -> ${verb.toUpperCase()}:`, object);
}

// --- TRIAL 1 ---
console.log("\n--- Trial 1 ---");
const predicted1 = sim.predictWavelength(3, 2); // n=3 to n=2
logEvent(XapiVerb.PREDICTED, { value: predicted1, target: "spectrometer_marker" });

logEvent(XapiVerb.ACTED, { action: "fire_photon", nInitial: 3, nFinal: 2 });
const result1 = sim.firePhoton(3, 2);

logEvent(XapiVerb.OBSERVED, { value: result1.measuredWavelength });


// --- TRIAL 2 ---
console.log("\n--- Trial 2 ---");
const predicted2 = sim.predictWavelength(4, 2);
logEvent(XapiVerb.PREDICTED, { value: predicted2, target: "spectrometer_marker" });
logEvent(XapiVerb.ACTED, { action: "fire_photon", nInitial: 4, nFinal: 2 });
const result2 = sim.firePhoton(4, 2);
logEvent(XapiVerb.OBSERVED, { value: result2.measuredWavelength });


// --- TRIAL 3 ---
console.log("\n--- Trial 3 ---");
const predicted3 = sim.predictWavelength(5, 2);
logEvent(XapiVerb.PREDICTED, { value: predicted3, target: "spectrometer_marker" });
logEvent(XapiVerb.ACTED, { action: "fire_photon", nInitial: 5, nFinal: 2 });
const result3 = sim.firePhoton(5, 2);
logEvent(XapiVerb.OBSERVED, { value: result3.measuredWavelength });


// --- TRIAL 4 (ANOMALY INJECTION) ---
console.log("\n--- Trial 4 (Expect Anomaly) ---");
const predicted4 = sim.predictWavelength(6, 2);
logEvent(XapiVerb.PREDICTED, { value: predicted4, target: "spectrometer_marker" });
logEvent(XapiVerb.ACTED, { action: "fire_photon", nInitial: 6, nFinal: 2 });
const result4 = sim.firePhoton(6, 2);

if (result4.isAnomaly) {
  console.log(`!! ANOMALY DETECTED !! Predicted: ${predicted4}nm, Observed: ${result4.measuredWavelength}nm`);
  logEvent(XapiVerb.NOTICED_ANOMALY, { expected: predicted4, actual: result4.measuredWavelength });
}
logEvent(XapiVerb.OBSERVED, { value: result4.measuredWavelength });

console.log("\n--- END SIMULATION ---");
