import { describe, expect, it } from 'vitest';
import { factsFor, pickMaterials, redactMetals, runTest, visibleSamples, type Material } from '../metals';
import fs from 'fs';
import path from 'path';

const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/metals-101.json'), 'utf8'));
const pool: Material[] = lesson.materialPool;

describe('metals-101 data', () => {
  it('every material has an outcome for every tool, and only outcomes the tool offers', () => {
    for (const m of pool) {
      for (const tool of lesson.tools) {
        const options = tool.outcomes.map((o: any) => o.id);
        expect(options, `${m.id}/${tool.id}`).toContain(m.results[tool.id]);
      }
    }
  });
  it('liquids cannot be hammered, drawn or tapped', () => {
    for (const m of pool.filter((x) => x.appearance.state === 'liquid')) {
      for (const t of ['hammer', 'wire', 'tap']) expect(m.results[t]).toBe('not_possible');
    }
  });
});

describe('pickMaterials', () => {
  it('always includes the requested exceptions and a mixed set', () => {
    for (let i = 0; i < 200; i++) {
      const s = pickMaterials(pool, 5, 2);
      expect(s).toHaveLength(5);
      expect(new Set(s.map((m) => m.id)).size).toBe(5);
      expect(s.filter((m) => m.anomalyFlag).length).toBeGreaterThanOrEqual(2);
      const metals = s.filter((m) => m.trueType === 'metal').length;
      expect(metals).toBeGreaterThanOrEqual(2);
      expect(metals).toBeLessThanOrEqual(3);
    }
  });
});

describe('what the browser may see', () => {
  it('redacted lesson has no pool, names, formulas or results', () => {
    const out = JSON.stringify(redactMetals(lesson));
    for (const secret of ['materialPool', 'Graphite', 'Mercury', 'formula', 'trueType', 'anomalyFlag', 'oxideLitmus', '"results"']) expect(out).not.toContain(secret);
    expect(out).toContain('Hammer');
  });
  it('visible samples carry looks only', () => {
    const v = JSON.stringify(visibleSamples(pool.slice(0, 3)));
    for (const secret of ['Iron', 'Fe', 'metal', 'results', 'oxide']) expect(v).not.toContain(secret);
    expect(v).toContain('colorHex');
  });
});

describe('tests', () => {
  const byId = Object.fromEntries(pool.map((m) => [m.id, m]));
  it('shows the anomalies the lesson is built around', () => {
    expect(runTest(byId.graphite, 'circuit')?.outcome).toBe('glows');
    expect(runTest(byId.iodine, 'hammer')?.outcome).toBe('shatters');
    expect(runTest(byId.mercury, 'hammer')?.outcome).toBe('not_possible');
    expect(runTest(byId.sodium, 'water')?.outcome).toBe('violent');
  });
  it('the oxygen test also reports what litmus did with the oxide', () => {
    expect(runTest(byId.magnesium, 'oxygen')).toEqual({ outcome: 'burns_bright', litmus: 'blue_basic' });
    expect(runTest(byId.sulfur, 'oxygen')).toEqual({ outcome: 'burns', litmus: 'red_acidic' });
  });
  it('unknown tools return null; facts are plain text', () => {
    expect(runTest(byId.iron, 'nope')).toBeNull();
    expect(factsFor(byId.graphite)).toMatch(/conducts/i);
  });
});
