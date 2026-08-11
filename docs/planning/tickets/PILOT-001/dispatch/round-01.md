# PILOT-001 implementation dispatch, round 1

Bootstrap candidate reviewed: 9d4693e1335797f1ecf98c4515ddba8e2603d8fb Required
next state: RED Reviewer context: fresh, read-only; prior implementation context
was not shared

## Required changes

### WFR-001: Mandatory validator is unusable

- Severity/lens: P1 / tests_tdd and reliability
- Evidence: tools/workflows/validate_ticket.ts always exits 1,
  tools/workflows/ticket_contract.ts always returns not_implemented, and
  deno.json has no ticket:validate task.
- Impact/criterion: The workflow cannot validate any ticket; AC-01, AC-02,
  AC-03, and AC-06 fail.
- Required change: Implement the strict dependency-free validator, safe CLI,
  truthful tasks, and complete coverage.
- Required RED proof: Valid and invalid fixture tests must fail against the
  existing bootstrap result before either production file changes.

### WFR-002: Packet cannot express Definition of Ready

- Severity/lens: P1 / architecture_contracts
- Evidence: ticket.template.json omits outcome, dependencies, risks, unresolved
  decisions, and criterion-specific RED proofs; the Markdown template omits
  unresolved decisions.
- Impact/criterion: Markdown/JSON cannot agree and a blocked ticket can default
  to ready; AC-05 fails.
- Required change: Add these strict fields and make readiness validation reject
  dependency/decision gaps.
- Required RED proof: Static fixture tests fail against the current templates.

### WFR-003: RED evidence is not content-addressed

- Severity/lens: P1 / tests_tdd
- Evidence: result.template.json records only mutable paths/log text and final
  candidate revision, not an exact RED revision or test blob hashes.
- Impact/criterion: A test can be weakened or production changed before RED
  without detection; AC-04 fails.
- Required change: Record a test-only RED commit, SHA-256 test blob hashes,
  expected failure, and unchanged production list; enforce shape and candidate
  linkage.
- Required RED proof: Validator/template tests reject the current result shape.

### WFR-004: Review findings are not fully traceable

- Severity/lens: P2 / architecture_contracts and style_maintainability
- Evidence: reviewer.toml, review.template.json, and dispatch.template.md omit
  some of affected criterion, contract reference, expected/observed behavior,
  impact, remediation verification, and resolution status.
- Impact/criterion: A reviewer can follow its role and still return an invalid
  finding; AC-02 and AC-05 fail.
- Required change: Require and template every accepted finding field, plus notes
  for non-actionable observations.
- Required RED proof: Static contract tests fail against current role/template
  content and incomplete review fixtures.

### WFR-005: Append-only ledger has no template

- Severity/lens: P2 / reliability
- Evidence: state.template.json contains a mutable event but assets have no
  events.template.jsonl even though the delivery document requires it.
- Impact/criterion: New tickets cannot initialize the required audit history;
  AC-05 fails.
- Required change: Add a valid JSONL event template/schema guidance and check
  ledger/state agreement.
- Required RED proof: Template and bundle tests fail while the asset is absent.

## Constraints preserved

- No app or schema-bundle changes.
- No new dependency.
- The validator never grants Git/thread permissions or performs integration.
- All five findings remain open until a fresh reviewer approves their exact
  candidate and the orchestrator independently verifies it.
