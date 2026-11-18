import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';

const app = express();
app.use(cors());
app.use(express.json());

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.connect().then(() => console.log('✅ Connected to Redis'));

// Endpoint to generate a new session
app.post('/auth/session', async (req, res) => {
  try {
    let { studentId } = req.body;
    const { lessonId, device } = req.body;

    // When the caller presents a user-auth token, the pseudonymous account id is the student id.
    // Anonymous callers (Unity prototype, test scripts) can still pass studentId directly.
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const claims = jwt.verify(header.slice(7), JWT_SECRET) as jwt.JwtPayload;
        if (claims.sub) studentId = String(claims.sub);
      } catch {
        return res.status(401).json({ error: 'Invalid or expired user token' });
      }
    }

    if (!studentId) {
      if (!res.headersSent) return res.status(400).json({ error: 'studentId is required' });
      return;
    }

    const sessionId = `sess_${uuidv4()}`;
    const token = `tok_${uuidv4()}`;
    
    // Store session in Redis for 24 hours (86400 seconds)
    await redisClient.setEx(
      `session:${sessionId}`, 
      86400, 
      JSON.stringify({ studentId, lessonId: lessonId || 'physics-101', token, device: device === 'vr' ? 'vr' : 'web', createdAt: Date.now() })
    );

    console.log(`[Auth] Created session ${sessionId} for student ${studentId} (Lesson: ${lessonId || 'physics-101'})`);

    if (!res.headersSent) {
      res.status(201).json({ sessionId, token, studentId, lessonId: lessonId || 'physics-101', device: device === 'vr' ? 'vr' : 'web' });
    }
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Endpoint to verify a session
app.get('/auth/verify/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const sessionData = await redisClient.get(`session:${sessionId}`);

    if (!sessionData) {
      if (!res.headersSent) return res.status(404).json({ error: 'Session not found or expired' });
      return;
    }

    if (!res.headersSent) {
      res.json(JSON.parse(sessionData));
    }
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