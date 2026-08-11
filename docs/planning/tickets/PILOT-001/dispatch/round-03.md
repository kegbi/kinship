# PILOT-001 rework dispatch, round 3

Candidate reviewed: `81fb66070c510e053cc0d4524145f3f3020bd9d1`\
Required next state: RED\
This is the final allowed implementation round.

Use a new clean implementer context. Before any production, configuration,
template, or protocol edit, add every regression listed below and run the full
focused workflow command against the unchanged candidate. All regressions must
be present together in one failing test-only RED revision, with every changed
test/check path and SHA-256 recorded. A later prose log is not a substitute.

The complete evidence and reproduction for each item is in
`reviews/round-02.json`; the dispatch fields below are the implementer contract.

## Required changes

### PILOT-001-R2-001 — phase-aware acceptance guards

- Severity/lens: P1 / bug_correctness
- Location: `ticket_contract.ts` state/acceptance guards
- Expected behavior: review/rework are valid before acceptance closure.
- Observed behavior: acceptance-only candidate/finding/check guards run in all
  phases.
- Reproduction: validate metadata `9a8520b` in review phase.
- Impact: the workflow cannot validate its own state machine.
- Affected criterion: AC-03
- Contract reference: autonomous-delivery state machine
- Required remediation: one phase matrix governs phase-specific requirements.
- Verification: valid/invalid fixture for every phase.
- Resolution status: open

### PILOT-001-R2-002 — truthful per-round base lineage

- Severity/lens: P1 / architecture_contracts
- Location: result base and Git RED-scope validation
- Expected behavior: every round records its actual dispatch/base revision.
- Observed behavior: all results are forced to the original ticket base.
- Reproduction: round two began at `6e5a991`, not `9d4693e`.
- Impact: genuine multi-round RED proof is unrepresentable.
- Affected criterion: AC-04
- Contract reference: autonomous-delivery content-addressed RED proof
- Required remediation: validate a contiguous per-round base/RED/candidate
  chain.
- Verification: complete two/three-round temporary Git fixture.
- Resolution status: open

### PILOT-001-R2-003 — complete Git change and RED classification

- Severity/lens: P1 / tests_tdd
- Location: `validate_ticket.ts` changed paths and test classification
- Expected behavior: all change statuses are audited; production cannot be
  declared a test.
- Observed behavior: deletions are omitted and arbitrary declared paths are
  trusted.
- Reproduction: delete an out-of-scope file or list production as a RED test.
- Impact: production/out-of-scope changes can be hidden.
- Affected criterion: AC-04
- Contract reference: quality-gates test-first contract
- Required remediation: audit status/old/new paths and explicit test/check
  patterns.
- Verification: addition/modification/deletion/rename and false-test Git
  fixtures.
- Resolution status: open

### PILOT-001-R2-004 — freeze every regression before production

- Severity/lens: P1 / tests_tdd
- Location: round-three RED revision
- Expected behavior: all twelve dispatched regressions fail before production
  changes.
- Observed behavior: round two froze only its first regression.
- Reproduction: compare `ed596c6` and `81fb660`.
- Impact: most round-two fixes lacked content-addressed TDD proof.
- Affected criterion: AC-04
- Contract reference: AGENTS mandatory change method
- Required remediation: make all round-three tests RED together and stop for
  controller freeze.
- Verification: test-only RED diff, hashes, intended failures, no production
  path.
- Resolution status: open

### PILOT-001-R2-005 — transition-specific evidence mapping

- Severity/lens: P1 / bug_correctness
- Location: filesystem lifecycle evidence policy
- Expected behavior: from/to determines result, review, or acceptance evidence.
- Observed behavior: destination review/rework always maps to a review file.
- Reproduction: inspect events 5/10 against current mapping.
- Impact: truthful ledgers fail while incorrect fixtures pass.
- Affected criterion: AC-01
- Contract reference: autonomous-delivery transition guards
- Required remediation: share one full transition policy across
  validators/templates.
- Verification: complete multi-round transition matrix.
- Resolution status: open

### PILOT-001-R2-006 — not-applicable and waiver authority

- Severity/lens: P1 / architecture_contracts
- Location: review lens/finding schemas
- Expected behavior: N/A has agreement; waivers have
  authority/rationale/owner/expiry and exclusions.
- Observed behavior: bare N/A or waived status closes review.
- Reproduction: approve six N/A lenses or waive P0 security.
- Impact: substantive review can be bypassed.
- Affected criterion: AC-02
- Contract reference: autonomous-delivery review contract
- Required remediation: represent/validate agreement and conservative waiver
  policy.
