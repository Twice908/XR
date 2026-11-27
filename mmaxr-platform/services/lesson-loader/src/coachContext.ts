/**
 * The public context the AI coach is given about a lab: only what the student can already see on screen.
 *
 * Built from an allowlist. Nothing here may carry an answer: no outcomes, expected results, indicator colours,
 * explanations, quiz options, laws, worked examples or formulas (a concept card's examples can spell out a trial's
 * answer, so only its title and main idea are kept).
 */

export interface NarrationDoc {
  cues?: { id: string; text: string }[];
}

const MAX_CHARS = 6000;

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function buildCoachContext(lesson: any, narration: NarrationDoc | null): string {
  const out: string[] = [];
  const add = (line: string) => {
    if (line) out.push(line);
  };

  add(`Lab: ${clean(lesson?.title)}.`);
  add(clean(lesson?.summary));

  // Benches / sections of the sandbox labs: their name, what is on the bench, and the concept cards they open with.
  for (const s of Array.isArray(lesson?.scenarios) ? lesson.scenarios : []) {
    const name = clean(s?.tabName) || clean(s?.title);
    const setup = clean(s?.setup);
    if (name || setup) add(`Bench "${name}": ${setup}`);
    for (const t of Array.isArray(s?.trials) ? s.trials : []) {
      const c = t?.concept;
      if (c && clean(c.title) && clean(c.idea)) add(`Concept card "${clean(c.title)}": ${clean(c.idea)}`);
    }
  }

  // Metals lab: the tests on the bench and the property each one checks (never their outcomes).
  for (const t of Array.isArray(lesson?.tools) ? lesson.tools : []) {
    if (clean(t?.name)) add(`Test: ${clean(t.name)}${clean(t.property) ? `, checks ${clean(t.property).toLowerCase()}` : ''}.`);
  }

  // Indicators lab: indicator names and where they come from (never their colours).
  for (const i of Array.isArray(lesson?.indicators) ? lesson.indicators : []) {
    if (clean(i?.name)) add(`Indicator: ${clean(i.name)}${clean(i.source) ? ` (${clean(i.source)})` : ''}.`);
  }

  // Biology journeys: the stops, by the name shown on screen.
  const stops = (Array.isArray(lesson?.checkpoints) ? lesson.checkpoints : []).map((c: any) => clean(c?.organName)).filter(Boolean);
  if (stops.length) add(`Journey stops, in order: ${stops.join(', ')}.`);

  // What the lab's narrator says, so the coach can repeat or rephrase an instruction.
  const lines = (narration?.cues ?? []).map((c) => clean(c?.text)).filter(Boolean);
  if (lines.length) add(`What the lab's narrator tells the student:\n${lines.map((l) => `- ${l}`).join('\n')}`);

  const text = out.join('\n');
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}
