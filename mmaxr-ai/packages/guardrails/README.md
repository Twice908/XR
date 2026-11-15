# Guardrails

## Purpose

Define a reusable, deterministic answer-leak filter for learner-facing
generated text.

## Responsibilities

- Detect numerical patterns and canonical-answer text in generated output.
- Block or rewrite matching output before it reaches a learner.
- Provide a zero-runtime-dependency TypeScript package usable by `ai-coach` and
  `followup-generator`.
- Keep filtering behavior rule- and pattern-based, not prompt-only or
  model-based.

## Interface Contract

- Accept candidate output text and return a deterministic allow, block, or
  rewrite result.
- Cover numeric formats, number words, units, and configured canonical-answer
  blocklist content.
- Expose stable TypeScript types for filter input and result.
- Do not call an LLM, perform network I/O, or define domain-specific answer
  content in shared logic.

## Dependencies

- Zero runtime dependencies.
- `ai-coach` as the required real-time consumer.
- `followup-generator` as a reusable consumer.
- Domain-specific canonical-answer blocklist configuration, kept outside the
  shared generic rules.

## Tech Stack

- TypeScript — portable, typed package surface for Node.js services.
- Pure pattern/rule logic and blocklist — deterministic filtering with no LLM
  dependency.

## Open Questions

- How will canonical-answer blocklists be scoped and supplied without coupling
  shared logic to a curriculum or topic?
- Which output formats must be normalized before pattern checks?
- What is the fallback behavior when output cannot be safely rewritten?
- How will false-positive and false-negative behavior be measured and reviewed?

## Status: NOT IMPLEMENTED