- Verification: unsupported N/A, incomplete/expired/non-waivable waiver mutants.
- Resolution status: open

### PILOT-001-R2-007 — canonical contained evidence tree

- Severity/lens: P1 / security_privacy
- Location: ticket root and evidence reads
- Expected behavior: exact committed evidence under the canonical project ticket
  directory.
- Observed behavior: links, external repos, working-tree and untracked evidence
  are accepted.
- Reproduction: symlink a result/log or write evidence after an external
  candidate commit.
- Impact: external or forged evidence can satisfy acceptance.
- Affected criterion: AC-03, AC-04
- Contract reference: autonomous-delivery ticket files
- Required remediation: canonical root, no link components, clean committed
  evidence revision/ancestry.
- Verification: link/external/dirty/untracked/stale and valid committed
  fixtures.
- Resolution status: open

### PILOT-001-R2-008 — bound Git output before allocation

- Severity/lens: P2 / performance_reliability
- Location: `validate_ticket.ts` Git subprocess runner
- Expected behavior: output consumption stops at the hard cap.
- Observed behavior: output is fully buffered before the limit check.
- Reproduction: a diff with output materially above 10 KB.
- Impact: repository evidence can exhaust memory before rejection.
- Affected criterion: AC-03
- Contract reference: PILOT-001 risks
- Required remediation: bounded plumbing/streaming strategy with process
  termination.
- Verification: large-output Git fixture with deterministic bounded failure.
- Resolution status: open

### PILOT-001-R2-009 — one lifecycle policy

- Severity/lens: P3 / style_maintainability
- Location: structural/filesystem/Git lifecycle passes
- Expected behavior: one normalized typed transition/round/evidence policy.
- Observed behavior: duplicated policies diverge across large functions.
- Reproduction: trace phase/base/evidence handling in four passes.
- Impact: cross-pass defects survive nominal 100 percent coverage.
- Affected criterion: AC-02
- Contract reference: autonomous-delivery protocol
- Required remediation: normalize records and share policy tables/helpers.
- Verification: one matrix exercised through bundle and directory validation at
  100 percent coverage.
- Resolution status: open

### PILOT-001-R2-010 — commit and bind metadata evidence

- Severity/lens: P1 / tests_tdd
- Location: evidence-revision trust boundary
- Expected behavior: review/state/log/acceptance evidence is immutable and
  descended from candidate.
- Observed behavior: mutable/untracked working-tree evidence can pass.
- Reproduction: alter evidence after candidate creation.
- Impact: approval/gates can be forged after review.
- Affected criterion: AC-01, AC-04
- Contract reference: autonomous-delivery exact-candidate rule
- Required remediation: require committed clean ticket metadata and verify
  ancestry/scope.
- Verification: committed success plus dirty/untracked/stale/non-descendant
  failures.
- Resolution status: open

### PILOT-001-R2-011 — enforce round limits and transition revisions

- Severity/lens: P1 / bug_correctness
- Location: maxRounds/events/lifecycle binding
- Expected behavior: bounded contiguous rounds with exact
  actor/revision/result/review binding.
- Observed behavior: maxRounds is unused and unmatched event rounds/revisions
  skip checks.
- Reproduction: round two with maxRounds one, or arbitrary revision on unmatched
  round events.
- Impact: lifecycle provenance and stop limits can be bypassed.
- Affected criterion: AC-01, AC-02
- Contract reference: autonomous-delivery state machine
- Required remediation: enforce maximum, contiguity, and transition-specific
  equality.
- Verification: gap/overflow/stale/wrong-actor and valid three-round history.
- Resolution status: open

### PILOT-001-R2-012 — require passing review commands

- Severity/lens: P2 / architecture_contracts
- Location: review command evidence
- Expected behavior: APPROVED review records nonempty, unique, zero-exit
  commands.
- Observed behavior: empty commands and failed exits are accepted.
- Reproduction: approve with `[]` or exit code one.
- Impact: approval can omit successful verification.
- Affected criterion: AC-01, AC-02
- Contract reference: autonomous-delivery review contract
- Required remediation: enforce nonempty unique successful command evidence.
- Verification: empty/failed/duplicate/valid command mutants.
- Resolution status: open

## Constraints preserved

- No production/config/template/protocol changes before the full RED snapshot.
- Keep the implementation dependency-free and do not alter the canonical schema.
- Limit Git/read/write/run permissions to the proved minimum.
- Preserve deterministic redacted diagnostics and 100 percent production
  workflow line, branch, and function coverage.
- Do not edit orchestrator-owned state, events, results, reviews, acceptance, or
  Git metadata.
