# FND-003 Atlas exclusion amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 3\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0, and this amendment grants no production
write authority.

Atlas is not a predecessor dependency of FND-003 and must remain outside this
runtime graph. Do not add an Atlas package, binary, image, source snapshot,
comparator probe, manifest entry, or Deno/pnpm lock node. The exact graph
membership checks must reject such an insertion. If the graph or synchronized
report enumerates early exclusions, identify the Atlas migration runner as
DG-02-owned rather than as an FND-003 selected candidate.

The DG-02 dedicated-CLI comparison may reject Atlas from immutable official
source and documentation because its persistent revision table and documented
nontransactional connection-loss/manual-edit recovery conflict with accepted
hard requirements. That reasoning and any later executable comparator pin are
DG-02-local. FND-003 neither reproduces that comparison nor locks its tooling.

Preserve all other representation-retry requirements and prior failed-attempt
bytes unchanged.
