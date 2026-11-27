import { PGlite } from '@electric-sql/pglite';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { CARDS } from '../catalog';
import { initSchema, type Db } from '../db';
import { weekRange } from '../rings';
import { Rewards, type Sources } from '../service';
import { seeded } from './seeded';

const SECRET = 'test-secret';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const TEACHER = '33333333-3333-4333-8333-333333333333';
const token = (sub: string, role: 'student' | 'instructor' = 'student') => `Bearer ${jwt.sign({ sub, role }, SECRET)}`;

function pgliteDb(pg: PGlite): Db {
  return {
    query: (sql, params) => pg.query(sql, params) as never,
    exec: async (sql) => {
      await pg.exec(sql);
    },
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
}

const WEEK = '2026-W48';
const T0 = weekRange(WEEK).start + 2 * 86_400_000; // a Wednesday in that week

let pg: PGlite;
let db: Db;
const scores = new Map<string, number | null>();
const sources: Sources = {
  score: async (id) => scores.get(id) ?? null,
  assignment: async () => ({ kind: 'missions', submitted: false, missionDetail: [{ met: true, questions: [{ answered: true }] }, { met: false, questions: [{ answered: false }] }] }),
};
let app: ReturnType<typeof createApp>;

/** Write a session into the xAPI log the way the emitter would. */
async function session(id: string, student: string, lesson: string, end: 'submit' | 'leave' | null, startMin = 0, minutes = 10) {
  const rows: [string, number][] = [['enter_lab', 0]];
  for (let m = 1; m <= minutes; m++) rows.push(['step', m]);
  if (end) rows.push([end === 'submit' ? 'submit_analysis' : 'leave_lab', minutes + 1]);
  for (const [action, m] of rows) {
    await pg.query(`INSERT INTO xapi_events (session_id, student_id, verb, object_data, timestamp, device) VALUES ($1, $2, 'interacted', $3::jsonb, $4, 'vr')`, [
      id, student, JSON.stringify({ action, target: action === 'enter_lab' ? lesson : null }), T0 + (startMin + m) * 60_000,
    ]);
  }
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE xapi_events (id SERIAL PRIMARY KEY, session_id VARCHAR(255), student_id VARCHAR(255), verb VARCHAR(50), object_data JSONB, timestamp BIGINT, device VARCHAR(8));`);
  db = pgliteDb(pg);
  await initSchema(db);
  await initSchema(db); // a second start must be harmless
}, 60_000);

beforeEach(async () => {
  await pg.exec(`TRUNCATE xapi_events, pack_cards, pack_awards, student_cards, student_reward_state, ring_weeks, personal_bests CASCADE;`);
  await pg.query(`UPDATE ring_goals SET explore_minutes = 60, master_count = 2, complete_count = 3, mastery_percent = 80`);
  scores.clear();
  app = createApp(new Rewards(db, sources, seeded(42), () => T0 + 86_400_000), SECRET);
});

describe('catalog in the database', () => {
  it('loads every card once', async () => {
    const { rows } = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM card_catalog`);
    expect(rows[0].n).toBe(CARDS.length);
  });
});

