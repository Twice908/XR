import { XapiVerb, TelemetryEvent } from "@mmaxr/schema";

async function sendEvent(event: TelemetryEvent) {
  await fetch('http://localhost:3001/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, timestamp: Date.now() })
  });
}

async function runTest() {
  const base = { sessionId: "sess_ultimate", studentId: "student_god", timestamp: Date.now() };
  
  // 1. Prediction (wait 3 seconds = high retrieval effort)
  await sendEvent({ ...base, verb: XapiVerb.PREDICTED, object: { value: 656 } });
  await new Promise(r => setTimeout(r, 3000)); 
  
  // 2. Action & Observation
  await sendEvent({ ...base, verb: XapiVerb.ACTED, object: {} });
  await sendEvent({ ...base, verb: XapiVerb.OBSERVED, object: { value: 754 } }); // Anomaly
  
  // 3. Notice anomaly instantly (high metacognition)
  await new Promise(r => setTimeout(r, 500)); 
  await sendEvent({ ...base, verb: XapiVerb.NOTICED_ANOMALY, object: {} });

  // 4. Explain (High causal coherence)
  await new Promise(r => setTimeout(r, 1000));
  await sendEvent({ ...base, verb: XapiVerb.EXPLAINED, object: { text: "The energy difference caused a transition, altering the wavelength." } });

  // 5. Transfer probe
  await sendEvent({ ...base, verb: XapiVerb.TRANSFERRED, object: {} });

  console.log("✅ Ultimate trace sent! Check Dashboard.");
}
runTest();