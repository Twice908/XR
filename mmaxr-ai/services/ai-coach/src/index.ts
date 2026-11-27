import http from 'http';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket } from 'ws';
import { ProviderRegistry } from './providers';
import { MODES, type Assignment, type ClientMessage, type ServerMessage } from './protocol';
import { CoachSession } from './session';
import { RateWindow } from './rateLimit';
import { createTts } from './voice/tts';
import { createStt } from './voice/stt';

// Local development keys live in ai-coach/.env (untracked). Never log their values.
try {
  process.loadEnvFile();
} catch {
  /* no .env file */
}

const PORT = Number(process.env.PORT || process.env.AI_COACH_PORT || 3003);
const SESSION_AUTH_URL = process.env.SESSION_AUTH_URL || 'http://localhost:3004';
const LESSON_LOADER_URL = process.env.LESSON_LOADER_URL || 'http://localhost:3007';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev';
const REQUIRE_SESSION = process.env.AI_COACH_REQUIRE_SESSION !== 'false';
const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
const ALLOWED_ORIGINS = (process.env.AI_COACH_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Student questions are what cost money (one model call each), so they have their own, tight limit.
const ASKS_PER_MINUTE = Math.max(1, Number(process.env.AI_COACH_ASKS_PER_MINUTE) || 5);
// Everything else (hello, mode, voice, lab events) only guards against a runaway client.
const MESSAGES_PER_MINUTE = 40;
// Floor and cancel messages cost nothing and come with every narration line and talk-button press; their own cap
// keeps them from crowding out (or being crowded out by) the rest.
const FLOOR_PER_MINUTE = 120;

const registry = new ProviderRegistry(process.env);
const tts = createTts(process.env);
const stt = createStt(process.env);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Which providers exist and which is active. Reports whether a key is set, never the key.
app.get('/providers', (_req, res) => res.json({ providers: registry.list() }));

// Switch the active provider at runtime. Instructor token required.
app.post('/admin/provider', (req, res) => {
  const header = req.headers.authorization || '';
  try {
    const claims = jwt.verify(header.startsWith('Bearer ') ? header.slice(7) : '', JWT_SECRET) as jwt.JwtPayload;
    if (claims.role !== 'instructor') return res.status(403).json({ error: 'Instructor access only' });
  } catch {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }
  if (!registry.set(String(req.body?.provider ?? ''))) return res.status(400).json({ error: 'provider must be anthropic, openai or gemini' });
  console.log(`[ai-coach] active provider is now ${registry.active.name}`);
  res.json({ providers: registry.list() });
});

const server = http.createServer(app);
// A spoken question (audio_ask) is the largest message: about 2 MB of audio, as base64.
const wss = new WebSocketServer({ server, maxPayload: 3 * 1024 * 1024 });

async function authorize(url: URL): Promise<boolean> {
  if (!REQUIRE_SESSION) return true;
  const sessionId = url.searchParams.get('sessionId');
  const token = url.searchParams.get('token');
  if (!sessionId || !token) return false;
  try {
    // session-auth answers 200 only when the token belongs to this session.
    const res = await fetch(`${SESSION_AUTH_URL}/auth/verify/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

wss.on('connection', async (ws: WebSocket, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length && origin && !ALLOWED_ORIGINS.includes(origin)) return ws.close(4403, 'origin not allowed');
  if (!(await authorize(url))) return ws.close(4401, 'unauthorized');

  const tag = (url.searchParams.get('sessionId') || 'anon').slice(0, 14);
  const send = (m: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const sessionId = url.searchParams.get('sessionId') || '';
  const loadAssignment = async () => {
    const res = await fetch(`${LESSON_LOADER_URL}/internal/assignments/${encodeURIComponent(sessionId)}`, { headers: { 'x-internal-key': INTERNAL_KEY } });
    if (!res.ok) return null;
    const a = (await res.json()) as { submitted: boolean; tubes: Assignment['tubes'] };
    return { submitted: a.submitted === true, tubes: a.tubes ?? [] };
  };
  // The lab's public context: read once per session, on the first question (CoachSession.ensureContext).
  const loadContext = async (lessonId: string) => {
    const res = await fetch(`${LESSON_LOADER_URL}/internal/lessons/${encodeURIComponent(lessonId)}/context`, { headers: { 'x-internal-key': INTERNAL_KEY } });
    if (!res.ok) return null;
    const body = (await res.json()) as { context?: string; narration?: Record<string, string> };
    return { context: body.context ?? '', narration: body.narration ?? {} };
  };
  const session = new CoachSession({ registry, loadAssignment, loadContext, tts, stt, asksPerMinute: ASKS_PER_MINUTE, send, log: (l) => console.log(`[ai-coach ${tag}] ${l}`) });
  console.log(`[ai-coach ${tag}] connected (provider ${registry.active.name})`);
  session.announce();

  const messages = new RateWindow(MESSAGES_PER_MINUTE);
  const floorMessages = new RateWindow(FLOOR_PER_MINUTE);

  ws.on('message', (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return messages.take() ? send({ type: 'error', message: 'Messages must be JSON.' }) : undefined;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return void messages.take();
    const cheap = msg.type === 'floor' || msg.type === 'cancel';
    if (!(cheap ? floorMessages : messages).take()) return send({ type: 'error', message: 'Slow down a little.' });
    if (msg.type === 'mode' && !(MODES as string[]).includes(msg.mode)) return;
    if (msg.type === 'ask' && (typeof msg.text !== 'string' || !msg.text.trim())) return;
    // The 5-questions-a-minute limit lives in the session, so typed and spoken questions share it.
    void session.handle(msg).catch((err) => {
      console.error(`[ai-coach ${tag}] handler error:`, (err as Error).message);
      send({ type: 'error', message: 'The coach hit a problem.' });
    });
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  const p = registry.active;
  console.log(`🤖 AI Coach on ws://localhost:${PORT} · provider ${p.name} (${p.model}) · key ${p.isConfigured() ? 'set' : 'MISSING'} · voice ${tts.available() ? tts.name : 'off (set PIPER_BIN and PIPER_MODEL)'} · listening ${stt.available() ? stt.name : 'off (set WHISPER_BIN and WHISPER_MODEL)'} · ${ASKS_PER_MINUTE} questions/min`);
});
