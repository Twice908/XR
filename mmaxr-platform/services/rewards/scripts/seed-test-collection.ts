/**
 * Local testing helper: make (or reuse) a student account and give it every card in the catalog, so the whole
 * collection book and every card's art can be checked without opening hundreds of packs.
 *
 *   pnpm --filter ./mmaxr-platform/services/rewards seed:test-collection [username]
 *
 * Needs user-auth (USER_AUTH_URL, default http://localhost:3008) and the rewards database (DATABASE_URL) running.
 * The username and password are written to .env.test-account next to this package (git-ignored), never printed.
 * Never point this at production.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const USER_AUTH_URL = process.env.USER_AUTH_URL || 'http://localhost:3008';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr';
const SHARDS = 500;

if (/supabase|amazonaws|render\.com|neon\.tech/.test(DATABASE_URL) && process.env.ALLOW_REMOTE !== '1') {
  console.error('DATABASE_URL looks like a hosted database. This script is for local testing; set ALLOW_REMOTE=1 to override.');
  process.exit(1);
}

const credFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.test-account');
const saved = existsSync(credFile)
  ? Object.fromEntries(readFileSync(credFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('=') as [string, string]))
  : {};
const username = process.argv[2] || saved.TEST_USERNAME || 'cardtester';
const password = saved.TEST_USERNAME === username && saved.TEST_PASSWORD ? saved.TEST_PASSWORD : `Test-${randomBytes(9).toString('base64url')}1a`;

async function post(path: string, body: unknown) {
  const res = await fetch(`${USER_AUTH_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { user?: { id: string | number }; error?: string } };
}

async function main() {
  let res = await post('/users/register', { username, password, role: 'student' });
  if (res.status === 409) res = await post('/users/login', { username, password, role: 'student' });
  if (!res.body.user) throw new Error(`Could not register or sign in "${username}": ${res.body.error ?? res.status}`);
  const studentId = String(res.body.user.id);
  writeFileSync(credFile, `TEST_USERNAME=${username}\nTEST_PASSWORD=${password}\n`, { mode: 0o600 });

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO student_cards (student_id, card_id, count, foil)
       SELECT $1, id, 1, false FROM card_catalog
       ON CONFLICT (student_id, card_id) DO NOTHING`,
      [studentId],
    );
    await pool.query(
      `INSERT INTO student_reward_state (student_id, shards) VALUES ($1, $2)
       ON CONFLICT (student_id) DO UPDATE SET shards = GREATEST(student_reward_state.shards, EXCLUDED.shards), updated_at = now()`,
      [studentId, SHARDS],
    );
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM student_cards WHERE student_id = $1`, [studentId]);
    const { rows: all } = await pool.query(`SELECT count(*)::int AS n FROM card_catalog`);
    console.log(`Student ${studentId} ("${username}") now owns ${rows[0].n} of ${all[0].n} cards (${rowCount} added), ${SHARDS}+ shards.`);
    console.log(`Sign-in details: ${credFile}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
