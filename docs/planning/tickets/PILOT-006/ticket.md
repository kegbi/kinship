# PILOT-006: Canonicalize persistent desktop provenance

Status: ready\
Owner: trusted top-level orchestrator\
Base revision: `6c6ea8313f0472c315079a605c50cd2548d2835b`\
Execution class: `ordinary`\
Depends on: none

## Outcome

Persistent desktop pilot integration records canonically identify one top-level
ticket task, distinguish controller-issued role runs, and use privacy-safe
stable worktree aliases with deterministic sharing semantics.

## Scope and acceptance

`ticket.json` is authoritative. The canonical tests live under the bounded
`tools/workflows/pilot006/` directory, allowing a later review finding to
receive a new frozen RED test without mutating earlier evidence. `AC-01`
requires task discovery, exact policy semantics, and candidate-bound clean
coverage evidence.

The complete write scope, exclusions, task definitions, contract references, and
risks are recorded in `ticket.json`. Blocked PILOT-004 and PILOT-005 content is
not a dependency and must not be cherry-picked.
