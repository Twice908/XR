import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { motionInternal, registerMotion } from '../motionRoutes';
import { redactMotion, type MotionAssignment } from '../motion';

const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-motion.json'), 'utf8'));
let server: Server;
let base = '';
let store: MotionAssignment | null = null;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerMotion(app, {
    wrap: (fn) => (req, res) => void fn(req, res).catch((e) => res.status(500).json({ error: String(e) })),
    sessionFor: async (req) => (req.headers.authorization === 'Bearer good' ? { studentId: 'stu' } : null),
    readLesson: () => lesson,
    load: async () => store,
    save: async (_id, a) => void (store = a),
  });
  await new Promise<void>((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sessions/s1/motion`;
});
afterAll(() => server.close());

const post = async (route: string, body: unknown, token = 'good') => {
  const r = await fetch(`${base}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const fresh = () => (store = { kind: 'motion', lessonId: 'physics-motion', studentId: 'stu', predictions: {}, createdAt: 0 });

describe('motion routes', () => {
  it('rejects a session that is not the student’s, and an unknown trial', async () => {
    fresh();
    expect((await post('predict', { trial: 'kin_1' }, 'bad')).status).toBe(401);
    expect((await post('predict', { trial: 'nope', value: {}, confidence: 2 })).status).toBe(400);
  });

  it('keeps the answer back until the prediction is locked and the result watched', async () => {
    fresh();
    expect((await post('observe', { trial: 'kin_1' })).status).toBe(409); // nothing locked yet
    const locked = await post('predict', { trial: 'kin_1', value: { distance: 50, displacement: 50 }, confidence: 3, thinkMs: 4000 });
    expect(locked.status).toBe(201);
    expect(JSON.stringify(locked.body)).not.toMatch(/answer|outcome|explanation/);
    const seen = await post('observe', { trial: 'kin_1' });
    expect(seen.body.match).toBe(true);
    expect(seen.body.outcome).toContain('50 m');
    expect(seen.body.explanation).toContain('same size');
  });

  it('a prediction can be locked once and never changed', async () => {
    fresh();
    await post('predict', { trial: 'kin_1', value: { distance: 10, displacement: 10 }, confidence: 1 });
    const again = await post('predict', { trial: 'kin_1', value: { distance: 50, displacement: 50 }, confidence: 3 });
    expect(again.status).toBe(409);
    expect((await post('observe', { trial: 'kin_1' })).body.match).toBe(false);
  });

  it('follows the order inside a module, but modules are independent', async () => {
    fresh();
    expect((await post('predict', { trial: 'kin_2', value: { distance: 100, displacement: 0 }, confidence: 2 })).status).toBe(409);
    expect((await post('predict', { trial: 'dyn_1', value: { choice: 'stays' }, confidence: 2 })).status).toBe(201);
  });

  it('validates the prediction and the confidence', async () => {
    fresh();
    expect((await post('predict', { trial: 'kin_1', value: { distance: 'a', displacement: 1 }, confidence: 2 })).status).toBe(400);
    expect((await post('predict', { trial: 'kin_1', value: { distance: 1, displacement: 1 }, confidence: 9 })).status).toBe(400);
  });

  it('holds an anomaly explanation back until the student explains, then scores it once', async () => {
    fresh();
    await post('predict', { trial: 'dyn_1', value: { choice: 'slides' }, confidence: 3 });
    expect((await post('explain', { trial: 'dyn_1', explanation: 'too early to say anything here' })).status).toBe(409); // not watched yet
    const seen = await post('observe', { trial: 'dyn_1' });
    expect(seen.body.match).toBe(false);
    expect(seen.body.explanation).toBeNull();
    expect((await post('explain', { trial: 'dyn_1', explanation: 'short' })).status).toBe(400);
    const done = await post('explain', { trial: 'dyn_1', explanation: 'Friction from the floor balances the small force so the net force is zero and the heavy crate does not move.' });
    expect(done.status).toBe(200);
    expect(done.body.coverage).toBeGreaterThanOrEqual(0.75);
    expect(done.body.explanation).toContain('Friction');
    expect((await post('explain', { trial: 'dyn_1', explanation: 'trying again with a different explanation text' })).status).toBe(409);
  });

  it('keeps how an explanation was given, and takes its audio only after it', async () => {
    fresh();
    await post('predict', { trial: 'dyn_1', value: { choice: 'stays' }, confidence: 2 });
    await post('observe', { trial: 'dyn_1' });
    expect((await post('audio', { trial: 'dyn_1', contentType: 'audio/webm', fileBase64: 'AAAA' })).status).toBe(409);
    await post('explain', { trial: 'dyn_1', explanation: 'Friction balances the push so the net force is zero and nothing moves at all.', inputMode: 'voice', speakMs: 9000 });
    expect((await post('audio', { trial: 'dyn_1', contentType: 'text/plain', fileBase64: 'AAAA' })).status).toBe(400);
    const t = motionInternal(store!, lesson) as any;
    expect(t.motion.trials[0]).toMatchObject({ inputMode: 'voice', speakMs: 9000 });
  });

  it('a question without an explanation step refuses one', async () => {
    fresh();
    await post('predict', { trial: 'kin_1', value: { distance: 50, displacement: 50 }, confidence: 2 });
    await post('observe', { trial: 'kin_1' });
    expect((await post('explain', { trial: 'kin_1', explanation: 'this one needs no explanation at all really' })).status).toBe(400);
  });

  it('truth for the coach and the rubric: secrets stay open until watched, results only after', async () => {
    fresh();
    await post('predict', { trial: 'kin_1', value: { distance: 50, displacement: 50 }, confidence: 2, thinkMs: 5000 });
    let t = motionInternal(store!, lesson) as any;
    expect(t.kind).toBe('motion');
    expect(t.tubes.find((x: any) => x.id === 'kin_1').open).toBe(true);
    expect(t.motion.trials).toHaveLength(0);
    await post('observe', { trial: 'kin_1' });
    t = motionInternal(store!, lesson);
    expect(t.tubes.find((x: any) => x.id === 'kin_1').open).toBe(false);
    expect(t.motion.trials[0]).toMatchObject({ id: 'kin_1', match: true, confidence: 2, thinkMs: 5000, coverage: null });
    expect(t.motion.total).toBe(21);
    expect(t.submitted).toBe(false);
  });

  it('the lesson the browser gets carries none of this', () => {
    const text = JSON.stringify(redactMotion(lesson));
    expect(text).not.toContain('Friction from the floor');
    expect(text).not.toContain('"answer"');
  });
});
