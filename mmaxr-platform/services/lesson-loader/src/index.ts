import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cors());

const assetsPath = path.join(__dirname, '../../../../mmaxr-assets');
app.use('/assets', express.static(assetsPath));

app.get('/lessons/active', (req, res) => {
  try {
    // Default to physics, but allow querying chemistry
    const lessonType = req.query.type === 'chemistry' ? 'chemistry-101' : 'physics-101';
    const dataPath = path.join(__dirname, `../data/${lessonType}.json`);
    
    const lessonData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // If it's the Chemistry lab, inject 5 random solutions
    if (lessonData.type === "chemistry_indicators") {
      const pool = lessonData.solutionPool;
      
      // Fisher-Yates Shuffle
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      // Select 5 random solutions
      const assigned = shuffled.slice(0, lessonData.config.totalTestTubes);
      
      // Replace the pool with the assigned solutions in the payload
      lessonData.assignedSolutions = assigned;
      delete lessonData.solutionPool; // Don't send the whole pool to the client
    }

    res.json(lessonData);
  } catch (error) {
    console.error('Error reading lesson data:', error);
    res.status(500).json({ error: 'Failed to load lesson contract' });
  }
});

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`📚 Lesson Loader running on http://localhost:${PORT}`);
  console.log(`📦 Serving 3D assets from: ${assetsPath}`);
});