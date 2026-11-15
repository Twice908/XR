import { XapiVerb, TelemetryEvent } from "@mmaxr/schema";

async function sendEvent(event: TelemetryEvent) {
  try {
    await fetch('http://localhost:3001/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
  } catch (error) {
    console.error(`🔌 Network Error - Is the backend running?`);
  }
}

async function runTest() {
  console.log("--- SENDING PERFECT TRACE TO BACKEND ---");
  
  const baseEvent = {
    sessionId: "sess_perfect_score",
    studentId: "student_good",
    timestamp: Date.now(),
  };

  // 1. Trial 1
  await sendEvent({ ...baseEvent, verb: XapiVerb.PREDICTED, object: { target: "spectrometer", value: 656.2 } });
  await sendEvent({ ...baseEvent, verb: XapiVerb.ACTED, object: { action: "fire_photon" } });
  await sendEvent({ ...baseEvent, verb: XapiVerb.OBSERVED, object: { value: 656.2 } });

  // 2. Trial 2 (Anomaly happens)
  await sendEvent({ ...baseEvent, verb: XapiVerb.PREDICTED, object: { target: "spectrometer", value: 486.1 } });
  await sendEvent({ ...baseEvent, verb: XapiVerb.ACTED, object: { action: "fire_photon" } });
  await sendEvent({ ...baseEvent, verb: XapiVerb.OBSERVED, object: { value: 559.0 } }); // Anomaly shifted!
  
  // 3. Student notices anomaly
  await sendEvent({ ...baseEvent, verb: XapiVerb.NOTICED_ANOMALY, object: { expected: 486.1, actual: 559.0 } });

  console.log("✅ Perfect trace sent! Check the Dashboard.");
}

runTest();