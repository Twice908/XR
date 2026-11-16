async function testLessonLoader() {
  console.log("--- TESTING LESSON LOADER ---");
  
  try {
    // 1. Fetch the JSON Contract
    const res = await fetch('http://localhost:3007/lessons/active');
    const lesson = await res.json();
    
    console.log("✅ Lesson JSON Fetched:");
    console.log(`- Title: ${lesson.title}`);
    console.log(`- Model URL: ${lesson.modelUrl}`);
    console.log(`- Anomaly triggers on trial: ${lesson.simulation.anomalyTrialNumber}`);

    // 2. Verify the 3D model is actually accessible
    console.log("\n📦 Checking if 3D Model is accessible...");
    const modelRes = await fetch(lesson.modelUrl);
    
    if (modelRes.ok) {
      console.log(`✅ Success! Model found. Size: ${modelRes.headers.get('content-length')} bytes.`);
    } else {
      console.error("❌ Failed to find the 3D model. Did you put spectrometer.glb in mmaxr-assets/models?");
    }
  } catch (error) {
    console.error("❌ Network Error - Is the lesson-loader running?", error);
  }
}

testLessonLoader();