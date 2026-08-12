# WORKFLOW-002 implementation dispatch, round 1

Input base: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Ticket revision: 3\
Required next state: RED, then stop\
Controller run ID:
`WORKFLOW-002/orchestrator/r0/df585d88-eade-43bb-8845-7a7d6a3c3e17`\
Implementer run ID:
`WORKFLOW-002/implementer/r1/986e94e3-88ed-48a8-908f-19fcbb00a6ab`\
Execution class: `ordinary`

Controller preflights superseded revision-1 and revision-2 dispatches before any
RED write or freeze. Revision 1 incorrectly required the argument-bearing
`ticket:validate` task. Revision 2 still specified loose-object deletion, which
is vulnerable to explicit/concurrent packing or alternates. The interrupted IDs
`WORKFLOW-002/implementer/r1/919d709d-0d0b-4ac2-8b0f-626e961bb4ff` and
`WORKFLOW-002/implementer/r1/a96228ab-f2ca-4200-bc68-18bc97d6e83d` are not
authorized to resume. This fresh execution owns round 1.

Before any production edit, add the narrowest dedicated real-Git regression file
at `tools/workflows/scalable_git_evidence_regression_test.ts` and a concise
redacted `evidence/round-01-red.log`.

## RED-only assignment

- Build every fixture repository from scratch with explicit local identity. For
  broken relation handling, derive a proven-absent OID using
  `git hash-object --stdin` without `-w`; assert `git cat-file -e` fails; create
  a syntactically valid bogus commit whose root `tree` header names that OID via
  `git hash-object -t commit -w --stdin --literally`; build the valid metadata
  HEAD using `git commit-tree` and `git update-ref`; assert the bogus commit
  exists, its named root tree remains absent, and the exact scoped
  `git diff --quiet ...` predicate exits greater than 1 before invoking the
  validator. Do not delete or modify any `.git/objects` path. Never alter
  global, user, or system Git configuration.
- Add exactly 101 unrelated changed paths separately to ready-scope,
  post-candidate, and integrated-history fixtures. Assert each reaches its
  intended semantic valid result or scoped diagnostic instead of
  `git_output_limit`.
- Add exactly 101 relevant exact RED/candidate evidence paths and assert the
  capped `git_output_limit` rejection remains.
- Produce actual streamed Git output above 10,000 bytes using fewer than 100
  records in a real fixture and assert truncation remains a strict
  `git_output_limit` failure.
- Add ticket-to-outside rename controls for ready-scope rejection and integrated
  later-mutation detection, plus ordinary later ticket mutation. Retain
  copy-boundary, dirty metadata, ancestry/content, accepted-policy, and
  later-mutation controls when already covered by the existing workflow suite;
  add a focused control only where the new implementation could otherwise weaken
  the behavior.
- Run exactly:

  ```text
  deno test --allow-read --allow-write --allow-run=deno,git tools/workflows/scalable_git_evidence_regression_test.ts
  ```

- RED controls must pass. The command may fail only because unchanged
  `validate_ticket.ts` globally enumerates unrelated paths for a boolean
  ready-scope or later-mutation decision. Fixture, permission, compilation,
  corruption-setup, timeout, or unrelated existing-suite failures do not count.
- Record the exact command, non-zero exit, passing controls, intended scalable
  assertion failures, and concise redacted output in
  `docs/planning/tickets/WORKFLOW-002/evidence/round-01-red.log`.
- Stop without committing. Do not edit `validate_ticket.ts`, an existing test,
  any task/contract, ticket authority/state, or any other file.

The trusted controller will independently reproduce RED, verify only the new
test/check path and RED log changed, freeze one test/check-only commit, and
record the exact SHA-256 digest before issuing the GREEN continuation.

## Preserved constraints

- Exact evidence enumeration remains capped; boolean checks alone move to
  no-output predicates scoped to the exact relevant relation/path.
- Git exit 0 means no difference, exit 1 means the relevant difference exists,
  and execution/output failure remains a strict diagnostic rather than a
  mutation result.
- Rename/copy, dirty metadata, ancestry/content, accepted-phase, and durable
  post-integration packet-mutation enforcement remain strict.
- No write outside the new regression file and WORKFLOW-002 RED evidence is
  authorized in RED. Blocked WORKFLOW-001 is not lineage and must not be
  inspected until after the controller freezes this ticket's fresh RED.

## Controller-issued GREEN continuation

The trusted controller independently reviewed the full regression source,
verified that the only RED paths were the dedicated test and RED log, and
reproduced the authoritative RED after rejecting one unformatted pre-freeze
attempt.

- Frozen RED revision: `d7a187ae1c2a311be265916121676914388d733e`
- Frozen test: `tools/workflows/scalable_git_evidence_regression_test.ts`
- Exact frozen test SHA-256:
  `8a433e183b9091994a747cf4d3dd0fd69152c21f34258a59180e5dfb91e4e71e`
- Controller formatting and focused lint: exit 0.
- Controller focused RED: exit 1 with exactly 7 tests, 4 passing controls, and
  only the ready, post-candidate, and integrated 101-unrelated-path scale
  assertions failing with the expected current `git_output_limit` results.
- Production files changed in RED: none.

Resume this same round and verify the frozen test digest before production work.
Preserve its bytes exactly. The blocked WORKFLOW-001 candidate may now be
inspected only through a read-only base-to-candidate diff as historical design
input. Do not merge, cherry-pick, rebase, check out, copy its packet/evidence,
or treat it as lineage.

### GREEN

Make the smallest change only in `tools/workflows/validate_ticket.ts`:

- Boolean ready-scope, post-candidate scope, and later integrated ticket
  mutation checks must use no-output Git predicates scoped to the exact revision
  relation and relevant path/complement, never global changed-path enumeration.
- Preserve exact changed-path enumeration and both its 100-path and 10,000-byte
  caps for RED/candidate evidence.
- Distinguish predicate exit 0 (no relevant difference), exit 1 (relevant
  difference), and exit greater than 1 or launch failure (strict existing Git
  error diagnostic). Do not map repository corruption to a semantic change.
- Preserve rename/copy, dirty metadata, ancestry/content, accepted-phase, and
  post-integration mutation enforcement. Do not change diagnostic paths, codes,
  or messages except where the frozen expected semantic result already names
  them.

Write the focused passing result to `evidence/round-01-green.log`.

### REFACTOR and candidate handoff

Refactor only after GREEN and only if it improves the bounded Git-query boundary
without new behavior. The only authorized production file is
`tools/workflows/validate_ticket.ts`; do not edit the frozen test, existing
tests, `ticket_contract.ts`, `deno.json`, task definitions, ticket authority, or
any other file.

Run and record:

```text
deno test --allow-read --allow-write --allow-run=deno,git tools/workflows/scalable_git_evidence_regression_test.ts
deno task fmt:check
deno task lint
deno task check
deno task test:workflow
deno task test:workflow:coverage
```

Record the exact discovered workflow test count and zero failures, plus the
exact branch/function/line coverage for `ticket_contract.ts` and
`validate_ticket.ts`, in `evidence/round-01-refactor.log`. Recompute the frozen
test digest after all commands and require an exact match. Stop without
committing and return exact commands/exits, changed paths, GREEN production
paths, refactor summary, test count, coverage table, and both issued IDs.