describe('claiming a pack', () => {
  it('awards one pack for a completed session and returns the same pack on retry', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    scores.set('s1', 72);
    const first = await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    expect(first.status).toBe(201);
    expect(first.body.pack).toMatchObject({ lessonId: 'atom-builder', scorePercent: 72, tier: 'standard', firstCompletion: true, cardCount: 4 });
    expect(first.body.personalBest).toMatchObject({ bestPercent: 72, masteryLevel: 3, newBestScore: false, completions: 1 });

    const again = await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    expect(again.status).toBe(200);
    expect(again.body.pack.id).toBe(first.body.pack.id);
    const { rows } = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pack_awards`);
    expect(rows[0].n).toBe(1);
  });

  it('gives one pack when two claims race', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    const [a, b] = await Promise.all([
      request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE)),
      request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.pack.id).toBe(b.body.pack.id);
  });

  it('refuses sessions left early or still running', async () => {
    await session('left', ALICE, 'atom-builder', 'leave');
    await session('running', ALICE, 'atom-builder', null);
    const l = await request(app).post('/sessions/left/claim').set('Authorization', token(ALICE));
    expect(l.status).toBe(409);
    expect(l.body.status).toBe('left');
    const r = await request(app).post('/sessions/running/claim').set('Authorization', token(ALICE));
    expect(r.status).toBe(409);
    expect(r.body.status).toBe('in_progress');
  });

  it('hides other students\' sessions and needs a student token', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    expect((await request(app).post('/sessions/s1/claim').set('Authorization', token(BOB))).status).toBe(404);
    expect((await request(app).post('/sessions/nope/claim').set('Authorization', token(ALICE))).status).toBe(404);
    expect((await request(app).post('/sessions/s1/claim')).status).toBe(401);
    expect((await request(app).post('/sessions/s1/claim').set('Authorization', token(TEACHER, 'instructor'))).status).toBe(403);
    expect((await request(app).post('/sessions/s1/claim').set('Authorization', `Bearer ${jwt.sign({ sub: ALICE, role: 'student' }, 'wrong')}`)).status).toBe(401);
  });

  it('applies the mastery guarantee, drops the first-completion bonus on repeats, and flags a new best', async () => {
    await session('s1', ALICE, 'ionic-bonding', 'submit', 0, 20);
    await session('s2', ALICE, 'ionic-bonding', 'submit', 100, 10);
    scores.set('s1', 60);
    scores.set('s2', 93);
    await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    const res = await request(app).post('/sessions/s2/claim').set('Authorization', token(ALICE));
    expect(res.body.pack).toMatchObject({ tier: 'mastery', firstCompletion: false, cardCount: 3 });
    expect(res.body.personalBest).toMatchObject({ newBestScore: true, previousBestPercent: 60, bestPercent: 93, newFastestTime: true, masteryLevel: 4, levelUp: true, completions: 2 });

    const open = await request(app).post(`/packs/${res.body.pack.id}/open`).set('Authorization', token(ALICE));
    expect(open.body.cards.some((c: { card: { rarity: string } }) => c.card.rarity !== 'common')).toBe(true);
  });

  it('still awards a pack when the rubric engine cannot score the session', async () => {
    await session('s1', ALICE, 'physics-sound', 'submit');
    const res = await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    expect(res.status).toBe(201);
    expect(res.body.pack.scorePercent).toBeNull();
  });
});

describe('opening packs and the collection', () => {
  it('reveals cards in slot order, adds them to the collection, and turns repeats into shards', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    const { body } = await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));

    const unopened = await request(app).get('/packs?unopened=true').set('Authorization', token(ALICE));
    expect(unopened.body.packs).toHaveLength(1);

    const open = await request(app).post(`/packs/${body.pack.id}/open`).set('Authorization', token(ALICE));
    expect(open.status).toBe(200);
    expect(open.body.alreadyOpened).toBe(false);
    expect(open.body.cards.map((c: { slot: number }) => c.slot)).toEqual([1, 2, 3, 4]);
    expect(open.body.cards.every((c: { isNew: boolean }) => c.isNew)).toBe(true);
    expect(open.body.cards[0].card.question.choices.length).toBeGreaterThanOrEqual(3);
    // Every revealed card that has drawn art comes with its address; others say null.
    for (const c of open.body.cards) {
      const drawn = c.card.set === 'elements' || c.card.subject === 'physics';
      if (drawn) expect(c.card.art.front).toMatch(/^\/cards\/a\/[0-9a-f]{32}-front\.webp$/);
      else expect(c.card.art).toBeNull();
    }

    const reopen = await request(app).post(`/packs/${body.pack.id}/open`).set('Authorization', token(ALICE));
    expect(reopen.body.alreadyOpened).toBe(true);
    expect(reopen.body.cards).toEqual(open.body.cards);
    expect((await request(app).get('/packs?unopened=true').set('Authorization', token(ALICE))).body.packs).toHaveLength(0);
    expect((await request(app).post(`/packs/${body.pack.id}/open`).set('Authorization', token(BOB))).status).toBe(404);

    const col = await request(app).get('/collection?subject=chemistry').set('Authorization', token(ALICE));
    const owned = col.body.cards.filter((c: { owned: boolean }) => c.owned);
    const chemInPack = open.body.cards.filter((c: { card: { subject: string } }) => c.card.subject === 'chemistry').length;
    expect(owned).toHaveLength(chemInPack);
    expect(col.body.sets.map((s: { set: string }) => s.set)).toEqual(['elements', 'compounds']);
    const locked = col.body.cards.find((c: { owned: boolean }) => !c.owned);
    expect(locked.funFact).toBeUndefined();
    // Cards not yet collected never carry an art address.
    expect(col.body.cards.filter((c: { owned: boolean; art?: unknown }) => !c.owned && c.art !== undefined)).toHaveLength(0);
    expect((await request(app).get('/collection?subject=alchemy').set('Authorization', token(ALICE))).status).toBe(400);

    // A second pack: any card Alice already had becomes shards, and the balance matches what the packs recorded.
    await session('s2', ALICE, 'atom-builder', 'submit', 100);
    const before = (await request(app).get('/collection').set('Authorization', token(ALICE))).body;
    await request(app).post('/sessions/s2/claim').set('Authorization', token(ALICE));
    const after = (await request(app).get('/collection').set('Authorization', token(ALICE))).body;
    const { rows } = await pg.query<{ s: number }>(`SELECT COALESCE(SUM(shards_awarded), 0)::int AS s FROM pack_cards`);
    expect(after.shards - before.shards).toBe(rows[0].s);
    expect(after.totals.owned).toBeGreaterThanOrEqual(before.totals.owned);
  });

  it('upgrades a card to foil with shards', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    const { body } = await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    const open = await request(app).post(`/packs/${body.pack.id}/open`).set('Authorization', token(ALICE));
    const card = open.body.cards[0].card;

    const poor = await request(app).post('/shards/upgrade').set('Authorization', token(ALICE)).send({ cardId: card.id });
    expect(poor.status).toBe(409);

    await pg.query(`UPDATE student_reward_state SET shards = 100 WHERE student_id = $1`, [ALICE]);
    const ok = await request(app).post('/shards/upgrade').set('Authorization', token(ALICE)).send({ cardId: card.id });
    expect(ok.status).toBe(200);
    expect(ok.body.foil).toBe(true);
    expect(ok.body.shards).toBe(100 - ok.body.cost);
    expect((await request(app).post('/shards/upgrade').set('Authorization', token(ALICE)).send({ cardId: card.id })).status).toBe(409);
    const notOwned = CARDS.find((c) => !open.body.cards.some((x: { card: { id: string } }) => x.card.id === c.id))!;
    expect((await request(app).post('/shards/upgrade').set('Authorization', token(ALICE)).send({ cardId: notOwned.id })).status).toBe(404);

    const detail = await request(app).get(`/cards/${card.id}`).set('Authorization', token(ALICE));
    expect(detail.body.card).toMatchObject({ id: card.id, owned: true, foil: true });
  });
});

describe('learning rings', () => {
  it('tracks the week and awards one bonus pack when all three rings close', async () => {
    const lessons = ['atom-builder', 'ionic-bonding', 'cell-explorer'];
    for (const [i, l] of lessons.entries()) {
      await session(`s${i}`, ALICE, l, 'submit', i * 100, 25);
      scores.set(`s${i}`, [95, 85, 40][i]);
      await request(app).post(`/sessions/s${i}/claim`).set('Authorization', token(ALICE));
    }
    const r = await request(app).get(`/rings/current?week=${WEEK}`).set('Authorization', token(ALICE));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ week: WEEK, allClosed: true, complete: { value: 3, closed: true }, master: { value: 2, closed: true } });
    expect(r.body.bonusPackId).toBeTruthy();

    const again = await request(app).get(`/rings/current?week=${WEEK}`).set('Authorization', token(ALICE));
    expect(again.body.bonusPackId).toBe(r.body.bonusPackId);
    const { rows } = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM pack_awards WHERE source = 'weekly'`);
    expect(rows[0].n).toBe(1);

    const packs = await request(app).get('/packs').set('Authorization', token(ALICE));
    expect(packs.body.packs.find((p: { source: string }) => p.source === 'weekly')).toMatchObject({ tier: 'weekly', week: WEEK });
  });

  it('lets students pick a goal level and checks week keys', async () => {
    expect((await request(app).put('/rings/goal-level').set('Authorization', token(ALICE)).send({ level: 'extreme' })).status).toBe(400);
    expect((await request(app).put('/rings/goal-level').set('Authorization', token(ALICE)).send({ level: 'light' })).status).toBe(200);
    const r = await request(app).get(`/rings/current?week=${WEEK}`).set('Authorization', token(ALICE));
    expect(r.body).toMatchObject({ level: 'light', complete: { goal: 2 }, explore: { goal: 30 } });
    expect((await request(app).get('/rings/current?week=2026-48').set('Authorization', token(ALICE))).status).toBe(400);
  });

  it('tells the leave-lab popup what finishing would earn', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    await session('s2', ALICE, 'ionic-bonding', 'submit', 50);
    await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    await session('live', ALICE, 'cell-explorer', null, 200);
    const p = await request(app).get('/sessions/live/progress').set('Authorization', token(ALICE));
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'in_progress', progressPercent: 50, reward: { pack: true, firstCompletionBonus: true }, ifFinished: { completeRingValue: 3, closesCompleteRing: true } });
    expect(p.body.message).toContain('50%');
    expect(p.body.message).toContain('Complete ring');
    expect((await request(app).get('/sessions/live/progress').set('Authorization', token(BOB))).status).toBe(404);
  });

  it('lists personal bests', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    scores.set('s1', 88);
    await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    const res = await request(app).get('/personal-bests').set('Authorization', token(ALICE));
    expect(res.body.personalBests).toEqual([expect.objectContaining({ lessonId: 'atom-builder', bestPercent: 88, masteryLevel: 4, completions: 1, fastestMs: 11 * 60_000 })]);
  });
});

