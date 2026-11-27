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
