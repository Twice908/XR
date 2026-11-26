import { CELL_CARDS, NOMENCLATURE_CARDS, SYSTEM_CARDS } from './biology';
import { COMPOUND_CARDS, ELEMENT_CARDS } from './chemistry';
import { FORMULA_CARDS, POWER_CARDS, SYMBOL_CARDS } from './mathematics';
import { DERIVED_CARDS, FUNDAMENTAL_CARDS } from './physics';
import type { Card, CardSeed, MicroQuestion, Subject } from './types';

export * from './types';

/** Bump when card content changes so the database copy is refreshed on the next start. */
export const CATALOG_VERSION = 'catalog-1';

export const SETS: { subject: Subject; set: string; title: string }[] = [
  { subject: 'chemistry', set: 'elements', title: 'Elements' },
  { subject: 'chemistry', set: 'compounds', title: 'Compounds' },
  { subject: 'physics', set: 'fundamental-quantities', title: 'Fundamental Quantities' },
  { subject: 'physics', set: 'derived-quantities', title: 'Derived Quantities' },
  { subject: 'mathematics', set: 'symbols', title: 'Symbols' },
  { subject: 'mathematics', set: 'powers', title: 'Powers' },
  { subject: 'mathematics', set: 'formulas', title: 'Formulas' },
  { subject: 'biology', set: 'cells', title: 'Cells' },
  { subject: 'biology', set: 'systems', title: 'Systems' },
  { subject: 'biology', set: 'nomenclature', title: 'Nomenclature' },
];

const SEEDS: CardSeed[] = [
  ...ELEMENT_CARDS, ...COMPOUND_CARDS,
  ...FUNDAMENTAL_CARDS, ...DERIVED_CARDS,
  ...SYMBOL_CARDS, ...POWER_CARDS, ...FORMULA_CARDS,
  ...CELL_CARDS, ...SYSTEM_CARDS, ...NOMENCLATURE_CARDS,
];

const FIELD_LABEL: Record<string, string> = {
  symbol: 'symbol', formula: 'formula', unit: 'SI unit', meaning: 'meaning', rule: 'rule', job: 'main job', binomial: 'scientific name', ranks: 'correct order of ranks',
};

const show = (v: unknown) => (Array.isArray(v) ? v.join(' → ') : String(v));

/** A small deterministic hash, so a card's question and choice order stay the same between restarts. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function questionFor(card: CardSeed, siblings: CardSeed[]): MicroQuestion | null {
  const answer = card.data[card.quizField];
  if (answer === undefined) return null;
  const right = show(answer);
  const label = FIELD_LABEL[card.quizField] ?? card.quizField;
  if (card.quizField === 'ranks' && Array.isArray(answer)) {
    // A single card in its kind: the wrong choices are shuffled orders of the same ranks.
    const swaps = [[1, 2], [4, 5], [6, 7]].map(([a, b]) => {
      const x = [...answer];
      [x[a], x[b]] = [x[b], x[a]];
      return show(x);
    });
    return arrange(card.id, `Which is the ${label}, from broadest to narrowest?`, right, swaps);
  }
  const wrong = [...new Set(siblings.filter((s) => s.id !== card.id && s.quizField === card.quizField).map((s) => show(s.data[s.quizField])))]
    .filter((v) => v !== right)
    .sort((a, b) => hash(card.id + a) - hash(card.id + b))
    .slice(0, 3);
  if (wrong.length < 2) return null;
  return arrange(card.id, `What is the ${label} of ${card.title}?`, right, wrong);
}

function arrange(id: string, prompt: string, right: string, wrong: string[]): MicroQuestion {
  const choices = [right, ...wrong].sort((a, b) => hash(id + '|' + a) - hash(id + '|' + b));
  return { prompt, choices, answerIndex: choices.indexOf(right) };
}

function build(): Card[] {
  const ids = new Set<string>();
  return SEEDS.map((seed) => {
    if (ids.has(seed.id)) throw new Error(`Duplicate card id ${seed.id}`);
    ids.add(seed.id);
    const siblings = SEEDS.filter((s) => s.subject === seed.subject && s.set === seed.set);
    return { ...seed, question: questionFor(seed, siblings) };
  });
}

export const CARDS: Card[] = build();
export const CARD_BY_ID = new Map(CARDS.map((c) => [c.id, c]));
