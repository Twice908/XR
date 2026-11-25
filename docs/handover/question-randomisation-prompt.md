# Hand-over prompt: question + data randomisation for every lab

Paste everything below the line into the Claude Code agent in VS Code (open the repo root `/Users/prajwalsinghrajput/Code/XR`, branch `chemistry`).

---

You are continuing work on MMAXR, an immersive science-lab platform that scores the student's learning *process* (predict -> act -> observe -> explain), not just answers. Read `README.md`, `deploy/DEPLOYMENT.md`, and `mmaxr-platform/services/lesson-loader/src/index.ts` first. Web client (`mmaxr-webxr-client`) must stay React-free (pure TS + Three.js). Do not commit models/GLBs or secrets (`deploy/.env` is git-ignored).

## Goal
Every lab must give each student a different, fair, *unguessable-by-sharing* set of questions and numeric data, deterministically scored on the server. Today this is uneven. Bring all 13 lessons to one standard.

## Current state (verified in repo)
Lesson contracts live in `mmaxr-platform/services/lesson-loader/data/*.json`; generators in `.../scripts/gen-*.py`; per-lab server logic in `.../src/{chemistry,metals,biology,optics,sound,motion,motionRoutes,reasoningRoutes,soundRoutes}.ts`; assignments are stored in Redis per session (`assignment:<sessionId>`, 24 h TTL) and served via `/internal/assignments/:sessionId` (answers never go to the client; `redact*` helpers strip them).

| Lesson (file) | type | Variants in contract? | Notes |
|---|---|---|---|
| matter-properties | science_matter_properties | yes | 5 variants/question via shared question engine |
| physics-motion | physics_mechanics_sandbox | yes | shared engine, gen-motion-variants.py |
| physics-magnetism | physics_electromagnetism | yes | shared engine, gen-magnetism.py |
| physics-electricity | physics_circuits | yes | gen-circuits.py |
| physics-fundamentals | physics_fundamentals_sandbox | yes | gen-fundamentals.py |
| simple-machines | physics_simple_machines | yes | gen-machines.py |
| physics-light | physics_optics | yes (small, 10 KB) | `optics.ts` draws values + shuffles order |
| physics-sound | physics_waves_sound | yes (small, 7 KB) | `sound.ts` |
| chemistry-101 | chemistry_indicators | **no** | randomises which solution is in which tube (`pickSolutions`) only |
| metals-101 | chemistry_metals | **no** | randomises sample pick (`pickMaterials`) only |
| biology-101 | biology_digestive_system | **no** | fixed stops/questions |
| biology-respiratory | biology_respiratory_system | **no** | fixed |
| physics-101 | physics_bohr | **no** | 0 KB stub |

## Tasks (do in this order; commit + run tests after each)
1. **Audit** all 13 labs and write `docs/handover/randomisation-audit.md`: per lab, what is random today (question wording, numeric values, option order, which sample/tube, answer position), what is fixed, and any answer leakage to the client (grep the web client and network responses for correct answers, `isCorrect`, expected values).
2. **One shared engine.** Extract/extend the existing variant machinery (the one used by motion/magnetism/matter) into a single module (e.g. `src/questionEngine.ts`) with: seeded RNG per (sessionId, lessonId) so a session is reproducible; deal N of M variants per question; shuffle option order and rebalance the correct-answer position; draw numeric parameters from declared ranges with *derived* correct answers (never hand-typed), rounding rules, and unit handling; physical plausibility guards (no negative mass, no degenerate ratios, distractors that are plausible misconceptions).
3. **No-repeat across attempts.** Store per-student history (Postgres, `DATABASE_URL`, table created idempotently like the other services) of variant ids served; prefer unseen variants on a retake; fall back gracefully when the pool is exhausted. Add a pool-size check: every question needs >= 5 variants, every numeric question >= 5 distinct value sets.
4. **Bring the 5 non-randomised labs up to standard:** build variant pools for chemistry-101, metals-101, biology-101, biology-respiratory (predictions, "what if?" transfer questions, explanation prompts), and decide with the user whether physics-101 (Bohr) is in scope. Reuse the generator-script pattern (`scripts/gen-*.py` emitting the contract JSON) so contracts stay reproducible.
5. **Server-side custody + scoring.** Keep answers server-side only; extend `redact*` so no variant field reveals the answer; scoring stays deterministic and driven by the stored assignment (rubric-engine / `scoring/*`). Voice/typed explanations keep the existing key-ideas coverage scoring.
6. **Tests.** Vitest: (a) determinism — same seed => same deal; (b) uniqueness — two sessions rarely identical; (c) answer-position balance over 1000 draws; (d) numeric answers match an independent recomputation; (e) no answer field in any client-visible payload; (f) no-repeat history behaviour. Run `pnpm test` and the three package type-checks.
7. **Dashboard.** Show the variant id served per question on the instructor session detail so teachers can compare like with like (`mmaxr-analysis/apps/instructor-dashboard`, see `lib/trace.ts` `describeEvent`).

## Rules
- After every change: commit, and keep the Claude worktree folder and the root folder at the same commit (merge into `chemistry`). Do not push to GitHub `main` unless the user asks.
- Never put real keys in git. Do not kill processes broadly (`pkill -f`); the user runs their own services.
- Deployed stack (do not break): backend is one Docker container on the user's laptop (`deploy/Dockerfile.single`, services bundled with esbuild — new code must bundle with `esbuild --platform=node --format=cjs`), Postgres + storage on Supabase, frontends on Cloudflare Pages. After backend changes, the user redeploys with `docker compose -f deploy/docker-compose.single.yml up -d --build` on the laptop; frontends via Cloudflare / `deploy/deploy-frontends.sh`.
- Ask the user before any destructive or outward-facing action.

Start with task 1 and show the audit table before building anything.
