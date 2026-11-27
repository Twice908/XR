import { describe, expect, it } from 'vitest';
import { fallbackReply } from '../fallback';

const kinds = ['prediction_mismatch', 'revision', 'ph_unlocked', 'ready_to_submit', 'idle', 'reveal', 'ask'] as const;
const labs = [
  'chemistry_indicators',
  'chemistry_metals',
  'biology_digestive_system',
  'biology_respiratory_system',
  'physics_waves_sound',
  'physics_optics',
  'physics_mechanics_sandbox',
  'physics_electromagnetism',
  'physics_circuits',
  'physics_simple_machines',
  'physics_fundamentals_sandbox',
  'science_matter_properties',
  'chemistry_atom_builder',
  undefined,
];

describe('fallbackReply', () => {
  it('has a line for every lab and every kind', () => {
    for (const lab of labs) for (const k of kinds) expect(fallbackReply(k, lab).length).toBeGreaterThan(20);
  });

  it("only the indicators lab talks about tubes or pH paper", () => {
    for (const lab of labs.filter((l) => l !== 'chemistry_indicators')) {
      for (const k of kinds) expect(fallbackReply(k, lab)).not.toMatch(/\btubes?\b|pH paper/i);
    }
    expect(fallbackReply('idle', 'chemistry_indicators')).toMatch(/tube/);
    expect(fallbackReply('ph_unlocked', 'chemistry_indicators')).toMatch(/pH paper/);
  });

  it('uses each lab\'s own words', () => {
    expect(fallbackReply('idle', 'chemistry_metals')).toMatch(/sample/);
    expect(fallbackReply('ph_unlocked', 'chemistry_metals')).toMatch(/test runs are left/);
    expect(fallbackReply('idle', 'biology_respiratory_system')).toMatch(/stop/);
    expect(fallbackReply('idle', 'physics_waves_sound')).toMatch(/task/);
    expect(fallbackReply('idle', 'physics_optics')).toMatch(/light/);
  });

  it('every line asks the student something back', () => {
    for (const lab of labs) for (const k of kinds) expect(fallbackReply(k, lab)).toContain('?');
  });
});
