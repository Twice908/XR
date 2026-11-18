import { describe, expect, it } from 'vitest';
import { applyGuardrails, type GuardOptions } from '..';

const secrets: GuardOptions['secrets'] = [
  { tube: 1, terms: ['Hydrochloric Acid', 'HCl'], verdict: 'acid', ph: 1 },
  { tube: 2, terms: ['Citric Acid (Lemon Juice)', 'C6H8O7'], verdict: 'acid', ph: 2 },
  { tube: 3, terms: ['Sodium Chloride', 'NaCl'], verdict: 'neutral', ph: 7 },
];
const opts: GuardOptions = { allowNumbers: true, secrets };
const blocked = (t: string, o: GuardOptions = opts) => applyGuardrails(t, o).wasBlocked;

describe('legacy strict mode (physics prototype)', () => {
  it('blocks digits and formula keywords', () => {
    expect(blocked('The wavelength is 656 nanometers', {})).toBe(true);
    expect(blocked('Use the Rydberg formula', {})).toBe(true);
  });
  it('lets a plain question through', () => {
    expect(blocked('What did you predict before you fired the photon?', {})).toBe(false);
  });
});

describe('secret-aware mode', () => {
  it('allows ordinary numbers and coaching', () => {
    expect(blocked('You have tested 3 of 5 tubes. Which one surprised you most?')).toBe(false);
    expect(blocked('Try the next tube with a different indicator.')).toBe(false);
  });

  it('blocks substance names and formulas, however they are written', () => {
    expect(blocked('That one looks like hydrochloric acid.')).toBe(true);
    expect(blocked('Could it be HCl?')).toBe(true);
    expect(blocked('maybe h c l')).toBe(false); // spaced letters are not the term itself
    expect(blocked('It is NaCl, salt.')).toBe(true);
    expect(blocked('Looks like C₆H₈O₇')).toBe(true); // subscripts folded
    expect(blocked('H C L is wrong but h​cl (zero-width) is blocked')).toBe(true);
    expect(blocked('lemon juice, I think')).toBe(true); // parenthetical alias
  });

  it('does not block generic chemistry words', () => {
    expect(blocked('Acids usually turn litmus red. What did you see?')).toBe(false);
    expect(blocked('Salt dissolves, but did the indicator change?')).toBe(false);
  });

  it('blocks a verdict for a tube, but lets the student own claim be echoed', () => {
    expect(blocked('Tube 2 is acidic.')).toBe(true);
    expect(blocked('I would say tube 1 is a base')).toBe(true);
    expect(blocked('You said tube 3 is neutral. What makes you sure?')).toBe(true);
    expect(blocked('You said tube 3 is neutral. What makes you sure?', { ...opts, allowedVerdicts: [{ tube: 3, verdict: 'neutral' }] })).toBe(false);
    // Echoing a claim does not license a different verdict for the same tube.
    expect(blocked('Tube 3 is actually an acid', { ...opts, allowedVerdicts: [{ tube: 3, verdict: 'neutral' }] })).toBe(true);
  });

  it('blocks pH values unless the student already wrote them down', () => {
    expect(blocked('The pH of tube 1 is around 1')).toBe(true);
    expect(blocked('pH 7 would be neutral')).toBe(true);
    expect(blocked('You wrote pH 4 for that tube. How did you get it?', { ...opts, allowedPh: [4] })).toBe(false);
    expect(blocked('What does the paper colour tell you about its pH?')).toBe(false);
  });

  it('can fail closed: verdict and pH claims are blocked even with no secrets loaded', () => {
    const closed: GuardOptions = { allowNumbers: true, secrets: [], enforceTubeClaims: true };
    expect(blocked('Tube 2 is acidic.', closed)).toBe(true);
    expect(blocked('The pH of tube 1 is 1', closed)).toBe(true);
    expect(blocked('Which tube surprised you most?', closed)).toBe(false);
  });

  it('returns a Socratic fallback and the reasons when it blocks', () => {
    const r = applyGuardrails('Tube 1 is HCl', opts);
    expect(r.wasBlocked).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.safeResponse).toMatch(/expect|observed|seen/i);
  });

  it('is deterministic', () => {
    expect(applyGuardrails('Tube 2 is acidic.', opts)).toEqual(applyGuardrails('Tube 2 is acidic.', opts));
  });
});
