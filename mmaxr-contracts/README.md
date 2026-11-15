# mmaxr-contracts

Shared contract repository for the MMAXR Lab WebXR and Unity clients.

## Package layout

```text
mmaxr-contracts/
├── packages/
│   ├── schema/
│   │   ├── docs/
│   │   └── unity/
│   └── domain-simulation/
└── README.md
```

`packages/schema` is the canonical contract package. `packages/domain-simulation`
defines the stable, domain-swappable simulation boundary. Domain-specific
content, when introduced, belongs only behind that boundary.

## Contract-change policy

Any breaking contract change requires a version bump and advance notification to
all six other MMAXR projects that consume these contracts. The notification
must identify the affected contracts and the intended version before
downstream projects update. Non-breaking changes must also be communicated to
downstream consumers.

## Shared constraints

- Use pseudonymous identifiers only.
- Keep analysis deterministic; do not use machine learning or custom-trained
  models.
- Do not add Kubernetes infrastructure.
- Keep contracts domain-agnostic. Do not couple them to a curriculum, exam,
  syllabus, subject, or topic.
- Keep domain-specific definitions inside `packages/domain-simulation`, behind
  its stable interface.
- This repository defines contracts and structure only; it does not implement
  runtime logic.
