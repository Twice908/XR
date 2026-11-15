import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { TelemetryEvent } from '@mmaxr/schema';

const app = express();
app.use(cors());
app.use(express.json());

// Connect to the Postgres DB we spin up in Docker
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// Initialize DB table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xapi_events (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        student_id VARCHAR(255),
        verb VARCHAR(50),
        object_data JSONB,
        timestamp BIGINT
      );
    `);
    console.log('✅ Database connected and table ensured.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
  }
}
initDB();

// The Endpoint the VR client will hit
app.post('/events', async (req, res) => {
  const event: TelemetryEvent = req.body;
  
  if (!event.sessionId || !event.verb) {
    return res.status(400).json({ error: 'Invalid event payload' });
  }

  try {
    await pool.query(
      `INSERT INTO xapi_events (session_id, student_id, verb, object_data, timestamp) 
       VALUES ($1, $2, $3, $4, $5)`,
      [event.sessionId, event.studentId, event.verb, event.object, event.timestamp]
    );
    
    console.log(`[DB Insert] ${event.verb} recorded for session ${event.sessionId}`);
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('DB Insert Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 xAPI Emitter running on http://localhost:${PORT}`);
});