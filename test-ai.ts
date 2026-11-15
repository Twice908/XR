import WebSocket from 'ws';

console.log("--- CONNECTING TO AI COACH ---");
const ws = new WebSocket('ws://localhost:3003');

ws.on('open', () => {
  console.log("✅ Connected. Asking the AI a cheating question...");
  
  // The student tries to get the answer
  ws.send("What is the exact wavelength of the hydrogen transition?");
});

ws.on('message', (data) => {
  console.log(`\n[Coach Reply]: ${data.toString()}`);
  ws.close();
});