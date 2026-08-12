# AUTONOMY-001 rework dispatch, round 2

Candidate reviewed: `228b86898bc379e6e5615e79d17f425d93f3dd6c` Required next
state: RED

Controller run ID:
`AUTONOMY-001/orchestrator/r0/00000000-0000-4000-8000-000000000101` Implementer
run ID: `AUTONOMY-001/implementer/r2/b318daf3-6ea6-4576-9f4f-13000a53f7e9`
Execution class: `protected-config-maintenance`

Before any production, configuration, template, or protocol edit, add every
regression below. Run them together against the unchanged reviewed candidate,
then stop for the trusted controller to freeze one test/evidence-only RED
revision and the SHA-256 of every changed test file.

## Required findings

### AUTONOMY-001-R1-ARCH-001: authorize only protected write scope

- Severity/lens: P1 / architecture_contracts
- Location: `tools/workflows/ticket_contract.ts:981-986`
- Expected behavior: authorization paths exactly equal the protected subset of
  `allowedWrites`; ordinary writes remain governed only by `allowedWrites`.
- Observed behavior: the validator compares authorization against all writes.
- Reproduction: validate the canonical AUTONOMY-001 packet and observe
  `authorization_mismatch`.
- Impact: a valid mixed-path maintenance ticket cannot pass validation.
- Affected criterion: AC-02
- Contract reference: `docs/development/autonomous-delivery.md#ticket-packet`
- Required remediation: compare against the protected subset and reject missing,
  extra, duplicate, and ordinary authorization entries.
- Verification: one mixed-scope positive plus all four negative variants.
- Resolution status: open

### AUTONOMY-001-R1-SEC-002: bind complete legacy identity

- Severity/lens: P1 / security_privacy
- Location: `tools/workflows/ticket_contract.ts:2762-2765`
- Expected behavior: grandfathering includes each exact historical base SHA.
- Observed behavior: hashing replaces `baseRevision` with a sentinel.
- Reproduction: move the PILOT-002 base and matching bundle refs to existing
  commit `5cdf892a0669b25b447cf782e280530b66a6ed25`; validation accepts it.
- Impact: v1 authority can be replayed at an alternate base.
- Affected criterion: AC-03
- Contract reference: `docs/planning/tickets/AUTONOMY-001/contract.md`
- Required remediation: hash and pin the complete immutable identity.
- Verification: mutate the base and every authority-bearing field for both PILOT
  packets; exact historical packets alone remain accepted.
- Resolution status: open

### AUTONOMY-001-R1-TDD-003: reject trivial-success gate definitions

- Severity/lens: P1 / tests_tdd
- Location: `tools/workflows/validate_ticket.ts:223-225`
- Expected behavior: trivial eval commands cannot certify a required task.
- Observed behavior: only literal `deno eval true` is detected.
- Reproduction: `deno eval false` exits zero and evades the current predicate.
- Impact: a changed gate can self-report success without exercising behavior.
- Affected criterion: AC-04
- Contract reference: `docs/development/autonomous-delivery.md#command-truth`
- Required remediation: conservatively reject trivial eval-style definitions.
- Verification: table cases for false, empty/string/numeric expressions,
  `Deno.exit(0)`, and equivalents; a legitimate independently guarded task
  remains accepted.
- Resolution status: open

## Constraints preserved

- RED changes contain only a new regression test and ticket evidence.
- Round 2 starts from candidate `228b86898bc379e6e5615e79d17f425d93f3dd6c`.
- Existing frozen RED files remain byte-identical.
- Historical frozen RED Git blobs remain byte-identical. The controller permits
  the current synthetic schema-v1 fixture sources to migrate to schema version 2
  only where exact base binding makes dynamic v1 fixtures impossible; preserve
  every assertion and do not add a test-only legacy bypass.
- No production/configuration/documentation edit occurs before the controller
  freezes the round-2 RED revision.
