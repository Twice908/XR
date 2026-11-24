/*
 * Deterministic answer-leak filter for learner-facing coach text.
 * Pure TypeScript: no network, no LLM, no runtime dependencies.
 *
 * Two modes:
 *  - legacy strict (default): any digit or formula keyword is blocked (physics prototype).
 *  - secret-aware: numbers are fine; only the session's hidden answers are blocked
 *    (substance names/formulas, a tube's acid/base/neutral verdict, a tube's pH).
 */

export interface SecretTube {
  tube: number;
  /** Names and formulas that identify the substance, e.g. ["Hydrochloric Acid", "HCl"]. */
  terms: string[];
  /** acid | base | neutral */
  verdict?: string;
  ph?: number;
}

export interface GuardOptions {
  /** Do not block ordinary numbers. Required for secret-aware mode. */
  allowNumbers?: boolean;
  secrets?: SecretTube[];
  /** Check tube verdicts and pH claims even when no secrets are available (fail closed if the answers could not be loaded). */
  enforceTubeClaims?: boolean;
  /** A tube verdict the student has already stated may be repeated back to them. */
  allowedVerdicts?: { tube: number; verdict: string }[];
  /** pH numbers the student has already written down may be repeated back. */
  allowedPh?: number[];
  fallback?: string;
}

export interface GuardResult {
  safeResponse: string;
  wasBlocked: boolean;
  reasons: string[];
}

const LEGACY_FALLBACK =
  "I can't give you the numbers or the formula. What did you predict before you fired the photon, and how does the observation compare to that prediction?";
export const DEFAULT_FALLBACK = "Let's work that out from what you've seen. What did you expect to happen, and what did you actually observe?";

const SUBSCRIPTS: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

/** Fold case, subscripts and lookalike whitespace/punctuation so simple obfuscation does not slip through. */
export function normalize(text: string): string {
  return text
    .replace(/[₀-₉]/g, (c) => SUBSCRIPTS[c] ?? c)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[_*`~|]/g, ' ')
    .replace(/\s+/g, ' ');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Citric Acid (Lemon Juice)" -> ["citric acid", "lemon juice", "citric acid (lemon juice)"] */
function termVariants(term: string): string[] {
  const t = normalize(term).trim();
  if (t.length < 2) return [];
  const out = new Set<string>([t]);
  const m = t.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (m) {
    if (m[1].trim().length >= 2) out.add(m[1].trim());
    if (m[2].trim().length >= 2) out.add(m[2].trim());
  }
  return [...out];
}

const containsTerm = (haystack: string, term: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(term)}(?![a-z0-9])`).test(haystack);

const VERDICT_WORDS: Record<string, string> = {
  acid: 'acid', acidic: 'acid', base: 'base', basic: 'base', alkaline: 'base', neutral: 'neutral',
  metal: 'metal', metallic: 'metal', 'non-metal': 'non-metal', nonmetal: 'non-metal', 'non-metallic': 'non-metal', 'non metal': 'non-metal',
};

export function applyGuardrails(aiResponse: string, options: GuardOptions = {}): GuardResult {
  const reasons: string[] = [];
  const text = normalize(aiResponse);

  if (!options.allowNumbers) {
    if (/\d+(\.\d+)?/.test(aiResponse) || /(wavelength\s*=|e\s*=|rydberg|formula)/i.test(aiResponse)) reasons.push('numbers-or-formula');
  }

  for (const s of options.secrets ?? []) {
    for (const term of s.terms.flatMap(termVariants)) {
      if (containsTerm(text, term)) {
        reasons.push(`secret-term:${s.tube}`);
        break;
      }
    }
  }

  // "tube 2 is an acid" / "sample 3 is a metal": block any verdict for an item other than the one the student already stated.
  if (options.secrets?.length || options.enforceTubeClaims) {
    const verdictRe = /\b(?:tubes?|samples?)\s*#?\s*(\d)\b[^.?!\n]{0,40}?\b(acid(?:ic)?|base|basic|alkaline|neutral|non-metallic|non-metal|nonmetal|non metal|metallic|metal)\b/g;
    for (const m of text.matchAll(verdictRe)) {
      const tube = Number(m[1]);
      const verdict = VERDICT_WORDS[m[2]];
      const echo = (options.allowedVerdicts ?? []).some((a) => a.tube === tube && a.verdict === verdict);
      if (!echo) reasons.push(`verdict:${tube}`);
    }

    const phRe = /\bph\b[^.?!\n]{0,24}?(\d+(?:\.\d+)?)/g;
    for (const m of text.matchAll(phRe)) {
      if (!(options.allowedPh ?? []).includes(Number(m[1]))) reasons.push('ph-value');
    }
  }

  if (reasons.length === 0) return { safeResponse: aiResponse, wasBlocked: false, reasons: [] };
  const fallback = options.fallback ?? (options.allowNumbers ? DEFAULT_FALLBACK : LEGACY_FALLBACK);
  return { safeResponse: fallback, wasBlocked: true, reasons };
}
