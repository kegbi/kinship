# PILOT-001 rework dispatch, round 5

Candidate reviewed: `b300c0fcb276ce82c17555049b48702c4d2c6f61`\
Required next state: RED\
Reason for one-round extension: the fresh exact-candidate review found one
cross-round evidence-integrity blocker and one aggregate resource-bound defect.

Use a clean implementer context. Before changing production, add both
regressions below and run them together against the unchanged candidate. Stop
for a controller-created test-only RED commit with exact Git-blob SHA-256
digests. Do not rewrite any existing test or prior evidence.

## PILOT-001-R4-001 — preserve every RED test through the final candidate

- Severity/lens: P1 / tests_tdd and architecture_contracts
- Expected behavior: every frozen RED blob from every round exists unchanged in
  the final reviewed candidate.
- Observed behavior: round evidence is checked only against that round's
  intermediate candidate.
- Required regression: a real two-round Git fixture with unchanged, deleted,
  replaced, and `Deno.test.ignore`-weakened earlier RED tests in the final
  candidate.
- Required remediation: retain round lineage checks and additionally bind every
  frozen RED digest to the final state candidate.
- Affected criterion: AC-04
- Contract: `AGENTS.md#mandatory-change-method`

## PILOT-001-R4-002 — bound aggregate Git evidence work

- Severity/lens: P2 / performance_reliability
- Expected behavior: ticket-controlled Git work has deterministic aggregate
  reference, byte, and process bounds.
- Observed behavior: the one-megabyte cap applies independently to an unbounded
  number of round test blobs.
- Required regressions: exact boundary and over-limit cases for aggregate test
  references and combined RED/final-candidate blob bytes.
- Required remediation: validate a small aggregate test-reference limit before
  Git traversal and stop blob reads at a deterministic total byte budget with
  stable redacted diagnostics.
- Affected criterion: AC-03
- Contract: `docs/development/autonomous-delivery.md#ticket-packet`

## Orchestrator guard — validate pre-candidate phases

- Severity/lens: P1 / bug_correctness
- Expected behavior: `deno task ticket:validate <ticket-directory>` validates a
  clean committed `ready` packet whose candidate revision is correctly `null`.
- Observed behavior: filesystem validation casts the absent candidate to a Git
  argument and enters ancestry/metadata checks that apply only after a candidate
  exists.
- Required regression: a clean committed ready packet fixture with no candidate,
  plus a candidate-phase control.
- Required remediation: make Git evidence validation phase-aware, while still
  verifying repository identity, canonical paths, committed metadata, and the
  declared base revision.
- Affected criterion: AC-03
- Contract: `docs/development/autonomous-delivery.md#state-machine`

## Constraints

- All three gaps must be RED together before production changes.
- Preserve the one-megabyte per-file and ten-kilobyte generic-output limits.
- Stop consuming a blob when the remaining aggregate byte budget is exhausted.
- Do not edit prior frozen tests, ticket authority, state, events, results,
  reviews, agent configuration, skill files, or Git metadata.
- Restore exact 100% production line, branch, and function coverage.
