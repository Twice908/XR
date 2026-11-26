export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Subject = 'chemistry' | 'physics' | 'mathematics' | 'biology';

export const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITY_RANK: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** A card as written in the catalog source. The micro-question is built from `quizField` at load time. */
export interface CardSeed {
  id: string;
  subject: Subject;
  set: string;
  rarity: Rarity;
  title: string;
  /** Short label shown under the title: a symbol, formula, unit or Latin name. */
  subtitle: string;
  /** Position within the set (atomic number for elements). */
  order: number;
  data: Record<string, string | number | boolean | string[]>;
  funFact: string;
  /** Which `data` field the one-tap question asks about; other cards in the set supply the wrong choices. */
  quizField: string;
  /** Lesson ids whose completion makes this card more likely. */
  lessons: string[];
}

export interface MicroQuestion {
  prompt: string;
  choices: string[];
  answerIndex: number;
}

export interface Card extends CardSeed {
  question: MicroQuestion | null;
}
