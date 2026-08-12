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
