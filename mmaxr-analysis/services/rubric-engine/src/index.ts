import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { XapiVerb, SensorDataRow } from '@mmaxr/schema';

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// Initialize S3 Client to read from MinIO
const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'admin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'password',
  },
});

// Helper to fetch and parse CSV from MinIO
async function getSensorData(sessionId: string): Promise<SensorDataRow[]> {
  try {
    // 1. Look up the file URL in Postgres
    const manifestRes = await pool.query(
      `SELECT file_url FROM session_manifests WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );
    
    if (manifestRes.rows.length === 0) return []; // No CSV uploaded

    // 2. Extract filename from URL and download from MinIO
    const fileUrl = manifestRes.rows[0].file_url;
    const filename = fileUrl.split('/').pop();
    
    const s3Res = await s3Client.send(new GetObjectCommand({
      Bucket: 'mmaxr-telemetry',
      Key: filename,
    }));

    const csvString = await s3Res.Body?.transformToString();
    if (!csvString) return [];

    // 3. Parse the CSV
    const lines = csvString.trim().split('\n');
    const data: SensorDataRow[] = [];
    
    // Skip the header (line 0) and parse rows
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length >= 7) {
        data.push({
          timestamp: Number(cols[0]),
          head_x: Number(cols[1]), head_y: Number(cols[2]), head_z: Number(cols[3]),
          hand_x: Number(cols[4]), hand_y: Number(cols[5]), hand_z: Number(cols[6]),
        });
      }
    }
    return data;
  } catch (err) {
    console.error('Error fetching sensor CSV:', err);
    return [];
  }
}

app.get('/analyze/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const result = await pool.query(
      `SELECT verb, object_data, timestamp FROM xapi_events 
       WHERE session_id = $1 ORDER BY timestamp ASC`,
      [sessionId]
    );
    const events = result.rows;

    if (events.length === 0) {
      if (!res.headersSent) return res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Fetch the spatial data
    const sensorData = await getSensorData(sessionId);

    let predictionsMade = 0;
    let actionsMade = 0;
    let anomaliesNoticed = 0;
    
    let totalThinkTime = 0;
    let thinkCount = 0;
    let totalHandMovement = 0; // Measured during think time

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      if (event.verb === XapiVerb.PREDICTED) predictionsMade++;
      if (event.verb === XapiVerb.ACTED) actionsMade++;
      if (event.verb === XapiVerb.NOTICED_ANOMALY) anomaliesNoticed++;

      // Calculate time and movement between PREDICTED and ACTED
      if (event.verb === XapiVerb.PREDICTED && i + 1 < events.length) {
        const nextEvent = events[i + 1];
        if (nextEvent.verb === XapiVerb.ACTED) {
          const timeDiff = Number(nextEvent.timestamp) - Number(event.timestamp);
          totalThinkTime += timeDiff;
          thinkCount++;

          // --- CSV ANALYZER: Physical Retrieval Effort ---
          // Calculate how much the hand moved between the prediction and the action
          if (sensorData.length > 0) {
            const startTime = Number(event.timestamp);
            const endTime = Number(nextEvent.timestamp);
            const intervalData = sensorData.filter(d => d.timestamp >= startTime && d.timestamp <= endTime);
            
            let handDistance = 0;
            for (let j = 1; j < intervalData.length; j++) {
              const dx = intervalData[j].hand_x - intervalData[j-1].hand_x;
              const dy = intervalData[j].hand_y - intervalData[j-1].hand_y;
              const dz = intervalData[j].hand_z - intervalData[j-1].hand_z;
              handDistance += Math.sqrt(dx*dx + dy*dy + dz*dz);
            }
            totalHandMovement += handDistance;
          }
        }
      }
    }

    // --- RUBRIC SCORING ---
    let predictionScore = actionsMade > 0 ? Math.min(3, Math.ceil((predictionsMade / actionsMade) * 3)) : 0;
    let revisionScore = anomaliesNoticed > 0 ? 3 : 0;
    
    // Retrieval Score is now based on BOTH time and physical movement
    const avgThinkTime = thinkCount > 0 ? totalThinkTime / thinkCount : 0;
    const avgHandMovement = thinkCount > 0 ? totalHandMovement / thinkCount : 0;
    
    let retrievalScore = 1;
    if (avgThinkTime > 2000 || avgHandMovement > 0.5) retrievalScore = 3; // Active thought or physical exploration
    else if (avgThinkTime > 500 || avgHandMovement > 0.1) retrievalScore = 2;

    if (!res.headersSent) {
      res.json({
        sessionId,
        timestamp: new Date().toISOString(),
        scores: {
          predictionDiscipline: predictionScore,
          retrievalEffort: retrievalScore,
          revisionQuality: revisionScore,
          causalCoherence: 1, // Handled by explain-back later
          metacognitiveCalibration: 1, // Handled by anomaly time later
          transfer: 0
        },
        metrics: {
          predictionsMade,
          actionsMade,
          anomaliesNoticed,
          avgThinkTimeMs: Math.round(avgThinkTime),
          avgHandMovementMeters: Number(avgHandMovement.toFixed(2)),
          hasSensorData: sensorData.length > 0
        },
        trace: events.map(e => ({ ...e, timestamp: Number(e.timestamp) }))
      });
    }

  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Analysis failed' });
  }
});

app.get('/sessions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT session_id, COUNT(*) as event_count, MAX(timestamp) as last_update 
       FROM xapi_events 
       GROUP BY session_id 
       ORDER BY last_update DESC LIMIT 10`
    );
    
    if (!res.headersSent) res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch sessions', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`📊 Rubric Engine with CSV Analyzer running on http://localhost:${PORT}`);
});