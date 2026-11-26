# Card and pack design spec (for Figma)

The client draws **placeholder** cards and packs today. This is the contract the final designs drop into. Only
`src/gamification/cardFace.ts` and the "card" / "sealed pack" sections of `src/styles/rewards.css` change when the
designs arrive; no page needs to.

## Card

- **Ratio 5:7.** Shown at 200 × 280 px on desktop and 140 × 196 px on phones. Design at 500 × 700 (or 2×: 1000 × 1400).
- Corner radius 16 px at 200 px wide (8% of the width).
- Two faces, flipped in 3D around the vertical axis:
  - **Back (cover):** one design for every card. Shown face-down before a reveal.
  - **Front:** per card, with the slots below.
- A **fact overlay** covers the front when the student taps a revealed card (dark panel, label "Did you know?" in the
  rarity colour, then the fact text). Design it as a state of the front.

### Front slots (`data-slot` in the DOM)

| Slot | Content | Example |
| --- | --- | --- |
| `set` | Set name, top left, small caps | ELEMENTS |
| `rarity` | Rarity name, top right, in the rarity colour | RARE |
| `art` | The illustration, middle, about 60% of the height | Today: the symbol in large text |
| `title` | Card name | Sodium |
| `subtitle` | Symbol, formula, unit or Latin name | Na · NaCl · kg/m³ · *Homo sapiens* |

Subtitles can be long (`C₅₅H₇₂O₅N₄Mg`, `∫ₐᵇ f′(x) dx = f(b) − f(a)`), so the subtitle area must wrap.

### Hooks available to the styles

Every card element carries `data-rarity`, `data-subject` and `data-set`, so a design can vary by any of them
(for example a frame per subject, a background per set, a border per rarity).

| Rarity | Placeholder colour |
| --- | --- |
| common | `#9aa6bd` |
| rare | `#4ea1ff` |
| epic | `#b06cff` |
| legendary | `#ffc44d` |

Subjects: `chemistry`, `physics`, `mathematics`, `biology`. Sets: `elements`, `compounds`,
`fundamental-quantities`, `derived-quantities`, `symbols`, `powers`, `formulas`, `cells`, `systems`, `nomenclature`.

### States to design

- Face-down, face-down **charging** (just before a flip: the edge glows in the rarity colour), face-up.
- **Foil** (bought with shards): an extra sheen layer over the front.
- **New** and **+N shards** tags sit just outside the top-right corner.
- A small caption under the card for guarantees ("Mastery guarantee").
- **Locked** (in the collection, Phase 3): an empty outline showing only the title.

## Sealed pack

- Ratio 5:7, shown at 220 × 308 px on the opening screen (170 × 238 on phones), 72 × 100 in the "pack earned" notice
  and 46 × 64 in the packs list. It must read at the smallest size.
- Three tiers via `data-tier`: `standard` (violet), `mastery` (gold), `weekly` (cyan).
- A label slot shows the card count.

## Tone

The cards should feel like a science collection, not a casino: clear type, real data, calm backgrounds. Rarity is
shown by the frame and a glow, never by flashing.
