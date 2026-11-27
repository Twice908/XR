import ART_IDS from './card-art.json';

/**
 * Where a card's drawn art lives on the web client's host. File names are random ids (see
 * scripts/publish-card-art.ts), so the client can only show art for cards this service has given it: an opened pack's
 * cards, and cards the student owns. Locked cards never carry an address.
 */
export interface CardArtUrls {
  front: string;
  frontSmall: string;
  back: string;
}

/** Prefix for the art paths; empty means the same host as the web client. */
const BASE = (process.env.CARD_ART_BASE_URL ?? '').replace(/\/$/, '');
const ids = ART_IDS as Record<string, string>;

/** The manifest key for a card id: "chem-el-Na" → "elements/Na", "phys-der-force" → "physics/force". */
export function artKey(cardId: string): string | null {
  const el = /^chem-el-([A-Z][a-z]?)$/.exec(cardId);
  if (el) return `elements/${el[1]}`;
  const phys = /^phys-(?:base|der)-([a-z-]+)$/.exec(cardId);
  if (phys) return `physics/${phys[1]}`;
  return null;
}

export function artFor(cardId: string): CardArtUrls | null {
  const key = artKey(cardId);
  const id = key ? ids[key] : undefined;
  if (!id) return null;
  const at = (variant: string) => `${BASE}/cards/a/${id}-${variant}.webp`;
  return { front: at('front'), frontSmall: at('front-sm'), back: at('back') };
}

export const ART_KEYS = Object.keys(ids);
