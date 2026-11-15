async function testSessionAuth() {
  console.log("--- TESTING SESSION AUTH ---");
  const backendUrl = 'http://localhost:3004/auth/session';

  try {
    // 1. Create a session
    const createRes = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'student_anon_99' })
    });
    
    const sessionData = await createRes.json();
    console.log("✅ Created Session:", sessionData);

    // 2. Verify the session
    const verifyRes = await fetch(`http://localhost:3004/auth/verify/${sessionData.sessionId}`);
    const verifiedData = await verifyRes.json();
    console.log("✅ Verified Session:", verifiedData);

  } catch (error) {
    console.error("❌ Network Error - Is the backend running?", error);
  }
}

testSessionAuth();