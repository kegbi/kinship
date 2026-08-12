# AUTONOMY-001 rework dispatch, round 3

Candidate reviewed: `38bcb75a32cce962030119834beab990ce034325` Required next
state: RED

Controller run ID:
`AUTONOMY-001/orchestrator/r0/00000000-0000-4000-8000-000000000101` Implementer
run ID: `AUTONOMY-001/implementer/r3/1b889252-9c19-4f70-ae26-7831f17a1b89`
Execution class: `protected-config-maintenance`

Before production edits, add all regressions below against the unchanged
reviewed candidate and stop for a controller-frozen test/evidence-only RED.

## Required findings

### AUTONOMY-001-R1-TDD-003: recognize eval after Deno global options

- Severity/lens: P1 / tests_tdd
- Location: `tools/workflows/validate_ticket.ts:223-225`
- Expected behavior: Deno eval gates remain forbidden when global options occur
  before the eval subcommand.
- Observed behavior: `deno --quiet eval false` exits zero and evades the current
  predicate.
- Affected criterion: AC-04
- Contract reference: `docs/development/autonomous-delivery.md`
- Required remediation: boundedly recognize eval after supported Deno global
  options without executing or generally shell-parsing task text.
- Verification: table cases for `--quiet`, `--config`, `--no-config`,
  `--unstable-*`, and combined option/value forms; legitimate `deno check`,
  `test`, and `run` tasks remain accepted.
- Resolution status: open

### AUTONOMY-001-R2-BUG-004: make legacy lookup own-property safe

- Severity/lens: P2 / bug_correctness
- Location: `tools/workflows/ticket_contract.ts:1014,2751-2754`
- Expected behavior: arbitrary string ticket IDs never throw from structural
  validation.
- Observed behavior: inherited names can resolve an inherited record member and
  cause a TypeError at `.has`.
- Affected criterion: AC-03
- Contract reference: `docs/planning/tickets/AUTONOMY-001/contract.md`
- Required remediation: use an own-property-safe lookup or `Map`.
- Verification: `toString`, `constructor`, `__proto__`, and other prototype
  names return deterministic diagnostics without a thrown exception.
- Resolution status: open

## Constraints preserved

- RED changes contain only one new regression test and round-3 evidence.
- Round 3 starts from candidate `38bcb75a32cce962030119834beab990ce034325`.
- Earlier frozen RED blobs remain byte-identical.
- No production/configuration/documentation edit occurs before the controller
  freezes the round-3 RED revision.
