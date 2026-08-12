# FND-002 implementation dispatch, round 1

Input base: `603f6621809f61fab70bc29b8b4a9252ebcecb27`\
Required next state: RED, then stop\
Controller run ID:
`FND-002/orchestrator/r0/a16b5b61-a6c8-4366-8752-d530fa3a6d74`\
Implementer run ID:
`FND-002/implementer/r1/e2edf3bf-a445-4fc2-8ba4-3fffb9681804`\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-002:1`

Before any architecture-contract or manifest edit, add the narrowest built-in
Deno deterministic check at
`tools/architecture/FND-002/coordination_contract_test.ts`.

## RED-only assignment

- Add an in-memory harness self-check that proves the check distinguishes a
  compliant module/event fixture from the competing identity-driven or missing
  governance edge shape. This self-check must pass.
- Add the repository-contract assertion covering AC-01 through AC-04 using only
  the four authorized architecture artifacts. It must fail against the unchanged
  contracts for the absent/contradictory approved boundary.
- Run exactly:

  ```text
  deno test --allow-read=docs/architecture tools/architecture/FND-002/coordination_contract_test.ts
  ```

- Record concise redacted output in
  `docs/planning/tickets/FND-002/evidence/round-01-red.log`, including the
  passing self-check, intended assertion failure, command, and non-zero exit.
- Stop. Do not edit an ADR, ADR index, backend contract, manifest, task
  definition, ticket authority/state, or any other file. Do not commit.

The trusted controller will reproduce RED, verify that the only changed paths
are the check and RED log, freeze one test/check-only revision, calculate the
exact check-file SHA-256, and issue a GREEN continuation to this same round.

## Preserved constraints

- The application remains unimplemented; the check must not connect to a
  database or claim rollback/postcondition proof.
- The coordinator is workspaces-owned and use-case-specific, identity is called
  only through its public facade, and governance handlers are registered at the
  composition root within the same explicitly owned transaction/session.
- No generic horizontal coordinator, private adapter import, direct cross-module
  table write, task/manifest schema expansion, or dependency choice is
  permitted.
- RED writes are limited to the exact check path and FND-002 RED evidence log.

## Controller-issued GREEN continuation

Controller audit status: authorized after the corrected RED freeze. The earlier
revision `d0ba91da166b6a651cf75fba399bdd39fe5c0fd1` was rejected before
authorization because its check file was not Deno-formatted; it is not the
ticket's RED revision.

- Frozen RED revision: `14e717a6fafe2f114806f29f4b728a096fbdccfd`
- Frozen check: `tools/architecture/FND-002/coordination_contract_test.ts`
- Exact frozen check SHA-256:
  `bdada13e04c6aeb240340bb9917ebcd8381831c3f33f5ff93a30dbdff5dccf6a`
- Controller reproduction:
  `deno fmt --check tools/architecture/FND-002/coordination_contract_test.ts`
  exited 0; the focused test command exited 1 with the in-memory discriminator
  passing and only AC-01 through AC-04 repository mismatches reported.

Resume this same round and verify the frozen revision, path, and digest before
editing a contract. Do not change the frozen check bytes.

Trusted-controller Git attestation: the controller verified that
`14e717a6fafe2f114806f29f4b728a096fbdccfd` exists as the corrected RED revision,
that continuation revision `f05f22c444e9e48d6877318e43dbe454afc65b81` descends
from it, and that the checkout was clean at that continuation revision. The only
path changed between those revisions was this ticket's `dispatch/round-01.md`.
The implementer must not inspect or mutate `.git`; matching the frozen file
digest above plus this controller attestation satisfies its GREEN prerequisite.

### GREEN

Make the smallest contract-only change that satisfies the frozen check:

- add accepted ADR 0004 at the exact authorized path and index it as accepted;
- add the use-case-specific transaction/coordination specialization to the
  backend architecture;
- in the existing manifest, retain `workspaces -> identity`, remove `workspaces`
  consumption of `identity.user-registered`, and add governance consumption of
  the existing `workspace.created` and `workspace.member-joined` events while
  retaining `identity.user-registered`;
- state explicitly that FND-002 records but does not implement or prove the
  application behavior and that protected walking-skeleton plus Slice 1
  executable proof remains required.

Do not add a task, dependency, schema field, generic coordinator, planning
status edit, or any other behavior. Write the focused passing result to
`evidence/round-01-green.log`.

### REFACTOR and handoff

Refactor documentation wording only if it improves clarity without new behavior.
Preserve the frozen check bytes. Run and record:

```text
deno test --allow-read=docs/architecture tools/architecture/FND-002/coordination_contract_test.ts
deno task fmt:check
deno task lint
deno task check
```

Write the affected-gate summary to `evidence/round-01-refactor.log`, then stop
without committing. Return all changed paths, commands/exits, the unchanged
check SHA-256, GREEN production paths, and refactor summary using the same
controller and implementer run IDs.

## Controller rejection and RED recovery

The attempted GREEN reached the focused passing state, but `deno task lint`
found three `no-regex-spaces` violations in the frozen check. No candidate was
formed. The controller therefore rejects
`14e717a6fafe2f114806f29f4b728a096fbdccfd` as the ticket's final RED anchor; the
failed attempt remains historical evidence and must not appear as `redRevision`
in the round result.

Restore RED before changing the check:

1. Remove only the uncommitted ADR 0004 and restore the other three architecture
   contract files to their pre-GREEN content. Do not use Git or touch any other
   path.
2. Verify the focused test is RED again for AC-01 through AC-04 and that the
   architecture changes are absent.
3. Make only the semantics-preserving lint correction in the check: replace the
   three regex literal runs rejected by `no-regex-spaces` with equivalent
   explicit quantifiers. Do not change expectations or accepted behavior.
4. Run the focused test again and observe the same intended RED with the
   in-memory discriminator passing.
5. Run formatting plus both focused and repository lint checks and require all
   of them to pass:

   ```text
   deno fmt --check tools/architecture/FND-002/coordination_contract_test.ts
   deno lint tools/architecture/FND-002/coordination_contract_test.ts
   deno task lint
   ```

6. Rewrite `evidence/round-01-red.log` as the authoritative pre-freeze RED log,
   retaining concise records of both rejected revisions/attempts and the failed
   GREEN gate. Mark the new check digest as pending controller calculation.
7. Rewrite the GREEN and REFACTOR logs to say that their prior contents were a
   controller-rejected, pre-candidate attempt and that authoritative GREEN and
   REFACTOR results are pending. Stop without committing.

RED-recovery writes are limited to the four uncommitted architecture files being
restored, the existing check, and the three FND-002 phase logs. The controller
will verify the architecture baseline, reproduce RED and lint, then freeze a new
test/check-only revision and digest before issuing a second GREEN continuation
for this same round.
