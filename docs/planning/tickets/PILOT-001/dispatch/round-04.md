# PILOT-001 rework dispatch, round 4

Candidate reviewed: `66d5d28e981e344f9dfecf68528b00d216ace182`\
Required next state: RED\
Reason for one-round extension: a fresh exact-candidate review found two new,
distinct evidence-integrity blockers after the prior maximum was reached.

Use a new clean implementer context. Before changing production, add both
regressions below and run them together against the unchanged candidate. Stop
for a controller-created test-only RED commit with exact Git-blob SHA-256
digests. Do not rewrite existing round-three tests or evidence.

## Required changes

### PILOT-001-R3-001 — hash complete permitted RED blobs

- Severity/lens: P1 / bug_correctness and performance_reliability
- Location: `tools/workflows/validate_ticket.ts`, `runGit` and
  `validateGitEvidence`
- Expected behavior: every declared RED blob up to `MAX_FILE_BYTES` is hashed
  completely; limited reads receive an accurate diagnostic.
- Observed behavior: the generic 10 KB Git-output cap truncates legitimate 23-89
  KB blobs and reports false `content_hash_mismatch` failures.
- Reproduction: `deno task ticket:validate
  docs/planning/tickets/PILOT-001`.
- Impact: the validator cannot validate its own canonical ticket packet.
- Affected criterion: AC-03
- Contract reference: `docs/development/autonomous-delivery.md`
- Required remediation: make the streaming Git reader accept a per-command hard
  limit derived from the already-validated blob size, check limited/success
  state before hashing, and retain the small generic cap for path/status output.
- Verification: valid and wrong-hash blobs above 10 KB, a near-1 MB valid blob,
  and a truly oversized rejection.
- Resolution status: open

### PILOT-001-R3-002 — retain the frozen RED tests in the candidate

- Severity/lens: P1 / tests_tdd
- Location: `tools/workflows/validate_ticket.ts`, RED blob and candidate checks
- Expected behavior: every declared test/check blob at `redRevision` exists
  unchanged at `candidateRevision`.
- Observed behavior: an allowed candidate may delete or replace the exact RED
  test while retaining valid historical RED evidence.
- Reproduction: create a genuine RED commit, delete or modify its declared test
  in the candidate, and keep the path within `allowedWrites`.
- Impact: a candidate can remove the regression that established RED and still
  manufacture compliant evidence.
- Affected criterion: AC-04
- Contract reference: `AGENTS.md#mandatory-change-method`
- Required remediation: compare the complete candidate blob with the frozen RED
  digest and reject missing or changed tests/checks.
- Verification: unchanged success plus candidate deletion, modification, and
  exclusion/skip regressions.
- Resolution status: open

## Constraints preserved

- Both regressions must be RED together before production changes.
- Do not weaken the 10 KB generic Git-output bound for status/path evidence.
- Blob reads remain bounded at the accepted one-megabyte file limit and stop
  during consumption, not after allocation.
- Preserve deterministic redacted diagnostics and exact 100% production line,
  branch, and function coverage.
- Do not edit orchestrator-owned state, events, results, reviews, acceptance,
  ticket authority, or Git metadata.
