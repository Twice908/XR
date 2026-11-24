import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

/**
 * user-auth — account service for students (WebXR / OpenXR clients) and
 * instructors (analysis dashboard).
 *
 *   POST   /users/register         create an account
 *   POST   /users/login            username + password -> JWT
 *   POST   /users/forgot-password  start a password reset (token is logged; never emailed in dev)
 *   POST   /users/reset-password   finish a password reset
 *   GET    /users/me               current account (Bearer token)
 *   GET    /students               enrolled students (instructor token)
 *   POST   /users/change-password  authenticated password change
 *   DELETE /users/me               delete own account (requires password)
 *
 * `id` is a random UUID and is the pseudonymous identifier that every other
 * service receives as `studentId`. The username never leaves this service
 * except in responses to its own owner.
 */

type Role = 'student' | 'instructor';

const app = express();
app.use(cors());
app.use(express.json());

const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
const TOKEN_TTL = process.env.TOKEN_TTL || '12h';
const INSTRUCTOR_INVITE_CODE = process.env.INSTRUCTOR_INVITE_CODE || 'mmaxr-instructor-dev';
const RESET_TTL_MS = 30 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

if (IS_PROD && JWT_SECRET === 'mmaxr-dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(40) NOT NULL,
      email VARCHAR(254),
      password_hash TEXT NOT NULL,
      role VARCHAR(16) NOT NULL CHECK (role IN ('student', 'instructor')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash CHAR(64) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    );
  `);
  console.log('✅ user-auth tables ensured.');
}
initDB().catch((err) => console.error('❌ user-auth DB init failed:', err));

// ---------- helpers ----------

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  password_hash: string;
  role: Role;
  created_at: Date;
}

const publicUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
  createdAt: u.created_at,
});

const signToken = (u: UserRow) =>
  jwt.sign({ sub: u.id, role: u.role, username: u.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  } as jwt.SignOptions);

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 128) return 'Password must be at most 128 characters';
  return null;
}

const isRole = (r: unknown): r is Role => r === 'student' || r === 'instructor';

// Small in-memory throttle: 8 failed attempts / 15 min per ip+username.
const failures = new Map<string, { count: number; resetAt: number }>();
function throttled(key: string): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (Date.now() > f.resetAt) {
    failures.delete(key);
    return false;
  }
  return f.count >= 8;
}
function recordFailure(key: string) {
  const f = failures.get(key);
  if (!f || Date.now() > f.resetAt) failures.set(key, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
  else f.count += 1;
}

interface AuthedRequest extends Request {
  auth?: { userId: string; role: Role };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const claims = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (!claims.sub || !isRole(claims.role)) throw new Error('bad claims');
    req.auth = { userId: String(claims.sub), role: claims.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const handler =
  (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthedRequest, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    });
  };

// ---------- routes ----------

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post(
  '/users/register',
  handler(async (req, res) => {
    const { username, password, email, role = 'student', inviteCode } = req.body ?? {};

    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-32 characters: letters, numbers, . _ -' });
    }
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    if (email !== undefined && email !== '' && (typeof email !== 'string' || !EMAIL_RE.test(email))) {
      return res.status(400).json({ error: 'Email is not valid' });
    }
    if (!isRole(role)) return res.status(400).json({ error: 'Role must be student or instructor' });
    if (role === 'instructor' && inviteCode !== INSTRUCTOR_INVITE_CODE) {
      return res.status(403).json({ error: 'A valid instructor invite code is required' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const { rows } = await pool.query<UserRow>(
        `INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *`,
        [username, email || null, hash, role],
      );
      const user = rows[0];
      console.log(`[user-auth] registered ${role} ${user.id}`);
      return res.status(201).json({ token: signToken(user), user: publicUser(user) });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return res.status(409).json({ error: 'That username is already taken' });
      }
      throw err;
    }
  }),
);

app.post(
  '/users/login',
  handler(async (req, res) => {
    const { username, password, role } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (throttled(key)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
    }

    const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE lower(username) = lower($1)`, [username]);
    const user = rows[0];
    // Always run a hash comparison so response time doesn't reveal whether the user exists.
    const ok = await bcrypt.compare(
      password,
      user?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali',
    );
    if (!user || !ok) {
      recordFailure(key);
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    if (isRole(role) && role !== user.role) {
      return res.status(403).json({
        error: user.role === 'instructor' ? 'This is an instructor account. Use the instructor dashboard.' : 'This is a student account.',
      });
    }

    failures.delete(key);
    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    return res.json({ token: signToken(user), user: publicUser(user) });
  }),
);

