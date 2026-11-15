async function testSensorUpload() {
  console.log("--- TESTING SENSOR UPLOAD ---");
  
  const sessionId = "sess_test_001";
  const csvData = "timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z\n1690000000,0.5,1.6,0.2,0.4,1.2,-0.1\n";
  const blob = new Blob([csvData], { type: 'text/csv' });

  const formData = new FormData();
  formData.append('file', blob, 'sensor_data.csv');

  try {
    const res = await fetch(`http://localhost:3005/upload/${sessionId}`, {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    
    if (res.ok) {
      console.log("✅ Upload Response:", data);
      console.log("👉 Verify in MinIO: http://localhost:9001 (User: admin, Pass: password)");
    } else {
      console.error("❌ Upload Failed:", data);
    }
  } catch (error) {
    console.error("❌ Network Error:", error);
  }
}

testSensorUpload();