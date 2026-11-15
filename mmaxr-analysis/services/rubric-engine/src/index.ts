import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { XapiVerb } from '@mmaxr/schema';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '../../../apps/instructor-dashboard')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// The Analysis Endpoint
app.get('/analyze/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    // 1. Fetch the raw action trace from Postgres
    const result = await pool.query(
      `SELECT verb, object_data, timestamp FROM xapi_events 
       WHERE session_id = $1 ORDER BY timestamp ASC`,
      [sessionId]
    );
    const events = result.rows;

    if (events.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }
    const safeEvents = events.map(e => ({ ...e, timestamp: Number(e.timestamp) }));

    // 2. Initialize Scoring Variables
    let predictionsMade = 0;
    let actionsMade = 0;
    let anomaliesNoticed = 0;
    let anomaliesIgnored = 0;

    let currentAnomalyActive = false;

    // 3. Iterate through the trace to calculate the rubric
    for (const event of events) {
      if (event.verb === XapiVerb.PREDICTED) {
        predictionsMade++;
      }
      if (event.verb === XapiVerb.ACTED) {
        actionsMade++;
        // If an action happens and there was an active anomaly that wasn't noticed, they ignored it
        if (currentAnomalyActive) {
          anomaliesIgnored++;
          currentAnomalyActive = false;
        }
      }
      if (event.verb === XapiVerb.NOTICED_ANOMALY) {
        anomaliesNoticed++;
        currentAnomalyActive = false; // They noticed it, so it's resolved
      }
      // Simulate anomaly injection for the 4th action (based on our WebXR logic)
      if (event.verb === XapiVerb.OBSERVED && actionsMade === 4) {
         // In a real app, we check the actual data payload here.
         // For now, we know the 4th action triggers the anomaly.
         currentAnomalyActive = true;
      }
    }

        // 4. Calculate Deterministic Scores (0-3 scale)
    
    // Rubric 1: Prediction Discipline (Did they predict before every action?)
    let predictionScore = 0;
    if (actionsMade > 0) {
      const ratio = predictionsMade / actionsMade;
      if (ratio >= 1) predictionScore = 3;
      else if (ratio >= 0.5) predictionScore = 2;
      else if (ratio > 0) predictionScore = 1;
    }

    // Rubric 2: Retrieval Effort (Time spent thinking before acting)
    // We measure the average time between PREDICTED and ACTED
    let totalThinkTime = 0;
    let thinkCount = 0;
    for (let i = 0; i < events.length - 1; i++) {
        if (events[i].verb === 'predicted' && events[i+1].verb === 'acted') {
            const timeDiff = Number(events[i+1].timestamp) - Number(events[i].timestamp);
            totalThinkTime += timeDiff;
            thinkCount++;
        }
    }
    const avgThinkTime = thinkCount > 0 ? totalThinkTime / thinkCount : 0;
    // If they take more than 2 seconds to think after predicting, they are retrieving
    let retrievalScore = avgThinkTime > 2000 ? 3 : (avgThinkTime > 500 ? 2 : 1);

    // Rubric 3: Revision Quality (Did they notice the anomaly?)
    let revisionScore = 0;
    if (anomaliesNoticed > 0) revisionScore = 3;
    else if (anomaliesIgnored > 0) revisionScore = 0;
    else revisionScore = 1; 

    // Rubric 4: Causal Coherence (Did they explain the mechanism?)
    // We check the 'explained' event payload for keywords
    let causalScore = 0;
    const explainEvent = events.find(e => e.verb === 'explained');
    if (explainEvent && explainEvent.object_data && explainEvent.object_data.text) {
        const text = explainEvent.object_data.text.toLowerCase();
        // Did they use cause -> mechanism -> observable words?
        if (text.includes('energy') && text.includes('transition') && text.includes('wavelength')) causalScore = 3;
        else if (text.includes('energy') || text.includes('transition')) causalScore = 2;
        else causalScore = 1;
    }

    // Rubric 5: Metacognitive Calibration (Time to notice anomaly)
    // Fast noticing = good calibration
    let metaScore = 1;
    for (let i = 0; i < events.length - 1; i++) {
        if (events[i].verb === 'observed' && events[i+1].verb === 'noticed_anomaly') {
            const timeDiff = Number(events[i+1].timestamp) - Number(events[i].timestamp);
            if (timeDiff < 3000) metaScore = 3; // Noticed in under 3 seconds
            else metaScore = 2;
        }
    }

    // Rubric 6: Transfer (Did they complete the new Z probe?)
    const transferEvent = events.find(e => e.verb === 'transferred');
    let transferScore = transferEvent ? 3 : 0;

    // 5. Send the Report
    res.json({
      sessionId,
      timestamp: new Date().toISOString(),
      scores: {
        predictionDiscipline: predictionScore,
        retrievalEffort: retrievalScore,
        revisionQuality: revisionScore,
        causalCoherence: causalScore,
        metacognitiveCalibration: metaScore,
        transfer: transferScore
      },
      metrics: {
        predictionsMade,
        actionsMade,
        anomaliesNoticed,
        anomaliesIgnored,
        avgThinkTimeMs: Math.round(avgThinkTime)
      },
      trace: safeEvents
    });

  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Get a list of recent sessions for the dropdown
app.get('/sessions', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT session_id, COUNT(*) as event_count, MAX(timestamp) as last_update 
       FROM xapi_events 
       GROUP BY session_id 
       ORDER BY last_update DESC LIMIT 10`
    );
    const safeRows = result.rows.map(r => ({ ...r, last_update: Number(r.last_update) }));
    res.json(safeRows);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`📊 Rubric Engine running on http://localhost:${PORT}`);
});