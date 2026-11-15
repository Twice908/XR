# MMAXR Lab

MMAXR Lab is a VR-based formative assessment system for understanding how
learners develop and revise STEM concepts. It assesses process and formation,
not just the final product, and is designed to remain domain-agnostic.

This workspace brings together the project scaffolds and early prototypes for
the system's shared contracts, clients, backend, AI services, analysis, and
local infrastructure. See each project's README for its detailed interfaces,
open questions, and current implementation status.

## Architecture

The system is organized into five layers:

1. **Hardware** — immersive displays, tracking, and input.
2. **Client** — WebXR as the primary experience, with a native OpenXR client
   planned for Phase 2.
3. **Telemetry** — xAPI assessment events plus separate 30 Hz sensor CSV.
4. **Storage** — SQL Learning Record Store for xAPI and MinIO-compatible object
   storage for sensor data and audio; these responsibilities stay separate.
5. **Analysis** — deterministic rubric evaluation and instructor-facing
   evidence review.

### Lesson pattern

The intended assessment flow is:

**prediction gate → action → observation → anomaly injection → revision →
spatial voice explain-back → transfer probe**

The transfer probe uses a new variant without a reference sheet. The rubric
focuses on prediction discipline, retrieval effort, revision quality, causal
coherence, metacognitive calibration, and transfer.

### Data flow

```text
WebXR client ─┐
              ├─ xAPI events ─> mmaxr-platform ─> SQL LRS ─> mmaxr-analysis
OpenXR client ┘
      │
      ├─ 30 Hz sensor CSV ─> sensor-stream ─> MinIO-compatible object storage
      ├─ explain-back audio ─> object-store ─> MinIO-compatible object storage
      └─ voice channel ─> mmaxr-ai

mmaxr-contracts defines shared event, rubric, telemetry, and simulation
contracts consumed across clients and services.
```

Raw sensor streams and audio are not embedded in xAPI. The instructor
dashboard reads analysis results, trace evidence, process-pattern flags, and
authorized audio; it does not call the LLM or calculate rubric scores.

## Project map

| Project | Responsibility | Current direction |
|---|---|---|
| [`mmaxr-contracts/`](./mmaxr-contracts/README.md) | Shared xAPI verbs, payload types, rubric dimensions, sensor CSV and session manifest contracts; simulation interface and Unity JSON Schema mirrors. | Contract source of truth; package and module README scaffolds. |
| [`mmaxr-webxr-client/`](./mmaxr-webxr-client/README.md) | Primary Three.js/WebXR client with scene, interaction, telemetry, coach, recording, and session concerns. | Early client prototype and module scaffolding; target 72 FPS on standalone headsets. |
| [`mmaxr-openxr-client/`](./mmaxr-openxr-client/README.md) | Native Unity/OpenXR client, including eye/gaze dwell. | Deferred to Phase 2; folder and README scaffolding only. |
| [`mmaxr-platform/`](./mmaxr-platform/README.md) | Independent session-auth, xAPI-emitter, sensor-stream, LRS, and object-store services. | Service contract scaffolds; LRS and object storage remain separate. |
| [`mmaxr-ai/`](./mmaxr-ai/README.md) | Voice-only AI coach, post-session follow-up generator, and reusable deterministic guardrails. | Service/package scaffolds; guardrails are intended to be code-based, not prompt-only. |
| [`mmaxr-analysis/`](./mmaxr-analysis/README.md) | Deterministic rubric engine and read-only instructor dashboard. | Service/app scaffolds and early prototype work; each rubric dimension is intended to be independently testable. |
| [`mmaxr-infra/`](./mmaxr-infra/README.md) | Local Postgres, Redis, S3-compatible object storage, and SQL LRS dependencies. | Docker Compose local-pilot environment. |

The root `Hardware/`, `Client/`, `Telemetry/`, `Storage/`, and `Analysis/`
directories contain initial layer-level README notes that predate the
project-level decomposition above.

## Shared constraints

- Use pseudonymous identifiers only; do not put direct learner identifiers in
  shared events or storage keys.
- Keep analysis deterministic. Do not introduce ML or custom-trained models.
- Keep the system domain-agnostic; do not couple shared contracts or services
  to a curriculum, exam, syllabus, subject, or topic.
- Keep domain-specific simulation content behind the
  `mmaxr-contracts` domain-simulation interface.
- Keep xAPI events separate from raw sensor streams and audio.
- Keep the LRS separate from object storage.
- The AI coach is voice-only and must not state numerical values or canonical
  answers. Learner-facing generated output must pass through deterministic
  guardrails.
- No Kubernetes, message queue, or production cloud deployment is part of this
  local-pilot scaffold.

## Local development

### Prerequisites

- Node.js and pnpm for the TypeScript workspace and client packages.
- Docker Engine or Docker Desktop with Docker Compose v2 for local
  infrastructure.
- Unity 6.6+ and the documented XR packages only when beginning native OpenXR
  client work.

### Start local infrastructure

Follow [`mmaxr-infra/README.md`](./mmaxr-infra/README.md). In brief:

```sh
cd mmaxr-infra
cp .env.example .env
# Replace local placeholder credentials in .env.
./scripts/up.sh
```

This stack is **LOCAL PILOT ONLY**. Never reuse its credentials or procedures
for production. Keep `.env` files and real secrets out of version control.

### Install workspace dependencies and run the simulation pilot

From the workspace root:

```sh
pnpm install
pnpm run test:sim
```

The root pnpm workspace includes TypeScript packages under `mmaxr-contracts`
and selected services and apps. Use package-level README instructions for
package-specific development workflows. For the WebXR client, see
[`mmaxr-webxr-client/README.md`](./mmaxr-webxr-client/README.md); for Unity
schema sync and plugin setup, see
[`mmaxr-openxr-client/README.md`](./mmaxr-openxr-client/README.md).

## Contract and change management

`mmaxr-contracts` is the canonical source for shared event and rubric
definitions. Unity consumes the JSON Schema files under
`mmaxr-contracts/packages/schema/unity/`; do not recreate those schema types in
the native client.

Any breaking shared contract change requires a version bump and advance
notification to all six other MMAXR projects that consume the contracts.
Changing published infrastructure ports or shared environment variable names
is also a breaking change and requires coordinated downstream updates.

## Implementation status

This repository contains architecture and module documentation, local
infrastructure configuration, workspace/package setup, and early prototype
files. It is not a production-ready system. Consult each project README before
relying on a module or interface; open questions and implementation status are
tracked at those project boundaries.
