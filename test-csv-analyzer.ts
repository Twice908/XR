import { XapiVerb, TelemetryEvent } from "@mmaxr/schema";
import fs from 'fs';

async function runTest() {
  const sessionId = "sess_csv_test";
  console.log("--- GENERATING MOCK SENSOR DATA ---");
  
  // 1. Create a CSV with heavy hand movement (indicating physical exploration)
  let csv = "timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z\n";
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    // Moving hand across the X axis significantly
    csv += `${now + (i * 100)},0,1.6,0,${i * 0.1},1.0,0.5\n`; 
  }
  fs.writeFileSync('mock_sensor.csv', csv);

  // 2. Upload to sensor-stream
  const formData = new FormData();
  formData.append('file', new Blob([csv]), 'sensor_data.csv');
  
  await fetch(`http://localhost:3005/upload/${sessionId}`, { method: 'POST', body: formData });
  console.log("✅ CSV Uploaded.");

  // 3. Send Telemetry (Prediction, wait 3 seconds, Action)
  console.log("--- SENDING TELEMETRY ---");
  const baseEvent = { sessionId, studentId: "test_student", timestamp: now };
  
  await fetch('http://localhost:3001/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseEvent, verb: XapiVerb.PREDICTED, object: {} })
  });

  // Simulate a 3-second gap (matching the CSV data window)
  const actEvent = { ...baseEvent, timestamp: now + 3000, verb: XapiVerb.ACTED, object: {} };
  await fetch('http://localhost:3001/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(actEvent)
  });

  console.log("✅ Telemetry Sent. Waiting 2 seconds for DB writes...");
  await new Promise(r => setTimeout(r, 2000));

  // 4. Trigger Analysis
  console.log("--- ANALYZING ---");
  const res = await fetch(`http://localhost:3002/analyze/${sessionId}`);
  const data = await res.json();
  
  console.log("📊 Rubric Results:");
  console.log(`- Retrieval Effort Score: ${data.scores.retrievalEffort} / 3`);
  console.log(`- Hand Movement: ${data.metrics.avgHandMovementMeters} meters`);
  console.log(`- Has Sensor Data: ${data.metrics.hasSensorData}`);
}

runTest();