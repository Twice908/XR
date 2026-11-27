import { CARD_BY_ID, CARDS, SETS, type Card, type Rarity } from './catalog';
import { artFor } from './catalog/art';
import type { Db, Queryable } from './db';
import { FOIL_COST, masteryLevel, rollPack, SHARDS_FOR_DUPLICATE, secureRng, type Rng } from './roll';
import { computeRings, labProgressPercent, previousWeek, weekKey, weekRange, type GoalLevel, type RingGoals, type RingProgress, type WeekEvent } from './rings';

/** Calls to other MMAXR services. Injected so tests can run without them. */
export interface Sources {
  /** The rubric score of a session, from the rubric engine. Null when it cannot be scored. */
  score(sessionId: string): Promise<number | null>;
  /** The lesson service's internal view of a session (for lab progress). Null if it has none. */
  assignment(sessionId: string): Promise<Record<string, any> | null>;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface SessionFacts {
  sessionId: string;
  studentId: string;
  lessonId: string | null;
  status: 'completed' | 'left' | 'in_progress';
  startedAt: number;
  submittedAt: number | null;
}

/** What the xAPI log says about a session. The same completed / left rule the instructor dashboard uses. */
export async function sessionFacts(db: Queryable, sessionId: string): Promise<SessionFacts | null> {
  const { rows } = await db.query(
    `SELECT MAX(student_id) AS student_id,
            COUNT(DISTINCT student_id) AS owners,
            MIN(timestamp) AS started_at,
            MIN(CASE WHEN object_data->>'action' = 'submit_analysis' THEN timestamp END) AS submitted_at,
            BOOL_OR(object_data->>'action' = 'leave_lab') AS left_lab,
            MAX(CASE WHEN object_data->>'action' = 'enter_lab' THEN object_data->>'target' END) AS lesson_id
       FROM xapi_events WHERE session_id = $1`,
    [sessionId],
  );
  const r = rows[0];
  if (!r || r.student_id === null || Number(r.owners) !== 1) return null;
  const submittedAt = r.submitted_at === null ? null : Number(r.submitted_at);
  return {
    sessionId,
    studentId: String(r.student_id),
    lessonId: r.lesson_id ?? null,
    status: submittedAt !== null ? 'completed' : r.left_lab ? 'left' : 'in_progress',
    startedAt: Number(r.started_at),
    submittedAt,
  };
}

/** A session the caller owns, or a 404 (never revealing that someone else's session exists). */
async function ownSession(db: Queryable, studentId: string, sessionId: string): Promise<SessionFacts> {
  const facts = await sessionFacts(db, sessionId);
  if (!facts || facts.studentId !== studentId) throw new HttpError(404, 'Session not found');
  return facts;
}

// ---------- shapes sent to clients ----------

export function cardView(card: Card) {
  return {
    id: card.id,
    subject: card.subject,
    set: card.set,
    rarity: card.rarity,
    title: card.title,
    subtitle: card.subtitle,
    order: card.order,
    data: card.data,
    funFact: card.funFact,
    question: card.question,
    // Only cards a student has revealed or owns are shown through cardView, so only they get an art address.
    art: artFor(card.id),
  };
}

/** A card the student has not collected yet: enough to draw its empty slot, nothing to learn from. */
const lockedView = (card: Card) => ({ id: card.id, subject: card.subject, set: card.set, rarity: card.rarity, title: card.title, subtitle: card.subtitle, order: card.order });

interface PackRow {
  id: string;
  source: 'session' | 'weekly';
  session_id: string | null;
  lesson_id: string | null;
  week_key: string | null;
  score_percent: number | null;
  tier: string;
  first_completion: boolean;
  created_at: Date;
  opened_at: Date | null;
}

const packView = (p: PackRow, cardCount: number) => ({
  id: p.id,
  source: p.source,
  sessionId: p.session_id,
  lessonId: p.lesson_id,
  week: p.week_key,
  scorePercent: p.score_percent === null ? null : Number(p.score_percent),
  tier: p.tier,
  firstCompletion: p.first_completion,
  cardCount,
  createdAt: p.created_at,
  openedAt: p.opened_at,
});

// ---------- the service ----------

export class Rewards {
  constructor(private db: Db, private sources: Sources, private rng: Rng = secureRng, private now: () => number = Date.now) {}

