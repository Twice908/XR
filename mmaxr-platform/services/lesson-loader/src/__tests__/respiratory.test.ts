import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { answerIds, cleanSelection, groupsOf, keywordResults, redactBiology, revealFor, scoreSelection, secretTerms, type Checkpoint, type Commit } from '../biology';

const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/biology-respiratory.json'), 'utf8'));
const cps: Checkpoint[] = lesson.checkpoints;
const groups = groupsOf(lesson);
const cp = (id: string) => cps.find((c) => c.id === id)!;

describe('biology-respiratory data', () => {
  it('is a biology lesson with its own question groups', () => {
    expect(lesson.type).toBe('biology_respiratory_system');
    expect(groups.map((g) => g.key)).toEqual(['organs', 'features', 'processes', 'molecules']);
  });
  it('every answer exists in its choice pool and every stop answers every group', () => {
    for (const c of cps) for (const g of groups) {
      const ids = answerIds(c, g.key);
      expect(ids.length, `${c.id}/${g.key}`).toBeGreaterThan(0);
      for (const id of ids) expect(lesson.choices[g.key].map((o: any) => o.id), `${c.id}/${g.key}`).toContain(id);
    }
  });
  it('uses the supplied torso and lungs models, which exist in the assets folder', () => {
    for (const k of ['torso', 'lungs']) {
      const file = lesson.assets[k].split('/assets/')[1];
      expect(fs.existsSync(path.join(__dirname, '../../../../../mmaxr-assets', file)), file).toBe(true);
    }
  });
  it('covers every part and idea asked for', () => {
    expect(cps.map((c) => c.id)).toEqual(['nasal_cavity', 'pharynx', 'larynx_trachea', 'bronchi', 'lungs', 'alveoli', 'diaphragm', 'cells', 'anaerobic']);
    const text = JSON.stringify(lesson).toLowerCase();
    for (const w of ['external respiration', 'internal', 'aerobic', 'anaerobic', 'lactic acid', 'yeast', 'alcohol', 'alveoli', 'bronchi', 'larynx', 'pharynx', 'nasal', 'mucus', 'hair', 'oxygen', 'carbon dioxide', 'diffus']) expect(text).toContain(w);
  });
  it('scenario answers are among their options, and the final explanation has keywords', () => {
    for (const s of lesson.transfer.scenarios) expect(s.options.map((o: any) => o.id)).toContain(s.answer);
    expect(lesson.finalExplain.expectedKeywords.length).toBeGreaterThan(5);
  });
  it('the answers do not follow the order of the pools (no giveaway sequence)', () => {
    const first = cps.map((c) => lesson.choices.organs.findIndex((o: any) => o.id === answerIds(c, 'organs')[0]));
    expect(new Set(first).size).toBeGreaterThan(5);
  });
});

describe('respiratory scoring and secrecy', () => {
  it('scores any set of groups', () => {
    const al = cp('alveoli');
    const right = Object.fromEntries(groups.map((g) => [g.key, answerIds(al, g.key)]));
    expect(scoreSelection(al, right, groups).allCorrect).toBe(true);
    const part = scoreSelection(al, { ...right, molecules: ['oxygen'] }, groups);
    expect(part.allCorrect).toBe(false);
    expect(part.molecules).toBeCloseTo(0.5);
    expect(part.organs).toBe(1);
  });
  it('needs an answer in every group', () => {
    expect(cleanSelection({ organs: ['lungs'], features: ['pleura'], processes: ['expand'] }, lesson.choices, groups)).toBeNull();
    expect(cleanSelection({ organs: ['lungs'], features: ['pleura'], processes: ['expand'], molecules: ['oxygen', 'bogus'] }, lesson.choices, groups)).toEqual({ organs: ['lungs'], features: ['pleura'], processes: ['expand'], molecules: ['oxygen'] });
  });
  it('the browser gets no answers, keywords, reveal text or model answer', () => {
    const out = JSON.stringify(redactBiology(lesson));
    for (const secret of ['"answers"', 'expectedKeywords', 'keywordSynonyms', 'revealExplanation', 'modelAnswer', 'structuresInvolved', '"answer"', '"explanation"']) expect(out).not.toContain(secret);
    expect(out).toContain('"groups"');
    expect(out).toContain('entrance of the respiratory system');
    expect(JSON.parse(out).finalExplain.prompt).toContain('oxygen molecule');
    expect(JSON.parse(out).revealLabels).toEqual(['features', 'molecules']);
  });
  it('the coach guard knows what to hide at a stop', () => {
    expect(secretTerms(cp('nasal_cavity')).join(' ').toLowerCase()).toContain('cilia');
  });
  it('reveals answers for every group with labels', () => {
    const al = cp('alveoli');
    const kw = keywordResults('Oxygen diffuses through the thin walls of the alveoli into capillaries and carbon dioxide leaves', al.expectedKeywords, al.keywordSynonyms);
    const commit = { selectionScore: { allCorrect: true }, matched: kw.matched, missed: kw.missed, coverage: kw.coverage } as unknown as Commit;
    const r = revealFor(al, commit, lesson.choices, groups) as any;
    expect(r.answer.molecules.map((o: any) => o.label)).toEqual(expect.arrayContaining(['Oxygen (O₂)']));
    expect(r.coverage).toBe(1);
  });
  it('keyword matching understands the final explanation', () => {
    const fe = lesson.finalExplain;
    const r = keywordResults('Air goes in the nose then the throat and voice box and windpipe into the bronchi and alveoli where blood picks up oxygen for cells and the diaphragm lowers the pressure', fe.expectedKeywords, fe.keywordSynonyms);
    expect(r.coverage).toBeGreaterThan(0.8);
    expect(keywordResults('I like breathing', fe.expectedKeywords, fe.keywordSynonyms).coverage).toBe(0);
  });
});
