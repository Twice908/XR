/**
 * Questions the coach answers without the model: instant, free, and unable to leak anything.
 *
 *   repeat: "say that again", "pardon?"            -> the coach's last reply, word for word
 *   next:   "what do I do now?", "I'm lost"        -> the last narration line the student heard (their current step)
 *
 * Only a whole utterance matches, after polite filler is stripped. Anything with more in it ("what do I do with the
 * ammeter?") is a real question and goes to the model.
 */
export type Intent = 'repeat' | 'next';

const FILLER_START = /^(?:(?:um+|uh+|er+|hey|hi|ok(?:ay)?|so|sorry|excuse me|coach|please|can you|could you|would you|will you)\s+)+/;
const FILLER_END = /(?:\s+(?:please|coach|thanks|thank you))+$/;

const REPEAT = new Set([
  'repeat',
  'repeat that',
  'repeat it',
  'repeat please',
  'say that again',
  'say it again',
  'again',
  'one more time',
  'come again',
  'pardon',
  'pardon me',
  'what',
  'what did you say',
  'what was that',
  'i did not hear that',
  'i didnt hear that',
  'i didnt hear you',
  'i did not hear you',
]);

const NEXT = new Set([
  'what do i do',
  'what do i do now',
  'what do i do next',
  'what should i do',
  'what should i do now',
  'what should i do next',
  'what now',
  'whats next',
  'what is next',
  'what next',
  'what am i doing',
  'what am i supposed to do',
  'what do i have to do',
  'where am i',
  'im lost',
  'i am lost',
  'what is my task',
  'whats my task',
  'what is the task',
  'whats the task',
]);

export function matchIntent(text: string): Intent | null {
  const t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FILLER_START, '')
    .replace(FILLER_END, '')
    .trim();
  if (!t || t.split(' ').length > 8) return null;
  if (REPEAT.has(t)) return 'repeat';
  if (NEXT.has(t)) return 'next';
  return null;
}