describe('instructor routes', () => {
  it('shows class rings with stalled students and edits the goals', async () => {
    await session('s1', ALICE, 'atom-builder', 'submit');
    await session('b1', BOB, 'atom-builder', 'leave');
    expect((await request(app).get('/instructor/rings').set('Authorization', token(ALICE))).status).toBe(403);

    const res = await request(app).get(`/instructor/rings?week=${WEEK}`).set('Authorization', token(TEACHER, 'instructor'));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.students.map((s: { studentId: string }) => [s.studentId, s]));
    expect(byId[ALICE]).toMatchObject({ stalled: false, complete: { value: 1 } });
    expect(byId[BOB]).toMatchObject({ stalled: true, complete: { value: 0 } });
    expect(res.body.summary).toEqual({ students: 2, allClosed: 0, stalled: 1 });

    const bad = await request(app).put('/instructor/ring-goals').set('Authorization', token(TEACHER, 'instructor')).send({ exploreMinutes: 0, masterCount: 1, completeCount: 1, masteryPercent: 80 });
    expect(bad.status).toBe(400);
    const ok = await request(app).put('/instructor/ring-goals').set('Authorization', token(TEACHER, 'instructor')).send({ exploreMinutes: 10, masterCount: 1, completeCount: 1, masteryPercent: 70 });
    expect(ok.body.goals).toEqual({ exploreMinutes: 10, masterCount: 1, completeCount: 1, masteryPercent: 70 });
    const g = await request(app).get('/instructor/ring-goals').set('Authorization', token(TEACHER, 'instructor'));
    expect(g.body.goals.exploreMinutes).toBe(10);

    await request(app).post('/sessions/s1/claim').set('Authorization', token(ALICE));
    const col = await request(app).get(`/instructor/students/${ALICE}/collection`).set('Authorization', token(TEACHER, 'instructor'));
    expect(col.body.totals.owned).toBe(4);
  });
});
