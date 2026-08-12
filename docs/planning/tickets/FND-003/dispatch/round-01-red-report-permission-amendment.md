# FND-003 synchronized report permission amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 3\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This controller-only amendment corrects the
focused command's read authority before the operative RED is frozen. It grants
no production-write authority.

AC-02 requires `docs/validation/runtime-graph-fnd003.md` to remain synchronized
with the machine graph. The prior focused command allowed the JSON graph but not
the Markdown report, so a truthful GREEN validator would fail with a permission
error after the initially absent inputs were created. Packet revision 3 adds the
report path to the exact read allowlist:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json,docs/validation/runtime-graph-fnd003.md tools/runtime/FND-003/runtime_graph_contract_test.ts
```

Use this revised command for RED, GREEN, REFACTOR, and controller acceptance.
The validator must read the report only after the six authoritative graph inputs
have been loaded, so RED still has exactly one repository assertion failure and
its missing list remains `.npmrc`, `deno.lock`, `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and the JSON graph. Once those inputs
exist, a missing or stale report must fail specifically.

The synchronized report must be bound deterministically to the graph, including
at least its graph SHA-256, selection timestamp and cutoff, selected IDs and
exact versions, OCI references, lifecycle policy and observed executions, repeat
commands and results, exclusions, proof-pending status, and follow-on lock-reuse
boundary. Add passing synthetic report coverage and focused missing and stale
report negatives. Preserve every prior failed-attempt byte and all other active
retry requirements.
