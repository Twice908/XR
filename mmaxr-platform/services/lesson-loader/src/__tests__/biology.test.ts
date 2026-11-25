import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { dealQuiz, keywordResults, markAnswer, quizFor, redactBiology, secretTerms, type Checkpoint } from '../biology';
import { rngFor, seededRand } from '../questionEngine';

const load = (id: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../../data/${id}.json`), 'utf8'));
const LABS = [
  ['biology-101', 'biology_digestive_system', ['salivary_glands', 'mouth', 'esophagus', 'stomach', 'liver', 'pancreas', 'small_intestine', 'villi', 'large_intestine']],
  ['biology-respiratory', 'biology_respiratory_system', ['nasal_cavity', 'pharynx', 'larynx_trachea', 'bronchi', 'lungs', 'alveoli', 'diaphragm', 'cells', 'anaerobic']],
] as const;

describe.each(LABS)('%s contract', (id, type, stops) => {
  const lesson = load(id);
  const cps: Checkpoint[] = lesson.checkpoints;
  it('is the right lesson and keeps its stops in order', () => {
    expect(lesson.type).toBe(type);
    expect(cps.map((c) => c.id)).toEqual(stops);
  });
  it('has the old prediction questions and transfer scenarios removed', () => {
    for (const k of ['choices', 'groups', 'transfer']) expect(lesson).not.toHaveProperty(k);
    for (const c of cps) for (const k of ['prompt', 'answers', 'expectedKeywords', 'answerGlands']) expect(c).not.toHaveProperty(k);
  });
  it('every organ has a pool of >= 5 questions with 2-4 options and one valid answer', () => {
    for (const c of cps) {
      expect(c.quiz.length, c.id).toBeGreaterThanOrEqual(5);
      expect(new Set(c.quiz.map((q) => q.id)).size).toBe(c.quiz.length);
      for (const q of c.quiz) {
        expect(q.options.length, q.id).toBeGreaterThanOrEqual(2);
        expect(q.options.length, q.id).toBeLessThanOrEqual(4);
        expect(q.options.map((o) => o.id), q.id).toContain(q.answer);
        expect(new Set(q.options.map((o) => o.label)).size, q.id).toBe(q.options.length);
      }
    }
  });
  it('every stop teaches something and has labels for its animation', () => {
    for (const c of cps) {
      expect(c.explanation.length).toBeGreaterThan(40);
      expect(c.animLabels.length, c.id).toBeGreaterThan(0);
    }
  });
  it('has a closing explanation with keywords and a model answer', () => {
    expect(lesson.finalExplain.expectedKeywords.length).toBeGreaterThan(5);
    expect(lesson.finalExplain.modelAnswer.length).toBeGreaterThan(50);
  });
  it('asks 2-3 questions in the quiz', () => {
    expect(lesson.config.quizSize).toBeGreaterThanOrEqual(2);
    expect(lesson.config.quizSize).toBeLessThanOrEqual(3);
  });

  describe('dealing', () => {
    it('is deterministic for a session and differs between sessions', () => {
      const a = dealQuiz(lesson, rngFor('s1', id));
      expect(dealQuiz(lesson, rngFor('s1', id))).toEqual(a);
      const sigs = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(dealQuiz(lesson, rngFor(`s${i}`, id)))));
      expect(sigs.size).toBeGreaterThan(40);
    });
    it('asks quiz-size questions from different organs', () => {
      const d = dealQuiz(lesson, rngFor('x', id));
      expect(d).toHaveLength(lesson.config.quizSize);
      expect(new Set(d.map((x) => x.cp)).size).toBe(d.length);
    });
    it('balances the right answer across positions over 1000 sessions', () => {
      const hits = [0, 0, 0, 0];
      for (let i = 0; i < 1000; i++) {
        const [d] = dealQuiz(lesson, seededRand(i + 1));
        const q = cps.find((c) => c.id === d.cp)!.quiz.find((x) => x.id === d.qid)!;
        if (q.options.length === 4) hits[d.order.indexOf(q.answer)]++;
      }
      for (const h of hits) expect(h).toBeGreaterThan(150);
    });
    it('avoids questions already seen while unseen ones remain', () => {
      const seen = new Set(cps.flatMap((c) => c.quiz.slice(0, 4).map((q) => q.id)));
      for (let i = 0; i < 100; i++) for (const d of dealQuiz(lesson, seededRand(i + 9), seen)) expect(seen.has(d.qid)).toBe(false);
    });
    it('falls back to repeats when every variant has been seen', () => {
      const all = new Set(cps.flatMap((c) => c.quiz.map((q) => q.id)));
      expect(dealQuiz(lesson, seededRand(2), all)).toHaveLength(lesson.config.quizSize);
    });
  });

  describe('what the browser sees', () => {
    const deal = dealQuiz(lesson, rngFor('leak', id));
    it('the lesson has no quiz, answers or keywords', () => {
      const json = JSON.stringify(redactBiology(lesson));
      expect(json).not.toContain('"quiz"');
      expect(json).not.toContain('"answer"');
      expect(json).not.toContain('expectedKeywords');
      expect(json).not.toContain('modelAnswer');
    });
    it('the dealt questions carry no answer, no real option ids and no explanation', () => {
      const qs = quizFor(lesson, { quiz: deal });
      const json = JSON.stringify(qs);
      expect(json).not.toContain('answer');
      expect(json).not.toContain('explanation');
      for (const q of qs) {
        expect(q.options.map((o) => o.id)).toEqual(q.options.map((_, i) => `p${i}`));
        expect(q.options.length).toBeLessThanOrEqual(4);
      }
    });
    it('marks an answer by position and reveals the right one only then', () => {
      const [d] = deal;
      const q = cps.find((c) => c.id === d.cp)!.quiz.find((x) => x.id === d.qid)!;
      const rightPos = `p${d.order.indexOf(q.answer)}`;
      const ok = markAnswer(lesson, { quiz: deal }, d.qid, rightPos)!;
      expect(ok.correct).toBe(true);
      expect(ok.answerPos).toBe(rightPos);
      const wrongPos = ['p0', 'p1', 'p2', 'p3'].filter((p) => p !== rightPos && Number(p[1]) < d.order.length)[0];
      expect(markAnswer(lesson, { quiz: deal }, d.qid, wrongPos)!.correct).toBe(false);
      expect(markAnswer(lesson, { quiz: deal }, d.qid, 'p9')).toBeNull();
      expect(markAnswer(lesson, { quiz: deal }, 'nope', 'p0')).toBeNull();
    });
  });

  it('the coach guard hides the right answer of an unanswered question', () => {
    const q = cps[0].quiz[0];
    expect(secretTerms(q)).toEqual([q.options.find((o) => o.id === q.answer)!.label]);
  });
});

describe('closing explanation scoring', () => {
  const lesson = load('biology-respiratory');
  it('scores key-idea coverage with synonyms', () => {
    const fe = lesson.finalExplain;
    expect(keywordResults(fe.modelAnswer, fe.expectedKeywords, fe.keywordSynonyms).coverage).toBe(1);
    expect(keywordResults('I like pizza', fe.expectedKeywords, fe.keywordSynonyms).coverage).toBe(0);
  });
  it('the digestive model answer covers its own keywords too', () => {
    const fe = load('biology-101').finalExplain;
    expect(keywordResults(fe.modelAnswer, fe.expectedKeywords, fe.keywordSynonyms).coverage).toBe(1);
  });
});
