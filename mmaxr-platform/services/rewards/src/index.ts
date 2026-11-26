import { createApp } from './app';
import { initSchema, pgDb } from './db';
import { Rewards, type Sources } from './service';

/**
 * rewards — card packs, collections, weekly Learning Rings and personal bests.
 *
 *   POST /sessions/:sessionId/claim        award the pack for a completed session (safe to retry)
 *   GET  /sessions/:sessionId/progress     leave-lab popup: progress and what finishing would earn
 *   GET  /packs?unopened=true              the student's packs
 *   POST /packs/:packId/open               reveal a pack's cards in order
 *   GET  /collection?subject=&set=         owned and missing cards, per-set progress
 *   GET  /cards/:cardId                    one card
 *   POST /shards/upgrade                   spend shards to make an owned card foil
 *   GET  /rings/current?week=              this week's three rings (closing all three awards a bonus pack)
 *   PUT  /rings/goal-level                 light | standard | stretch
 *   GET  /personal-bests                   best score, fastest time and mastery level per lab
 *   GET  /instructor/rings?week=           ring progress for every student, with stalled students flagged
 *   GET  /instructor/students/:id/collection
 *   GET|PUT /instructor/ring-goals         the weekly goals
 *
 * Student and instructor routes take the user-auth bearer token. Packs are only ever earned, never sold.
 */

const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev';
if (IS_PROD && JWT_SECRET === 'mmaxr-dev-secret-change-me') throw new Error('JWT_SECRET must be set in production');
if (IS_PROD && INTERNAL_KEY === 'mmaxr-internal-dev') throw new Error('INTERNAL_API_KEY must be set in production');

const RUBRIC_ENGINE_URL = process.env.RUBRIC_ENGINE_URL || 'http://localhost:3002';
const LESSON_LOADER_URL = process.env.LESSON_LOADER_URL || 'http://localhost:3007';

async function internalGet(url: string): Promise<Record<string, any> | null> {
  const res = await fetch(url, { headers: { 'x-internal-key': INTERNAL_KEY }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  return (await res.json()) as Record<string, any>;
}

const sources: Sources = {
  async score(sessionId) {
    const r = await internalGet(`${RUBRIC_ENGINE_URL}/internal/score/${encodeURIComponent(sessionId)}`);
    return typeof r?.percent === 'number' ? r.percent : null;
  },
  assignment: (sessionId) => internalGet(`${LESSON_LOADER_URL}/internal/assignments/${encodeURIComponent(sessionId)}`),
};

const db = pgDb(process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr');
initSchema(db).catch((err) => console.error('❌ rewards DB init failed:', err));

const app = createApp(new Rewards(db, sources), JWT_SECRET);
const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
  console.log(`🃏 Rewards Service running on http://localhost:${PORT}`);
});
