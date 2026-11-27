/**
 * Give card art unguessable file names, so the web client can only show a card once the rewards API has handed it
 * that card's image address (for a card the student has revealed or owns).
 *
 *   1. mmaxr-assets/Cards/build_card_webp.py writes  public/cards/{elements|physics}/{name}-{front|front-sm|back}.webp
 *   2. pnpm --filter ./mmaxr-platform/services/rewards art:publish
 *      moves them to                                 public/cards/a/{random id}-{front|front-sm|back}.webp
 *      and records "elements/Na" → id in            src/catalog/card-art.json
 *
 * A card keeps its id once it has one, so updated art replaces the old files in place. Safe to run again: with
 * nothing new to publish it changes nothing.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../../..');
const PUBLIC_CARDS = path.join(ROOT, 'mmaxr-webxr-client/public/cards');
const OUT = path.join(PUBLIC_CARDS, 'a');
const MANIFEST = path.resolve(__dirname, '../src/catalog/card-art.json');
const VARIANTS = ['front-sm', 'front', 'back'] as const;
const FILE_RE = /^(.+)-(front-sm|front|back)\.webp$/;

const manifest: Record<string, string> = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {};
fs.mkdirSync(OUT, { recursive: true });

let moved = 0;
let added = 0;
for (const kind of ['elements', 'physics']) {
  const dir = path.join(PUBLIC_CARDS, kind);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    const m = FILE_RE.exec(file);
    if (!m) continue;
    const key = `${kind}/${m[1]}`;
    if (!manifest[key]) {
      manifest[key] = crypto.randomBytes(16).toString('hex');
      added++;
    }
    fs.renameSync(path.join(dir, file), path.join(OUT, `${manifest[key]}-${m[2]}.webp`));
    moved++;
  }
  if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

// Every card in the manifest must have all three files.
const missing = Object.entries(manifest).flatMap(([key, id]) => VARIANTS.filter((v) => !fs.existsSync(path.join(OUT, `${id}-${v}.webp`))).map((v) => `${key} (${v})`));
if (missing.length) {
  console.error(`Missing art files:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Published ${moved} files (${added} new cards). ${Object.keys(sorted).length} cards have art.`);
