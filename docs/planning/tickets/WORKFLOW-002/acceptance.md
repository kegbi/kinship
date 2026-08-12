# WORKFLOW-002 acceptance

Accepted candidate: `d04b88851d202facafe4fcba495cdae24462cc92`\
Approved review: `reviews/round-01.json`\
Accepted by: `WORKFLOW-002/orchestrator/r0/df585d88-eade-43bb-8845-7a7d6a3c3e17`

## Independent post-review checks

- Focused regression: exit 0; 7 passed, 0 failed in 32s.
- `deno task fmt:check`: exit 0; 153 files checked.
- `deno task lint`: exit 0; 25 files checked.
- `deno task check`: exit 0; all three declared entry points passed.
- `deno task test:workflow`: exit 0; exactly 194 passed, 0 failed in 7m48s.
- `deno task test:workflow:coverage`: exit 0; exactly 194 passed, 0 failed in
  7m3s, and the detailed 100% threshold passed.
- `ticket_contract.ts`: branch 100.0%, function 100.0%, line 100.0% (2482/2482).
- `validate_ticket.ts`: branch 100.0%, function 100.0%, line 100.0% (1309/1309).
- `deno task ticket:validate docs/planning/tickets/WORKFLOW-002`: exit 0 before
  acceptance; `{"ok":true,"issues":[]}`.
- Candidate ancestry, exact allowed-write scope, ticket-only post-candidate
  changes, clean committed metadata, no ticket-tree reparse/link component, and
  the frozen regression SHA-256
  `8a433e183b9091994a747cf4d3dd0fd69152c21f34258a59180e5dfb91e4e71e` all passed
  controller verification.

## Acceptance criteria

- AC-01: the 101-unrelated-path ready fixture reaches the intended
  `ready_base_scope_violation`; the ticket-to-outside ready rename remains
  rejected.
- AC-02: 101 unrelated post-candidate paths reach `metadata_scope_violation`,
  101 unrelated integrated paths validate, and both ordinary later ticket
  mutation and integrated ticket-to-outside rename remain rejected as integrated
  metadata mutation.
- AC-03: exactly 101 relevant paths and 99 records producing more than 10,000
  streamed bytes remain strictly rejected with `git_output_limit`.
- AC-04: the intrinsic absent-root-tree fixture proves its bogus commit and
  missing tree, observes exact scoped Git diff exit greater than 1, and maps the
  broken relation to the strict Git-error diagnostic without deleting an object
  file.
- AC-05: dirty metadata, ancestry/content, accepted-phase, rename/copy, durable
  mutation, exact test-discovery, and coverage controls remain strict; the
  candidate has exactly 194 workflow tests with zero failures and exact 100%
  branch/function/line coverage for both validator production files.

## Integration result

Not integrated. Per ticket scope, no `integration.md` was created and no merge,
rebase, cherry-pick, push, deployment, or main integration was performed.
