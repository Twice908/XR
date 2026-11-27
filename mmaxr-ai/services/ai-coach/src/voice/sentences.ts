/**
 * Splits a coach reply into sentences so each can be spoken (and sent) as soon as it is ready.
 * Very short pieces ("Good.") are joined to the next one, so the voice does not stop and start.
 */
export function splitSentences(text: string, minChars = 24): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9"“'‘(])/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let carry = '';
  for (const p of parts) {
    carry = carry ? `${carry} ${p}` : p;
    if (carry.length >= minChars) {
      out.push(carry);
      carry = '';
    }
  }
  if (carry) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${carry}`;
    else out.push(carry);
  }
  return out;
}

/**
 * For a reply still being written: takes the sentences in `buffer` that are certainly finished (another sentence has
 * started after them) and returns the rest to keep growing. Short sentences wait to be joined to the next one; a
 * finished sentence is never held back by the unfinished text after it.
 */
export function takeSentences(buffer: string, minChars = 24): { done: string[]; rest: string } {
  const parts = buffer.replace(/\s+/g, ' ').replace(/^ /, '').split(/(?<=[.!?…])\s+(?=[A-Z0-9"“'‘(])/);
  if (parts.length <= 1) return { done: [], rest: buffer };
  const done: string[] = [];
  let carry = '';
  for (const p of parts.slice(0, -1)) {
    carry = carry ? `${carry} ${p.trim()}` : p.trim();
    if (carry.length >= minChars) {
      done.push(carry);
      carry = '';
    }
  }
  const tail = parts[parts.length - 1];
  return { done, rest: carry ? `${carry} ${tail}` : tail };
}
