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
      ALTER TABLE xapi_events ADD COLUMN IF NOT EXISTS device VARCHAR(8);
      CREATE INDEX IF NOT EXISTS xapi_events_student_idx ON xapi_events (student_id);
      CREATE INDEX IF NOT EXISTS xapi_events_session_idx ON xapi_events (session_id);
    `);
    console.log('✅ Database connected and table ensured.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
  }
}
initDB();

// The Endpoint the VR client will hit
app.post('/events', async (req, res) => {
  try {
    // Check if the client sent an array of events or a single event
    const events = Array.isArray(req.body) ? req.body : req.body.events ? req.body.events : [req.body];
    
    if (!events || events.length === 0) {
      return res.status(400).json({ error: 'No events provided' });
    }

    // Loop through and save each event to Postgres
    for (const event of events) {
      if (!event.sessionId || !event.verb) continue; // Skip invalid ones

      await pool.query(
        `INSERT INTO xapi_events (session_id, student_id, verb, object_data, timestamp, device) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.sessionId, event.studentId || 'unknown', event.verb, event.object || {}, event.timestamp, event.device === 'web' || event.device === 'vr' ? event.device : null]
      );
    }
    
    console.log(`[DB Insert] ${events.length} event(s) recorded.`);
    res.status(201).json({ success: true, count: events.length });
  } catch (err) {
    console.error('DB Insert Error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 xAPI Emitter running on http://localhost:${PORT}`);
});

