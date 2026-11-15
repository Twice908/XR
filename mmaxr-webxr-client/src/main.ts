import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XapiVerb, TelemetryEvent } from '@mmaxr/schema';
import { SpectralSimulation } from '@mmaxr/domain-simulation';

// --- 1. SETUP SCENE ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505); // Dark lab
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 3); // Average human height

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);

// --- 2. THE SIMULATION & STATE ---
const sessionId = `sess_${Date.now()}`;
const studentId = "student_anon_01";
const sim = new SpectralSimulation(1); // Hydrogen

// State machine variables
let currentState: 'IDLE' | 'PREDICTED' | 'ACTED' = 'IDLE';
let predictedWavelength = 0;
const targetNInitial = 3;
const targetNFinal = 2;

// --- 3. BUILD THE LAB OBJECTS ---
// The Spectrometer Screen
const screenGeo = new THREE.PlaneGeometry(2, 1);
const screenMat = new THREE.MeshStandardMaterial({ color: 0x222233 });
const spectrometer = new THREE.Mesh(screenGeo, screenMat);
spectrometer.position.set(0, 1.5, -1);
scene.add(spectrometer);

// The Prediction Marker
const markerGeo = new THREE.SphereGeometry(0.05);
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const predictionMarker = new THREE.Mesh(markerGeo, markerMat);
predictionMarker.visible = false;
scene.add(predictionMarker);

// The Result Line (Anomaly/Observed)
const resultGeo = new THREE.PlaneGeometry(0.02, 0.8);
const resultMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const resultLine = new THREE.Mesh(resultGeo, resultMat);
resultLine.visible = false;
resultLine.position.set(0, 1.5, -0.95);
scene.add(resultLine);

// --- 4. INTERACTION LOGIC (Mouse & WebXR Controllers) ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const controller = renderer.xr.getController(0);

function onSelect() {
  // Handle Desktop Mouse
  if (!renderer.xr.isPresenting) {
    raycaster.setFromCamera(mouse, camera);
  } else {
    // Handle VR Controller (Pointing forward)
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  }

  const intersects = raycaster.intersectObject(spectrometer);

  if (intersects.length > 0) {
    const point = intersects[0].point;
    
    if (currentState === 'IDLE') {
      // 1. PREDICTION PHASE
      predictionMarker.position.copy(point);
      predictionMarker.visible = true;
      
      // Map the physical click position to a fake wavelength (visual only for now)
      predictedWavelength = 656.2; 
      
      logEvent(XapiVerb.PREDICTED, { value: predictedWavelength, target: "spectrometer" });
      updateUI('PREDICTED', 'Click the screen again to FIRE photon');
      currentState = 'PREDICTED';

    } else if (currentState === 'PREDICTED') {
      // 2. ACTION PHASE
      logEvent(XapiVerb.ACTED, { action: "fire_photon", nInitial: targetNInitial, nFinal: targetNFinal });
      
      const result = sim.firePhoton(targetNInitial, targetNFinal);
      
      // Show the result line
      resultLine.visible = true;
      // Fake visual feedback: Turn red if anomaly, green if normal
      resultMat.color.setHex(result.isAnomaly ? 0xff0000 : 0x00ff00);
      
      logEvent(XapiVerb.OBSERVED, { value: result.measuredWavelength });

      if (result.isAnomaly) {
        logEvent(XapiVerb.NOTICED_ANOMALY, { expected: predictedWavelength, actual: result.measuredWavelength });
        updateUI('ANOMALY DETECTED', 'Click to try and resolve');
      } else {
        updateUI('IDLE', 'Click the glowing screen to Predict');
      }
      
      currentState = 'IDLE';
    }
  }
}

// Setup Desktop Listeners
window.addEventListener('pointermove', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
});
window.addEventListener('pointerdown', onSelect);

// Setup VR Listeners
controller.addEventListener('selectstart', onSelect);
scene.add(controller);

// --- 5. UTILITIES ---
function updateUI(status: string, instruction: string) {
  document.getElementById('status')!.textContent = status;
  document.getElementById('instruction')!.textContent = instruction;
}

async function logEvent(verb: XapiVerb, object: any) {
  const event: TelemetryEvent = { sessionId, studentId, timestamp: Date.now(), verb, object };
  console.log(`[Sending] ${verb}`);
  try {
    await fetch('http://localhost:3001/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
  } catch (e) {
    console.warn("Backend offline. Event not saved.");
  }
}

// --- 6. RENDER LOOP ---
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

// --- 7. AI COACH WEBSOCKET INTEGRATION ---
const chatHistory = document.getElementById('chat-history')!;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn')!;

// Connect to the AI Coach Service
const ws = new WebSocket('ws://localhost:3003');

ws.onopen = () => {
  console.log('🔗 Connected to AI Coach WebSocket');
};

ws.onmessage = (event) => {
  const aiResponse = event.data;
  
  // Add AI response to chat UI
  const msgDiv = document.createElement('div');
  msgDiv.className = 'ai-msg';
  msgDiv.innerHTML = `<strong>Coach:</strong> ${aiResponse}`;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
};

ws.onerror = (error) => {
  console.error('WebSocket Error:', error);
};

// Send message to AI Coach
function sendMessageToCoach() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 1. Add user message to UI
  const msgDiv = document.createElement('div');
  msgDiv.className = 'user-msg';
  msgDiv.innerHTML = `<strong>You:</strong> ${text}`;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // 2. Send to WebSocket
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(text);
  } else {
    console.error("WebSocket is not connected.");
  }

  // 3. Clear input
  chatInput.value = '';
}

// Setup Event Listeners for Chat
sendBtn.addEventListener('click', sendMessageToCoach);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessageToCoach();
});