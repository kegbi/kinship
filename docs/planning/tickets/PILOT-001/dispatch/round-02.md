# PILOT-001 rework dispatch, round 2

Candidate reviewed: 43dfb1887e377ec2d3a20a795a74ef6567e28038\
Required next state: RED

Start from current branch HEAD. Use a fresh implementer context. For each
finding below, first add the smallest regression test that reproduces the false
acceptance, run it against the unchanged candidate, and stop after the focused
command fails for the intended assertion. Do not change production workflow
files until the trusted controller freezes that round-2 RED revision.

## Required changes

### PILOT-001-R1-001: Require lifecycle and review closure

- Severity/lens: P1 / bug_correctness
- Location: `tools/workflows/ticket_contract.ts` lifecycle validators
- Expected behavior: accepted evidence has a terminal matching ledger, a result,
  and an APPROVED exact-candidate fresh review.
- Observed behavior: empty lifecycle/review evidence can validate.
- Reproduction: use the empty-evidence and review-phase mutants from the review
  record.
- Impact: independent review can be bypassed.
- Affected criterion: AC-01, AC-02, WFR-001, WFR-004
- Contract reference: autonomous-delivery state machine and acceptance guard
- Required remediation: enforce phase-aware cardinality and every identity,
  revision, round, run, and terminal-event relationship.
- Verification: table-driven cross-record lifecycle regression tests.
- Resolution status: open

### PILOT-001-R1-002: Make records and review semantics strict

- Severity/lens: P1 / architecture_contracts
- Location: `tools/workflows/ticket_contract.ts` primitive, ticket, result,
  finding, and review validation; `result.template.json`
- Expected behavior: all required values and enums are typed, nonempty, unique
  where required, reference known criteria/contracts, and agree.
- Observed behavior: non-string revisions/hashes and contradictory review data
  can pass; the result template has a null dispatch path.
- Reproduction: use the malformed primitive and contradictory review mutants in
  the review record.
- Impact: meaningless evidence can pass strict validation.
- Affected criterion: AC-02, AC-04, AC-05, WFR-003, WFR-004
- Contract reference: autonomous-delivery ticket-files and review-contract
- Required remediation: validate primitives, enums, uniqueness, references, and
  the verdict/lens/finding matrix; repair the template.
- Verification: table-driven semantic mutant tests.
- Resolution status: open

### PILOT-001-R1-003: Bound referenced evidence

- Severity/lens: P2 / performance_reliability
- Location: `tools/workflows/validate_ticket.ts` reference loading
- Expected behavior: count, duplication, and aggregate I/O are bounded.
- Observed behavior: repeated refs cause repeated near-limit reads/parses.
- Reproduction: thousands of duplicate refs to one large result.
- Impact: corrupt input can exhaust CI/reviewer resources.
- Affected criterion: AC-03, WFR-001
- Contract reference: PILOT-001 risks
- Required remediation: reject duplicates and cap collections/aggregate bytes
  before reads.
- Verification: deterministic count/duplicate/aggregate-limit CLI tests.
- Resolution status: open

### PILOT-001-R1-004: Verify content addresses against Git

- Severity/lens: P1 / tests_tdd
- Location: workflow contract and CLI repository-evidence checks
- Expected behavior: revisions exist with valid ancestry, hashes match RED Git
  blobs, RED is test-only, and candidate writes remain in scope.
- Observed behavior: only hexadecimal shapes are checked.
- Reproduction: substitute nonexistent but well-shaped revisions and digests.
- Impact: TDD evidence can be fabricated.
- Affected criterion: AC-04, WFR-003
- Contract reference: autonomous-delivery content-addressed RED proof
- Required remediation: add bounded Git-object, ancestry, blob-hash, RED-diff,
  and candidate-scope verification at the CLI boundary.
- Verification: temporary-repository genuine/forged lineage tests.
- Resolution status: open

### PILOT-001-R1-005: Require evidence files and exact mappings

- Severity/lens: P1 / bug_correctness
- Location: workflow CLI ticket-directory loading
- Expected behavior: all referenced dispatch, log, result, review, event, and
  accepted-state artifacts safely exist and correspond to the expected round.
- Observed behavior: missing logs/dispatch and silently skipped invalid refs can
  validate.
- Reproduction: omit phase logs or give a wrong-prefix result ref.
- Impact: absent execution evidence can be represented as complete.
- Affected criterion: AC-01, AC-03, AC-04, WFR-001, WFR-005
- Contract reference: autonomous-delivery ticket-files and acceptance guard
- Required remediation: enforce safe, bounded existence and one-to-one mapping;
  require acceptance.md only for accepted/integrated phases.
- Verification: directory-level evidence mutation tests.
- Resolution status: open

## Constraints preserved

- Keep the dependency-free Deno implementation and the canonical schema bundle
  unchanged.
- Preserve deterministic, redacted diagnostics and exact 100 percent production
  workflow coverage.
- Do not broaden runtime permissions beyond the minimum Git/read/write/run
  access proved necessary by tests.
- Do not edit orchestrator-owned state, events, results, reviews, or acceptance
  records.
