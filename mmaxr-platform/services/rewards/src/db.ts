import { Pool } from 'pg';
import { CARDS, CATALOG_VERSION } from './catalog';
import { DEFAULT_GOALS } from './rings';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The small slice of Postgres the service needs, so tests can swap in an in-process database. */
export interface Db extends Queryable {
  /** Run several statements with no parameters (schema setup). */
  exec(sql: string): Promise<void>;
  /** Run `fn` inside one transaction; it rolls back if `fn` throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export function pgDb(connectionString: string): Db {
  const pool = new Pool({ connectionString });
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    exec: async (sql) => {
      await pool.query(sql);
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) as never });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rewards_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS card_catalog (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL CHECK (subject IN ('chemistry', 'physics', 'mathematics', 'biology')),
    set_id TEXT NOT NULL,
    rarity TEXT NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    sort_order INT NOT NULL,
    data JSONB NOT NULL,
    fun_fact TEXT NOT NULL,
    question JSONB,
    lessons TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS card_catalog_set_idx ON card_catalog (subject, set_id);

  -- One pack per completed session (source_key 'session:<id>') or per closed ring week ('week:<student>:<week>').
  CREATE TABLE IF NOT EXISTS pack_awards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('session', 'weekly')),
    source_key TEXT NOT NULL UNIQUE,
    session_id TEXT UNIQUE,
    lesson_id TEXT,
    week_key TEXT,
    score_percent REAL,
    tier TEXT NOT NULL CHECK (tier IN ('standard', 'mastery', 'weekly')),
    first_completion BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS pack_awards_student_idx ON pack_awards (student_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS pack_cards (
    pack_id UUID NOT NULL REFERENCES pack_awards(id) ON DELETE CASCADE,
    slot INT NOT NULL,
    card_id TEXT NOT NULL REFERENCES card_catalog(id),
    is_new BOOLEAN NOT NULL,
    guaranteed TEXT CHECK (guaranteed IN ('mastery', 'pity')),
    shards_awarded INT NOT NULL DEFAULT 0,
    PRIMARY KEY (pack_id, slot)
  );

  CREATE TABLE IF NOT EXISTS student_cards (
    student_id TEXT NOT NULL,
    card_id TEXT NOT NULL REFERENCES card_catalog(id),
    count INT NOT NULL DEFAULT 1,
    foil BOOLEAN NOT NULL DEFAULT false,
    first_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_obtained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, card_id)
  );

  CREATE TABLE IF NOT EXISTS student_reward_state (
    student_id TEXT PRIMARY KEY,
    packs_since_epic INT NOT NULL DEFAULT 0,
    shards INT NOT NULL DEFAULT 0 CHECK (shards >= 0),
    ring_goal_level TEXT NOT NULL DEFAULT 'standard' CHECK (ring_goal_level IN ('light', 'standard', 'stretch')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Weekly ring goals. One 'default' row today; a class or section scope can be added later.
  CREATE TABLE IF NOT EXISTS ring_goals (
    scope TEXT PRIMARY KEY,
    explore_minutes INT NOT NULL CHECK (explore_minutes > 0),
    master_count INT NOT NULL CHECK (master_count > 0),
    complete_count INT NOT NULL CHECK (complete_count > 0),
    mastery_percent INT NOT NULL CHECK (mastery_percent BETWEEN 1 AND 100),
    updated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- A cache of each student's ring progress per week; always rebuilt from xapi_events and pack_awards.
  CREATE TABLE IF NOT EXISTS ring_weeks (
    student_id TEXT NOT NULL,
    week_key TEXT NOT NULL,
    explore_minutes INT NOT NULL DEFAULT 0,
    mastered INT NOT NULL DEFAULT 0,
    completed INT NOT NULL DEFAULT 0,
    goal_level TEXT NOT NULL DEFAULT 'standard',
    closed_at TIMESTAMPTZ,
    bonus_pack_id UUID REFERENCES pack_awards(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, week_key)
  );

  CREATE TABLE IF NOT EXISTS personal_bests (
    student_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    best_percent REAL,
    best_session_id TEXT,
    fastest_ms BIGINT,
    fastest_session_id TEXT,
    completions INT NOT NULL DEFAULT 0,
    mastery_level INT NOT NULL DEFAULT 1 CHECK (mastery_level BETWEEN 1 AND 5),
    last_completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (student_id, lesson_id)
  );
`;

/** Create the tables, the default ring goals, and load the card catalog when its version has changed. */
export async function initSchema(db: Db): Promise<void> {
  await db.exec(SCHEMA);
  await db.query(
    `INSERT INTO ring_goals (scope, explore_minutes, master_count, complete_count, mastery_percent)
     VALUES ('default', $1, $2, $3, $4) ON CONFLICT (scope) DO NOTHING`,
    [DEFAULT_GOALS.exploreMinutes, DEFAULT_GOALS.masterCount, DEFAULT_GOALS.completeCount, DEFAULT_GOALS.masteryPercent],
  );
  const { rows } = await db.query<{ value: string }>(`SELECT value FROM rewards_meta WHERE key = 'catalog_version'`);
  if (rows[0]?.value === CATALOG_VERSION) return;

  const payload = CARDS.map((c) => ({
    id: c.id, subject: c.subject, set_id: c.set, rarity: c.rarity, title: c.title, subtitle: c.subtitle, sort_order: c.order,
    data: c.data, fun_fact: c.funFact, question: c.question, lessons: c.lessons,
  }));
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO card_catalog (id, subject, set_id, rarity, title, subtitle, sort_order, data, fun_fact, question, lessons)
       SELECT x.id, x.subject, x.set_id, x.rarity, x.title, x.subtitle, x.sort_order, x.data, x.fun_fact, x.question,
              ARRAY(SELECT jsonb_array_elements_text(x.lessons))
         FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT, subject TEXT, set_id TEXT, rarity TEXT, title TEXT, subtitle TEXT,
              sort_order INT, data JSONB, fun_fact TEXT, question JSONB, lessons JSONB)
       ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, set_id = EXCLUDED.set_id, rarity = EXCLUDED.rarity,
              title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, sort_order = EXCLUDED.sort_order, data = EXCLUDED.data,
              fun_fact = EXCLUDED.fun_fact, question = EXCLUDED.question, lessons = EXCLUDED.lessons, updated_at = now()`,
      [JSON.stringify(payload)],
    );
    await q.query(
      `INSERT INTO rewards_meta (key, value) VALUES ('catalog_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CATALOG_VERSION],
    );
  });
  console.log(`✅ rewards catalog loaded (${CARDS.length} cards, ${CATALOG_VERSION}).`);
}
