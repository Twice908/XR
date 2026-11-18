import type { EventKind } from './protocol';

/** Deterministic Socratic prompts used when the model is unavailable (no key, no credit, offline). */
export function fallbackReply(kind: EventKind | 'ask' | 'reveal'): string {
  switch (kind) {
    case 'prediction_mismatch':
      return 'That was not what you expected. What does it tell you about your idea for this tube?';
    case 'revision':
      return 'You changed your mind there. What new evidence made you switch?';
    case 'ph_unlocked':
      return 'Every tube has a conclusion. Before you use the pH paper, which one are you least sure about, and why?';
    case 'ready_to_submit':
      return 'Before you submit, look over your table once more. Does anything in it disagree with something else?';
    case 'idle':
      return 'Stuck? Pick one tube and say out loud what you expect before you test it.';
    case 'reveal':
      return 'You have finished. Which result surprised you most, and what would you do differently next time?';
    default:
      return 'Tell me what you predicted and what you actually saw. What is different about the two?';
  }
}
