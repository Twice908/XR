# mmaxr-analysis

Scaffold for deterministic assessment analysis and an instructor-facing
read-only dashboard. Documentation and folder structure only; no scoring or
application logic is implemented.

## Folder tree

```text
mmaxr-analysis/
├── services/
│   └── rubric-engine/
├── apps/
│   └── instructor-dashboard/
└── README.md
```

## Rubric dimension organization

The rubric engine will implement each dimension as an independent module with
one file per dimension:

- prediction discipline
- retrieval effort
- revision quality
- causal coherence
- metacognitive calibration
- transfer

Each dimension module will expose a pure, deterministic scoring function over
the normalized assessment evidence it needs. It must not read from a network,
database, clock, random source, or mutable global state. Keep shared evidence
normalization separate from dimension scoring. Scores must be unit-testable
with fixed inputs and expected outputs, with tests for missing, incomplete, and
conflicting evidence. No machine learning or learned scoring is used.

The initial language choice is Node.js/TypeScript: it aligns with the platform,
WebXR client, and shared `mmaxr-contracts` TypeScript types, reducing contract
drift at the HTTP boundary.

## Evidence-link contract

Every per-dimension result must include a score and one or more evidence
references that allow a human to audit the score against the source trace.
Each reference identifies the source type and the stable event ID (or sensor
record reference where required), with enough metadata to locate the source
through the authorized platform API. Evidence references must not embed
unnecessary raw sensor data or direct identifiers.

The rubric-engine response is deterministic for the same versioned rubric and
the same normalized evidence. The dashboard renders the score and its evidence
links; it does not calculate scores or call an LLM.

## Read-only dashboard boundary

The instructor dashboard consumes rubric-engine results, xAPI trace data from
`mmaxr-platform/lrs`, process-pattern flags from `mmaxr-analysis`, and audio
assets through object-store authorization. It presents a timeline, rubric
scores with evidence links, flags, and explain-back audio playback. It does not
call an LLM, grade learners, alter source records, or introduce
curriculum-specific assumptions.

Use pseudonymous identifiers only. Keep analysis deterministic and domain
agnostic.

## Status: NOT IMPLEMENTED