app.post(
  '/users/forgot-password',
  handler(async (req, res) => {
    const { username } = req.body ?? {};
    // Same response whether or not the account exists, so usernames can't be probed.
    const generic = { message: 'If that account exists, a reset link has been issued.' };
    if (typeof username !== 'string' || !username) return res.status(400).json({ error: 'Username is required' });

    const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE lower(username) = lower($1)`, [username]);
    const user = rows[0];
    if (!user) return res.status(202).json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [user.id]);
    await pool.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [
      sha256(token),
      user.id,
      new Date(Date.now() + RESET_TTL_MS),
    ]);

    // No mail transport exists yet. In development the token is logged and returned
    // so the flow can be exercised end to end; production only logs nothing sensitive.
    if (!IS_PROD) {
      console.log(`[user-auth] password reset token for ${user.username}: ${token}`);
      return res.status(202).json({ ...generic, devResetToken: token });
    }
    return res.status(202).json(generic);
  }),
);

app.post(
  '/users/reset-password',
  handler(async (req, res) => {
    const { token, newPassword } = req.body ?? {};
    if (typeof token !== 'string' || !token) return res.status(400).json({ error: 'Reset token is required' });
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return res.status(400).json({ error: pwProblem });

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const { rows } = await pool.query(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    );
    if (rows.length === 0) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, rows[0].user_id]);
    await pool.query(`DELETE FROM password_resets WHERE user_id = $1`, [rows[0].user_id]);
    return res.json({ message: 'Password updated. You can sign in now.' });
  }),
);

app.get(
  '/users/me',
  requireAuth,
  handler(async (req, res) => {
    const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.auth!.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'Account no longer exists' });
    return res.json({ user: publicUser(rows[0]) });
  }),
);

// Enrolled students, for the instructor dashboard. Username only: no email or other personal data.
app.get(
  '/students',
  requireAuth,
  handler(async (req, res) => {
    if (req.auth!.role !== 'instructor') return res.status(403).json({ error: 'Instructor access only' });
    const { rows } = await pool.query(
      `SELECT id, username, created_at, last_login_at FROM users WHERE role = 'student' ORDER BY lower(username)`,
    );
    return res.json({
      students: rows.map((r) => ({ id: r.id, username: r.username, createdAt: r.created_at, lastLoginAt: r.last_login_at })),
    });
  }),
);

app.post(
  '/users/change-password',
  requireAuth,
  handler(async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    const pwProblem = passwordProblem(newPassword);
    if (pwProblem) return res.status(400).json({ error: pwProblem });
    const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.auth!.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account no longer exists' });
    if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      user.id,
    ]);
    return res.json({ message: 'Password changed' });
  }),
);

app.delete(
  '/users/me',
  requireAuth,
  handler(async (req, res) => {
    const { password } = req.body ?? {};
    const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [req.auth!.userId]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Account no longer exists' });
    if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    console.log(`[user-auth] deleted account ${user.id}`);
    // xAPI events and sensor files keyed by the pseudonymous id are retained for assessment records;
    // with the account gone they can no longer be linked back to a person.
    return res.status(204).end();
  }),
);

const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`👤 User Auth Service running on http://localhost:${PORT}`);
});
