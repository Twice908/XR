import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cors());

// 1. Serve the 3D models statically so clients can download them
// We map the URL /assets to the mmaxr-assets folder at the root of the project
const assetsPath = path.join(__dirname, '../../../../mmaxr-assets');
app.use('/assets', express.static(assetsPath));

// 2. Serve the active lesson JSON contract
app.get('/lessons/active', (req, res) => {
  try {
    const dataPath = path.join(__dirname, '../data/physics-101.json');
    const lessonData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
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