  private async lockState(q: Queryable, studentId: string) {
    await q.query(`INSERT INTO student_reward_state (student_id) VALUES ($1) ON CONFLICT (student_id) DO NOTHING`, [studentId]);
    const { rows } = await q.query<{ packs_since_epic: number; shards: number; ring_goal_level: GoalLevel }>(
      `SELECT packs_since_epic, shards, ring_goal_level FROM student_reward_state WHERE student_id = $1 FOR UPDATE`,
      [studentId],
    );
    return rows[0];
  }

  private async packBySource(q: Queryable, sourceKey: string): Promise<PackRow | null> {
    const { rows } = await q.query<PackRow>(`SELECT * FROM pack_awards WHERE source_key = $1`, [sourceKey]);
    return rows[0] ?? null;
  }

  private async cardCount(q: Queryable, packId: string): Promise<number> {
    const { rows } = await q.query(`SELECT COUNT(*) AS n FROM pack_cards WHERE pack_id = $1`, [packId]);
    return Number(rows[0].n);
  }

  /**
   * Roll a pack inside an open transaction that already holds the student's state lock, store it, add the cards to
   * the collection, and turn duplicates into shards.
   */
  private async awardPack(
    q: Queryable,
    studentId: string,
    state: { packs_since_epic: number },
    pack: { source: 'session' | 'weekly'; sourceKey: string; sessionId: string | null; lessonId: string | null; weekKey: string | null; score: number | null; firstCompletion: boolean },
  ): Promise<PackRow> {
    const roll = rollPack({ lessonId: pack.lessonId, scorePercent: pack.score, firstCompletion: pack.firstCompletion, packsSinceEpic: state.packs_since_epic }, this.rng);
    const tier = pack.source === 'weekly' ? 'weekly' : roll.tier;
    const { rows } = await q.query<PackRow>(
      `INSERT INTO pack_awards (student_id, source, source_key, session_id, lesson_id, week_key, score_percent, tier, first_completion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [studentId, pack.source, pack.sourceKey, pack.sessionId, pack.lessonId, pack.weekKey, pack.score, tier, pack.firstCompletion],
    );
    const row = rows[0];

    const ids = roll.cards.map((c) => c.card.id);
    const owned = await q.query<{ card_id: string }>(`SELECT card_id FROM student_cards WHERE student_id = $1 AND card_id = ANY($2::text[])`, [studentId, ids]);
    const ownedSet = new Set(owned.rows.map((r) => r.card_id));
    let shards = 0;
    for (const { slot, card, guaranteed } of roll.cards) {
      const isNew = !ownedSet.has(card.id);
      const gained = isNew ? 0 : SHARDS_FOR_DUPLICATE[card.rarity];
      shards += gained;
      await q.query(`INSERT INTO pack_cards (pack_id, slot, card_id, is_new, guaranteed, shards_awarded) VALUES ($1, $2, $3, $4, $5, $6)`, [row.id, slot, card.id, isNew, guaranteed, gained]);
      await q.query(
        `INSERT INTO student_cards (student_id, card_id) VALUES ($1, $2)
         ON CONFLICT (student_id, card_id) DO UPDATE SET count = student_cards.count + 1, last_obtained_at = now()`,
        [studentId, card.id],
      );
    }
    await q.query(`UPDATE student_reward_state SET packs_since_epic = $2, shards = shards + $3, updated_at = now() WHERE student_id = $1`, [studentId, roll.packsSinceEpic, shards]);
    return row;
  }

  /** Award the pack for a completed session. Safe to call again: the same pack comes back. */
  async claim(studentId: string, sessionId: string) {
    const facts = await ownSession(this.db, studentId, sessionId);
    const sourceKey = `session:${sessionId}`;
    const existing = await this.packBySource(this.db, sourceKey);
    if (existing) return { created: false, pack: packView(existing, await this.cardCount(this.db, existing.id)), personalBest: null };
    if (facts.status !== 'completed') {
      throw new HttpError(409, facts.status === 'left' ? 'This session was left early, so it earns no pack' : 'Finish the lab to earn a pack', { status: facts.status });
    }

    const score = await this.sources.score(sessionId).catch(() => null);
    const durationMs = facts.submittedAt !== null ? Math.max(0, facts.submittedAt - facts.startedAt) : null;

    return this.db.tx(async (q) => {
      const state = await this.lockState(q, studentId);
      // A second claim may have won the race while we were scoring.
      const raced = await this.packBySource(q, sourceKey);
      if (raced) return { created: false, pack: packView(raced, await this.cardCount(q, raced.id)), personalBest: null };

      const first = facts.lessonId
        ? (await q.query(`SELECT 1 FROM pack_awards WHERE student_id = $1 AND lesson_id = $2 AND source = 'session' LIMIT 1`, [studentId, facts.lessonId])).rows.length === 0
        : false;
      const pack = await this.awardPack(q, studentId, state, { source: 'session', sourceKey, sessionId, lessonId: facts.lessonId, weekKey: null, score, firstCompletion: first });
      const personalBest = facts.lessonId ? await this.recordBest(q, studentId, facts.lessonId, sessionId, score, durationMs) : null;
      return { created: true, pack: packView(pack, await this.cardCount(q, pack.id)), personalBest };
    });
  }

  private async recordBest(q: Queryable, studentId: string, lessonId: string, sessionId: string, score: number | null, durationMs: number | null) {
    const { rows } = await q.query(`SELECT * FROM personal_bests WHERE student_id = $1 AND lesson_id = $2 FOR UPDATE`, [studentId, lessonId]);
    const prev = rows[0] as { best_percent: number | null; fastest_ms: string | number | null; completions: number; mastery_level: number } | undefined;
    const prevBest = prev?.best_percent === null || prev?.best_percent === undefined ? null : Number(prev.best_percent);
    const prevFast = prev?.fastest_ms === null || prev?.fastest_ms === undefined ? null : Number(prev.fastest_ms);
    const newScore = score !== null && (prevBest === null || score > prevBest);
    const newTime = durationMs !== null && (prevFast === null || durationMs < prevFast);
    const best = newScore ? score : prevBest;
    const fastest = newTime ? durationMs : prevFast;
    const level = masteryLevel(best);
    await q.query(
      `INSERT INTO personal_bests (student_id, lesson_id, best_percent, best_session_id, fastest_ms, fastest_session_id, completions, mastery_level, last_completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 1, $7, now())
       ON CONFLICT (student_id, lesson_id) DO UPDATE SET
         best_percent = $3,
         best_session_id = CASE WHEN $8 THEN $4 ELSE personal_bests.best_session_id END,
         fastest_ms = $5,
         fastest_session_id = CASE WHEN $9 THEN $6 ELSE personal_bests.fastest_session_id END,
         completions = personal_bests.completions + 1,
         mastery_level = $7,
         last_completed_at = now()`,
      [studentId, lessonId, best, newScore ? sessionId : null, fastest, newTime ? sessionId : null, level, newScore, newTime],
    );
    return {
      lessonId,
      // A first run is not flagged as a record: there was nothing to beat.
      newBestScore: newScore && prev !== undefined,
      newFastestTime: newTime && prev !== undefined,
      bestPercent: best,
      previousBestPercent: prevBest,
      fastestMs: fastest,
      previousFastestMs: prevFast,
      masteryLevel: level,
      levelUp: prev !== undefined && level > prev.mastery_level,
      completions: (prev?.completions ?? 0) + 1,
    };
  }

  async listPacks(studentId: string, unopenedOnly: boolean) {
    const { rows } = await this.db.query<PackRow & { n: string }>(
      `SELECT p.*, (SELECT COUNT(*) FROM pack_cards c WHERE c.pack_id = p.id) AS n
         FROM pack_awards p WHERE p.student_id = $1 ${unopenedOnly ? 'AND p.opened_at IS NULL' : ''}
        ORDER BY p.created_at DESC LIMIT 100`,
      [studentId],
    );
    return { packs: rows.map((r) => packView(r, Number(r.n))) };
  }

  /** Reveal a pack's cards in slot order. Opening again shows the same cards. */
  async openPack(studentId: string, packId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(packId)) throw new HttpError(404, 'Pack not found');
    const { rows } = await this.db.query<PackRow & { student_id: string; was_opened: boolean }>(
      `UPDATE pack_awards SET opened_at = COALESCE(opened_at, now())
        WHERE id = $1 AND student_id = $2
        RETURNING *, (opened_at IS DISTINCT FROM now()) AS was_opened`,
      [packId, studentId],
    );
    const pack = rows[0];
    if (!pack) throw new HttpError(404, 'Pack not found');
    const cards = await this.db.query<{ slot: number; card_id: string; is_new: boolean; guaranteed: string | null; shards_awarded: number }>(
      `SELECT slot, card_id, is_new, guaranteed, shards_awarded FROM pack_cards WHERE pack_id = $1 ORDER BY slot`,
      [packId],
    );
    return {
      pack: packView(pack, cards.rows.length),
      alreadyOpened: pack.was_opened,
      cards: cards.rows.map((c) => ({
        slot: c.slot,
        isNew: c.is_new,
        guaranteed: c.guaranteed,
        shardsAwarded: c.shards_awarded,
        card: cardView(CARD_BY_ID.get(c.card_id)!),
      })),
    };
  }

  async collection(studentId: string, filter: { subject?: string; set?: string }) {
    const { rows } = await this.db.query<{ card_id: string; count: number; foil: boolean; first_obtained_at: Date }>(
      `SELECT card_id, count, foil, first_obtained_at FROM student_cards WHERE student_id = $1`,
      [studentId],
    );
    const owned = new Map(rows.map((r) => [r.card_id, r]));
    const state = (await this.db.query(`SELECT shards FROM student_reward_state WHERE student_id = $1`, [studentId])).rows[0];
    const inFilter = (c: Card) => (!filter.subject || c.subject === filter.subject) && (!filter.set || c.set === filter.set);
    const sets = SETS.filter((s) => (!filter.subject || s.subject === filter.subject) && (!filter.set || s.set === filter.set)).map((s) => {
      const all = CARDS.filter((c) => c.subject === s.subject && c.set === s.set);
      const have = all.filter((c) => owned.has(c.id)).length;
      return { ...s, owned: have, total: all.length, complete: have === all.length };
    });
    const cards = CARDS.filter(inFilter).map((c) => {
      const o = owned.get(c.id);
      return o ? { ...cardView(c), owned: true, count: Number(o.count), foil: o.foil, firstObtainedAt: o.first_obtained_at } : { ...lockedView(c), owned: false };
    });
    return {
      shards: Number(state?.shards ?? 0),
      totals: { owned: rows.length, total: CARDS.length },
      sets,
      cards,
    };
  }

  async card(studentId: string, cardId: string) {
    const card = CARD_BY_ID.get(cardId);
    if (!card) throw new HttpError(404, 'Card not found');
    const { rows } = await this.db.query(`SELECT count, foil, first_obtained_at FROM student_cards WHERE student_id = $1 AND card_id = $2`, [studentId, cardId]);
    const o = rows[0];
    return o ? { card: { ...cardView(card), owned: true, count: Number(o.count), foil: o.foil, firstObtainedAt: o.first_obtained_at } } : { card: { ...lockedView(card), owned: false } };
  }

  async upgradeFoil(studentId: string, cardId: string) {
    const card = CARD_BY_ID.get(cardId);
    if (!card) throw new HttpError(404, 'Card not found');
    const cost = FOIL_COST[card.rarity as Rarity];
    return this.db.tx(async (q) => {
      const state = await this.lockState(q, studentId);
      const { rows } = await q.query(`SELECT foil FROM student_cards WHERE student_id = $1 AND card_id = $2 FOR UPDATE`, [studentId, cardId]);
      if (!rows[0]) throw new HttpError(404, 'You do not own this card yet');
      if (rows[0].foil) throw new HttpError(409, 'This card is already foil');
      if (state.shards < cost) throw new HttpError(409, `Not enough shards: ${cost} needed, ${state.shards} held`, { cost, shards: state.shards });
      await q.query(`UPDATE student_cards SET foil = true WHERE student_id = $1 AND card_id = $2`, [studentId, cardId]);
      await q.query(`UPDATE student_reward_state SET shards = shards - $2, updated_at = now() WHERE student_id = $1`, [studentId, cost]);
      return { cardId, foil: true, cost, shards: state.shards - cost };
    });
  }

  // ---------- rings ----------

  async goals(): Promise<RingGoals> {
    const { rows } = await this.db.query(`SELECT * FROM ring_goals WHERE scope = 'default'`);
    const r = rows[0];
    return { exploreMinutes: r.explore_minutes, masterCount: r.master_count, completeCount: r.complete_count, masteryPercent: r.mastery_percent };
  }

  async setGoals(instructorId: string, g: RingGoals) {
    await this.db.query(
      `UPDATE ring_goals SET explore_minutes = $1, master_count = $2, complete_count = $3, mastery_percent = $4, updated_by = $5, updated_at = now() WHERE scope = 'default'`,
      [g.exploreMinutes, g.masterCount, g.completeCount, g.masteryPercent, instructorId],
    );
    return { goals: await this.goals() };
  }

  async setGoalLevel(studentId: string, level: GoalLevel) {
    await this.db.query(
      `INSERT INTO student_reward_state (student_id, ring_goal_level) VALUES ($1, $2)
       ON CONFLICT (student_id) DO UPDATE SET ring_goal_level = $2, updated_at = now()`,
      [studentId, level],
    );
    return { level };
  }

  /** Events and pack scores for some students over a time range, grouped per student. */
  private async activity(studentIds: string[] | null, start: number, end: number) {
    const ev = await this.db.query(
      `SELECT student_id, session_id, timestamp, object_data->>'action' AS action, object_data->>'target' AS target
         FROM xapi_events WHERE timestamp >= $1 AND timestamp < $2 ${studentIds ? 'AND student_id = ANY($3::text[])' : ''}`,
      studentIds ? [start, end, studentIds] : [start, end],
    );
    const sc = await this.db.query(
      `SELECT session_id, score_percent FROM pack_awards WHERE source = 'session' AND session_id IN
         (SELECT DISTINCT session_id FROM xapi_events WHERE timestamp >= $1 AND timestamp < $2 ${studentIds ? 'AND student_id = ANY($3::text[])' : ''})`,
      studentIds ? [start, end, studentIds] : [start, end],
    );
    const events = new Map<string, WeekEvent[]>();
    for (const r of ev.rows) {
      const list = events.get(r.student_id) ?? [];
      list.push({ sessionId: r.session_id, timestamp: Number(r.timestamp), action: r.action, target: r.target });
      events.set(r.student_id, list);
    }
    const scores = new Map<string, number | null>(sc.rows.map((r) => [r.session_id, r.score_percent === null ? null : Number(r.score_percent)]));
    return { events, scores };
  }

  /** A student's rings for a week. Closing all three for the first time awards one bonus pack. */
  async rings(studentId: string, week = weekKey(this.now())) {
    const { start, end } = weekRange(week);
    const [goals, act, stateRow] = await Promise.all([
      this.goals(),
      this.activity([studentId], start, end),
      this.db.query(`SELECT ring_goal_level FROM student_reward_state WHERE student_id = $1`, [studentId]),
    ]);
    const level: GoalLevel = stateRow.rows[0]?.ring_goal_level ?? 'standard';
    const progress = computeRings(week, act.events.get(studentId) ?? [], act.scores, goals, level);

    const bonusPackId = await this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO ring_weeks (student_id, week_key, explore_minutes, mastered, completed, goal_level)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (student_id, week_key) DO UPDATE SET explore_minutes = $3, mastered = $4, completed = $5, goal_level = $6, updated_at = now()`,
        [studentId, week, progress.explore.value, progress.master.value, progress.complete.value, level],
      );
      const { rows } = await q.query(`SELECT bonus_pack_id FROM ring_weeks WHERE student_id = $1 AND week_key = $2 FOR UPDATE`, [studentId, week]);
      if (rows[0].bonus_pack_id || !progress.allClosed) return rows[0].bonus_pack_id as string | null;
      const state = await this.lockState(q, studentId);
      const sourceKey = `week:${studentId}:${week}`;
      const pack = (await this.packBySource(q, sourceKey)) ?? (await this.awardPack(q, studentId, state, { source: 'weekly', sourceKey, sessionId: null, lessonId: null, weekKey: week, score: null, firstCompletion: false }));
      await q.query(`UPDATE ring_weeks SET closed_at = COALESCE(closed_at, now()), bonus_pack_id = $3 WHERE student_id = $1 AND week_key = $2`, [studentId, week, pack.id]);
      return pack.id;
    });
    return { ...progress, bonusPackId };
  }

  /** For the leave-lab popup: how close the lab is to done and what finishing it would earn. */
  async sessionProgress(studentId: string, sessionId: string) {
    const facts = await ownSession(this.db, studentId, sessionId);
    const [assignment, rings] = await Promise.all([this.sources.assignment(sessionId).catch(() => null), this.rings(studentId)]);
    const percent = facts.status === 'completed' ? 100 : labProgressPercent(assignment);
    const lessonDoneThisWeek = facts.lessonId !== null && rings.completedLessons.includes(facts.lessonId);
    const first = facts.lessonId
      ? (await this.db.query(`SELECT 1 FROM pack_awards WHERE student_id = $1 AND lesson_id = $2 AND source = 'session' LIMIT 1`, [studentId, facts.lessonId])).rows.length === 0
      : false;
    const completeAfter = rings.complete.value + (facts.status !== 'completed' && !lessonDoneThisWeek ? 1 : 0);
    const closesCompleteRing = !rings.complete.closed && completeAfter >= rings.complete.goal;
    const parts = [percent !== null ? `You're ${percent}% through this lab.` : `You're partway through this lab.`];
    parts.push(closesCompleteRing ? 'Finish it to close your Complete ring and open a card pack.' : 'Finish it to open a card pack.');
    if (first) parts.push('First finish of this lab adds a bonus card.');
    return {
      sessionId,
      lessonId: facts.lessonId,
      status: facts.status,
      progressPercent: percent,
      reward: { pack: facts.status !== 'left', firstCompletionBonus: first },
      rings: { explore: rings.explore, master: rings.master, complete: rings.complete, allClosed: rings.allClosed },
      ifFinished: { completeRingValue: completeAfter, closesCompleteRing },
      message: parts.join(' '),
    };
  }

  async personalBests(studentId: string) {
    const { rows } = await this.db.query(`SELECT * FROM personal_bests WHERE student_id = $1 ORDER BY last_completed_at DESC`, [studentId]);
    return {
      personalBests: rows.map((r) => ({
        lessonId: r.lesson_id,
        bestPercent: r.best_percent === null ? null : Number(r.best_percent),
        fastestMs: r.fastest_ms === null ? null : Number(r.fastest_ms),
        completions: r.completions,
        masteryLevel: r.mastery_level,
        lastCompletedAt: r.last_completed_at,
      })),
    };
  }

  // ---------- instructor ----------

  /** Ring progress for every student with any lab activity. Stalled: nothing completed this week or last week. */
  async classRings(week = weekKey(this.now())) {
    const prev = previousWeek(week);
    const { start, end } = weekRange(week);
    const prevRange = weekRange(prev);
    const [goals, students, act, prevAct, levels] = await Promise.all([
      this.goals(),
      this.db.query<{ student_id: string }>(`SELECT DISTINCT student_id FROM xapi_events WHERE student_id IS NOT NULL AND student_id <> 'unknown' AND timestamp < $1`, [end]),
      this.activity(null, start, end),
      this.activity(null, prevRange.start, prevRange.end),
      this.db.query(`SELECT student_id, ring_goal_level FROM student_reward_state`),
    ]);
    const levelOf = new Map<string, GoalLevel>(levels.rows.map((r) => [r.student_id, r.ring_goal_level]));
    const rows = students.rows.map(({ student_id: id }) => {
      const level = levelOf.get(id) ?? 'standard';
      const now = computeRings(week, act.events.get(id) ?? [], act.scores, goals, level);
      const before = computeRings(prev, prevAct.events.get(id) ?? [], prevAct.scores, goals, level);
      return {
        studentId: id,
        level,
        explore: now.explore,
        master: now.master,
        complete: now.complete,
        allClosed: now.allClosed,
        stalled: now.complete.value === 0 && before.complete.value === 0,
      };
    });
    return {
      week,
      goals,
      summary: { students: rows.length, allClosed: rows.filter((r) => r.allClosed).length, stalled: rows.filter((r) => r.stalled).length },
      students: rows,
    };
  }
}

export type RingsResponse = RingProgress & { bonusPackId: string | null };
