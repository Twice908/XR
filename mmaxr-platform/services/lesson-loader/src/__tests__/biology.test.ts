import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { cleanSelection, keywordResults, redactBiology, revealFor, scoreFinal, scoreSelection, secretTerms, stem, wordCount, type Checkpoint, type Commit } from '../biology';

const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/biology-101.json'), 'utf8'));
const cps: Checkpoint[] = lesson.checkpoints;
const cp = (id: string) => cps.find((c) => c.id === id)!;

describe('biology-101 data', () => {
  it('every answer id exists in the choice pools', () => {
    for (const c of cps) {
      for (const id of c.answerGlands) expect(lesson.choices.glands.map((o: any) => o.id)).toContain(id);
      for (const id of c.answerJuices) expect(lesson.choices.juices.map((o: any) => o.id)).toContain(id);
      for (const id of c.answerNutrients) expect(lesson.choices.nutrients.map((o: any) => o.id)).toContain(id);
    }
  });
  it('scenario answers are among their options', () => {
    for (const s of lesson.transfer.scenarios) expect(s.options.map((o: any) => o.id)).toContain(s.answer);
  });
  it('uses the available models', () => {
    expect(Object.values(lesson.assets).join(' ')).toMatch(/digestive-system.*human-stomach.*liver.*human-tooth/);
  });
});

describe('keyword matching', () => {
  const mouth = cp('mouth');
  it('matches keywords, synonyms and simple inflections', () => {
    const r = keywordResults('Teeth are chewing the food and saliva contains amylase which digests starch into sugars', mouth.expectedKeywords, mouth.keywordSynonyms);
    expect(r.matched).toEqual(expect.arrayContaining(['saliva', 'amylase', 'chewing', 'starch', 'carbohydrate']));
    expect(r.coverage).toBe(1);
  });
  it('reports what is missing', () => {
    const r = keywordResults('The tongue pushes the food around', mouth.expectedKeywords, mouth.keywordSynonyms);
    expect(r.coverage).toBe(0);
    expect(r.missed).toHaveLength(mouth.expectedKeywords.length);
  });
  it('does not count a keyword that is merely a fragment of another word', () => {
    expect(keywordResults('The salivation response', ['saliva'], {}).matched).toEqual([]);
    expect(keywordResults('proteins', ['protein'], {}).matched).toEqual(['protein']);
  });
  it('handles multi-word keywords and their phrasings', () => {
    const li = cp('large_intestine');
    const r = keywordResults('The large intestine absorbs water and the faeces are stored in the rectum then pushed out of the anus', li.expectedKeywords, li.keywordSynonyms);
    expect(r.matched).toEqual(expect.arrayContaining(['water absorption', 'faeces', 'rectum', 'anus']));
  });
  it('stems', () => {
    expect(stem('absorbing')).toBe(stem('absorbs'));
    expect(wordCount('One two  three!')).toBe(3);
  });
});

describe('selection scoring', () => {
  const lp = cp('liver_pancreas');
  it('is exact for the full right answer', () => {
    expect(scoreSelection(lp, { glands: ['liver', 'pancreas'], juices: ['bile', 'pancreatic_juice'], nutrients: ['fats', 'proteins'] }).allCorrect).toBe(true);
  });
  it('gives partial credit', () => {
    const s = scoreSelection(lp, { glands: ['liver'], juices: ['bile', 'pancreatic_juice'], nutrients: ['fats'] });
    expect(s.allCorrect).toBe(false);
    expect(s.glands).toBeCloseTo(0.5);
    expect(s.juices).toBe(1);
  });
  it('rejects empty or unknown picks', () => {
    expect(cleanSelection({ glands: [], juices: ['saliva'], nutrients: ['carbs'] }, lesson.choices)).toBeNull();
    expect(cleanSelection({ glands: ['x'], juices: ['saliva'], nutrients: ['carbs'] }, lesson.choices)).toBeNull();
    expect(cleanSelection({ glands: ['salivary'], juices: ['saliva'], nutrients: ['carbs'] }, lesson.choices)).toEqual({ glands: ['salivary'], juices: ['saliva'], nutrients: ['carbs'] });
  });
});

describe('what the browser may see', () => {
  const out = JSON.stringify(redactBiology(lesson));
  it('has no answers, keywords, reveal text or scenario answers', () => {
    for (const secret of ['answerGlands', 'answerJuices', 'answerNutrients', 'expectedKeywords', 'keywordSynonyms', 'revealExplanation', 'Pepsin breaks down', 'glandsInvolved', 'juicesInvolved', 'targetNutrient', '"answer"', '"explanation"']) expect(out).not.toContain(secret);
  });
  it('keeps the questions and answer pools', () => {
    expect(out).toContain('What is the role of teeth');
    expect(out).toContain('Pancreas');
    expect(redactBiology(lesson).checkpoints).toHaveLength(5);
  });
  it('the coach guard terms cover the answers of a checkpoint', () => {
    const t = secretTerms(cp('stomach')).join(' ').toLowerCase();
    for (const w of ['pepsin', 'hcl', 'mucus', 'gastric']) expect(t).toContain(w);
  });
});

describe('reveal and final', () => {
  it('reveals the explanation with matched and missed keywords', () => {
    const c = cp('stomach');
    const kw = keywordResults('Acid and pepsin break down protein', c.expectedKeywords, c.keywordSynonyms);
    const commit = { selectionScore: scoreSelection(c, { glands: ['gastric'], juices: ['gastric_juice'], nutrients: ['proteins'] }), matched: kw.matched, missed: kw.missed, coverage: kw.coverage } as unknown as Commit;
    const r = revealFor(c, commit, lesson.choices);
    expect(r.explanation).toContain('Pepsin');
    expect(r.keywords.find((k) => k.keyword === 'pepsin')!.matched).toBe(true);
    expect(r.keywords.find((k) => k.keyword === 'mucus')!.matched).toBe(false);
    expect(r.selectionScore.allCorrect).toBe(true);
  });
  it('scores the transfer scenarios', () => {
    const r = scoreFinal(lesson.transfer.scenarios, { bile_blocked: 'fats', no_chewing: 'pepsin', no_acid: 'pepsin' });
    expect(r.correct).toBe(2);
    expect(r.total).toBe(3);
  });
});
