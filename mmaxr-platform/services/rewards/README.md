# rewards

Card packs, the card collection, weekly Learning Rings and personal bests. Port **3009**, served at `/rewards/*`
by the gateway. Uses the same Postgres as the other services and creates its own tables on start.

The design follows three rules: one **completion engine** (the rings), one **reward engine** (card packs with
variable rarity) and one **competence engine** (rubric scores, personal bests and mastery levels). Packs are earned
only by finishing labs and are never sold.

## How a pack is earned

1. The student finishes a lab. The client sends `submit_analysis` to the xapi-emitter as usual.
2. The client calls `POST /rewards/sessions/:sessionId/claim` with the student's user-auth token.
3. The service checks the xAPI log: the session must belong to the caller and contain `submit_analysis`.
   Sessions left early (`leave_lab`) get `409`. This is the same rule the instructor dashboard uses.
4. It asks the rubric engine for the score (`GET /internal/score/:sessionId`, internal key), rolls the pack on
   the server and stores it in one transaction. Claiming again returns the same pack.
5. The client calls `POST /rewards/packs/:id/open` to reveal the cards one slot at a time.

### Roll rules (`src/roll.ts`)

| Rule | Value |
| --- | --- |
| Cards per pack | 3 (+1 on the first completion of a lab) |
| Base odds | Common 70%, Rare 22%, Epic 7%, Legendary 1% |
| Mastery guarantee | Score ≥ 90% → at least one Rare or better |
| Pity timer | 10th pack without an Epic or better → one guaranteed |
| Lab bias | Cards tied to the lab ×3, cards from the lab's subject ×2 |
| Duplicates | Become shards: 1 / 2 / 5 / 10 by rarity |
| Foil upgrade | 5 / 10 / 20 / 40 shards by rarity |

Randomness comes from `crypto.randomInt`. A score the rubric engine cannot produce still earns a standard pack.

## Learning Rings (`src/rings.ts`)

Weekly, Monday to Sunday in the school's time zone (`RING_UTC_OFFSET_MINUTES`, default 330 for India).

| Ring | Counts | Default goal |
| --- | --- | --- |
| Explore | Active minutes in labs (gaps over 2 minutes are idle and do not count) | 60 |
| Master | Different labs finished at ≥ the mastery score (default 80%) | 2 |
| Complete | Different labs finished | 3 |

Students choose Light (×0.5), Standard or Stretch (×1.5). Instructors set the base goals. Repeating one lab
counts once a week. Closing all three rings awards one bonus pack for that week. Rings are rebuilt from the xAPI
log on every read; `ring_weeks` is only a cache.

## API

Student routes need a student token; instructor routes need an instructor token (both from user-auth).

| Route | Purpose |
| --- | --- |
| `POST /sessions/:sessionId/claim` | Award the pack for a completed session. 201 new, 200 already claimed, 409 left early or unfinished, 404 not yours |
| `GET /sessions/:sessionId/progress` | For the leave-lab popup: lab progress %, current rings, what finishing would earn, and a ready message |
| `GET /packs?unopened=true` | The student's packs |
| `POST /packs/:packId/open` | Cards in reveal order, with `isNew`, `guaranteed` and `shardsAwarded` |
| `GET /collection?subject=&set=` | Every card (locked ones show only their outline) and per-set progress |
| `GET /cards/:cardId` | One card |
| `POST /shards/upgrade` `{cardId}` | Make an owned card foil |
| `GET /rings/current?week=2026-W48` | The week's rings and any bonus pack |
| `PUT /rings/goal-level` `{level}` | `light`, `standard` or `stretch` |
| `GET /personal-bests` | Best score, fastest time, completions and mastery level (1-5) per lab |
| `GET /instructor/rings?week=` | Every student's rings, with students who finished nothing this week or last flagged `stalled` |
| `GET /instructor/students/:id/collection` | A student's collection |
| `GET`/`PUT /instructor/ring-goals` | The weekly goals |

Response types are in `@mmaxr/schema` (`ClaimPackResponse`, `OpenPackResponse`, `CollectionResponse`,
`RingsResponse`, `SessionProgressResponse`, `PersonalBest`).

## Card catalog (`src/catalog/`)

263 cards in ten sets. Chemistry: all 118 elements and compounds. Physics: the 7 SI base quantities and
derived quantities. Mathematics: symbols, powers and formulas. Biology: cells, body systems and nomenclature.
Each card has its data, a fun fact and a one-tap question built from other cards in its set. Cards list the
lessons that make them more likely. Change cards in the TypeScript files and bump `CATALOG_VERSION`; the
database copy (`card_catalog`) is refreshed on the next start.

## Tables

`card_catalog`, `pack_awards` (unique per session and per ring week), `pack_cards`, `student_cards`,
`student_reward_state` (pity counter, shards, goal level), `ring_goals`, `ring_weeks`, `personal_bests`,
`rewards_meta`. It reads `xapi_events` but never writes to it.

## Environment

`DATABASE_URL`, `JWT_SECRET` (same as user-auth), `INTERNAL_API_KEY` (same as lesson-loader and rubric-engine),
`RUBRIC_ENGINE_URL` (default `http://localhost:3002`), `LESSON_LOADER_URL` (default `http://localhost:3007`),
`RING_UTC_OFFSET_MINUTES`, `PORT` (default 3009).

## Tests

`pnpm --filter ./mmaxr-platform/services/rewards test`. The API tests run against PGlite (Postgres in-process),
so no database is needed.
