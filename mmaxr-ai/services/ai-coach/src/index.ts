import express from 'express';
import { WebSocketServer } from 'ws';
import { applyGuardrails } from '@mmaxr/guardrails';

const app = express();
const PORT = process.env.PORT || 3003;

const server = app.listen(PORT, () => {
  console.log(`🤖 AI Coach WebSocket running on ws://localhost:${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('🎓 Student connected to AI Coach');

  ws.on('message', async (data) => {
    const message = data.toString();
    console.log(`\n[Student]: ${message}`);

    // --- MOCK LLM RESPONSE ---
    // We simulate the LLM trying to be "too helpful" and giving the answer.
    let mockLlmResponse = "";
    if (message.toLowerCase().includes("wavelength") || message.toLowerCase().includes("answer")) {
      mockLlmResponse = "The wavelength is 656.2 nanometers. You should use the Rydberg formula.";
    } else {
      mockLlmResponse = "Interesting thought. What did you expect to happen when you fired the photon?";
    }

    // --- APPLY GUARDRAILS ---
    const { safeResponse, wasBlocked } = applyGuardrails(mockLlmResponse);

    if (wasBlocked) {
      console.log(`[🛑 GUARDRAIL BLOCKED RAW AI]: ${mockLlmResponse}`);
    }
    
    console.log(`[Coach]: ${safeResponse}`);
    ws.send(safeResponse);
  });
});