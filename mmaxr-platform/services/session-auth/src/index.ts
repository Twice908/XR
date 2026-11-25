import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
// Sessions for a raw studentId without a user-auth token are only for local scripts and the Unity prototype.
// They are refused unless this flag is set explicitly, so nobody can open a session as another student.
const ALLOW_ANONYMOUS = process.env.ALLOW_ANONYMOUS_SESSIONS === 'true';

const app = express();
app.use(cors());
app.use(express.json());

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().then(() => console.log('✅ Connected to Redis'));

const bearer = (req: express.Request) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
};

/** Constant-time string comparison, so the token check does not leak how much of a guess was right. */
const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Endpoint to generate a new session
app.post('/auth/session', async (req, res) => {
  try {
    let studentId: string | undefined;
    const { lessonId, device } = req.body ?? {};

    // The pseudonymous account id from the user-auth token is the student id.
    const token = bearer(req);
    if (token) {
      try {
        const claims = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
        if (claims.sub) studentId = String(claims.sub);
      } catch {
        return res.status(401).json({ error: 'Invalid or expired user token' });
      }
    } else if (ALLOW_ANONYMOUS && typeof req.body?.studentId === 'string' && req.body.studentId) {
      studentId = req.body.studentId;
    } else if (!ALLOW_ANONYMOUS) {
      return res.status(401).json({ error: 'Sign in first: a user token is required to open a session' });
    }

    if (!studentId) {
      if (!res.headersSent) return res.status(400).json({ error: 'studentId is required' });
      return;
    }

    const sessionId = `sess_${uuidv4()}`;
    const sessionToken = `tok_${uuidv4()}`;

    // Store session in Redis for 24 hours (86400 seconds)
    await redisClient.setEx(
      `session:${sessionId}`,
      86400,
      JSON.stringify({ studentId, lessonId: lessonId || 'physics-101', token: sessionToken, device: device === 'vr' ? 'vr' : 'web', createdAt: Date.now() })
    );

    console.log(`[Auth] Created session ${sessionId} for student ${studentId} (Lesson: ${lessonId || 'physics-101'})`);

    if (!res.headersSent) {
      res.status(201).json({ sessionId, token: sessionToken, studentId, lessonId: lessonId || 'physics-101', device: device === 'vr' ? 'vr' : 'web' });
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Check a session token. The caller must present the session's own token (Authorization: Bearer tok_...);
// the token itself is never returned, so knowing a session id is not enough to act as that session.
app.get('/auth/verify/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Session token required' });

    const sessionData = await redisClient.get(`session:${sessionId}`);
    if (!sessionData) return res.status(404).json({ error: 'Session not found or expired' });

    const { token: stored, ...session } = JSON.parse(sessionData) as { token: string } & Record<string, unknown>;
    if (typeof stored !== 'string' || !sameToken(stored, token)) return res.status(401).json({ error: 'Invalid session token' });

    res.json(session);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

const PORT = process.env.PORT || 3004;
app.listen(PORT, () => {
  console.log(`🔐 Session Auth Service running on http://localhost:${PORT}`);
});
