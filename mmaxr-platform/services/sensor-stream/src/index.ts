import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Pool } from 'pg';

const app = express();
app.use(cors());
app.use(express.json());

// One chunk is about 20 s of 30 Hz samples (~40 KB); 2 MB leaves room for a long single upload from older clients.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const SESSION_AUTH_URL = process.env.SESSION_AUTH_URL || 'http://localhost:3004';
const OBJECT_STORE_URL = process.env.OBJECT_STORE_URL || 'http://localhost:3006';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev';

/** Does this token belong to this session? The browser sends it as a header, or as a form field from sendBeacon. */
async function validSession(sessionId: string, token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${SESSION_AUTH_URL}/auth/verify/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch {
    return false;
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// Initialize DB table for tracking uploads
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session_manifests (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        file_type VARCHAR(50),
        file_url TEXT,
        uploaded_at BIGINT
      );
      ALTER TABLE session_manifests ADD COLUMN IF NOT EXISTS part INTEGER;
    `);
    console.log('✅ Database connected and manifest table ensured.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
  }
}
initDB();

// Endpoint to receive sensor data CSV from clients
app.post('/upload/:sessionId', upload.single('file'), async (req, res) => {
  try {
    const { sessionId } = req.params;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : typeof req.body?.token === 'string' ? req.body.token : '';
    if (!(await validSession(sessionId, token))) return res.status(401).json({ error: 'Invalid session token' });
    // Clients upload the CSV in numbered chunks during the session; the rubric engine joins them in order.
    const part = Number.isInteger(Number(req.body?.part)) ? Number(req.body.part) : null;
    if (!req.file) {
      if (!res.headersSent) return res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // 1. Forward the file to the object-store service
    const storeRes = await fetch(`${OBJECT_STORE_URL}/upload/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        fileBase64: req.file.buffer.toString('base64'),
      }),
    });

    const storeResponseText = await storeRes.text();
    if (!storeRes.ok) {
      console.error('[Sensor Stream] Object store response:', storeResponseText);
      throw new Error('Object store failed');
    }
    const storeData = JSON.parse(storeResponseText);

    // 2. Save the manifest to Postgres
    await pool.query(
      `INSERT INTO session_manifests (session_id, file_type, file_url, uploaded_at, part)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, 'sensor_csv', storeData.url, Date.now(), part]
    );

    console.log(`[Sensor Stream] Logged manifest for ${sessionId}${part !== null ? ` (part ${part})` : ''}`);
    
    if (!res.headersSent) {
      res.status(201).json({
        message: storeData.message,
        success: true,
        url: storeData.url,
        filename: storeData.filename,
      });
    }
  } catch (err) {
    console.error('❌ Sensor Stream Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to process sensor stream' });
    }
  }
});

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`📡 Sensor Stream running on http://localhost:${PORT}`);
});