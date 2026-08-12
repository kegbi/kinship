# WORKFLOW-002 implementation dispatch, round 1

Input base: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Required next state: RED, then stop\
Controller run ID:
`WORKFLOW-002/orchestrator/r0/df585d88-eade-43bb-8845-7a7d6a3c3e17`\
Implementer run ID:
`WORKFLOW-002/implementer/r1/919d709d-0d0b-4ac2-8b0f-626e961bb4ff`\
Execution class: `ordinary`

Before any production edit, add the narrowest dedicated real-Git regression file
at `tools/workflows/scalable_git_evidence_regression_test.ts` and a concise
redacted `evidence/round-01-red.log`.

## RED-only assignment

- Build every fixture repository from scratch with explicit local identity. For
  the broken-object/error fixture, set automatic Git maintenance controls only
  in that fixture repository before creating the target object, prove the object
  is loose and readable, deliberately corrupt/remove it, then prove the intended
  Git relation is unreadable before invoking validator behavior. Never alter
  global, user, or system Git configuration.
- Add more than 100 unrelated changed paths to ready-scope and later
  accepted/integrated-history fixtures. Assert that validation reaches the
  intended relation/path diagnostic or valid result instead of
  `git_output_limit`.
- Add a more-than-100 relevant exact RED/candidate evidence fixture and assert
  the capped `git_output_limit` rejection remains.
- Produce actual streamed Git output beyond the byte budget in a real fixture
  and assert truncation remains a strict `git_output_limit` failure.
- Add ticket-to-outside rename controls for ready-scope rejection and integrated
  later-mutation detection. Retain copy-boundary, dirty metadata,
  ancestry/content, accepted-policy, and later-mutation controls when they are
  already covered by the existing workflow suite; add a focused control only
  where the new implementation could otherwise weaken the behavior.
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
