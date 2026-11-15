import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Pool } from 'pg';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

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
    if (!req.file) {
      if (!res.headersSent) return res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // 1. Forward the file to the object-store service
    const storeRes = await fetch('http://localhost:3006/upload/base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      `INSERT INTO session_manifests (session_id, file_type, file_url, uploaded_at) 
       VALUES ($1, $2, $3, $4)`,
      [sessionId, 'sensor_csv', storeData.url, Date.now()]
    );

    console.log(`[Sensor Stream] Logged manifest for ${sessionId}`);
    
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