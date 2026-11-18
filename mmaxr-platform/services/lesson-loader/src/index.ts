import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const app = express();
app.use(cors());

const assetsPath = path.join(__dirname, '../../../../mmaxr-assets');
app.use('/assets', express.static(assetsPath));

const dataDir = path.join(__dirname, '../data');
const LESSON_ID_RE = /^[a-z0-9-]+$/;

function readLesson(lessonId: string): any | null {
  if (!LESSON_ID_RE.test(lessonId)) return null;
  const file = path.join(dataDir, `${lessonId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Prepare a lesson for a session. Chemistry gets 5 random unknown solutions. */
function prepareLesson(lessonData: any) {
  if (lessonData.type === 'chemistry_indicators') {
    const shuffled = [...lessonData.solutionPool];
    // Fisher-Yates shuffle
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    lessonData.assignedSolutions = shuffled.slice(0, lessonData.config.totalTestTubes);
    delete lessonData.solutionPool; // never ship the whole pool to the client
  }
  return lessonData;
}

// Catalog of experiments for the experiment picker.
app.get('/lessons', (_req, res) => {
  try {
    const catalog = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')))
      .map((l) => ({
        lessonId: l.lessonId,
        type: l.type,
        title: l.title,
        subject: l.subject ?? null,
        summary: l.summary ?? null,
        durationMinutes: l.durationMinutes ?? null,
        difficulty: l.difficulty ?? null,
      }));
    res.json(catalog);
  } catch (error) {
    console.error('Error reading lesson catalog:', error);
    res.status(500).json({ error: 'Failed to load lesson catalog' });
  }
});

// Legacy entry point used by the Unity client. Defaults to physics unless ?type=chemistry.
// Declared before /lessons/:lessonId so "active" is not read as a lesson id.
app.get('/lessons/active', (req, res) => {
  try {
    const lessonId = req.query.type === 'chemistry' ? 'chemistry-101' : 'physics-101';
    res.json(prepareLesson(readLesson(lessonId)));
  } catch (error) {
    console.error('Error reading lesson data:', error);
    res.status(500).json({ error: 'Failed to load lesson contract' });
  }
});

// A single lesson contract, prepared for a new session.
app.get('/lessons/:lessonId', (req, res) => {
  try {
    const lesson = readLesson(req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    res.json(prepareLesson(lesson));
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
