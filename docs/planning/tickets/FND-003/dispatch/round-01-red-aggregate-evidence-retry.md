# FND-003 aggregate-evidence RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/ef5066c4-5382-417e-be52-56aad4174cbe`\
Ticket revision: 9\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`91c4cd0528cc29f70461c0283ec55fbfac9c8c10` preserves the rejected revision-8
oracle at SHA-256
`e7d9dd57f7d5f24aa3d9be1f35afb0b9802d29f455388a0027fcd40a719814af`. Fresh review
finding `FND-003-REV8-001` proved that its isolated allocator controls do not
certify the aggregate retained-evidence path. The commit has no GREEN authority
or evidence log. Preserve every prior attempt byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-aggregate-evidence-retry.log`.
No production, manifest, lock, graph, report, provenance, packet, state, prior
evidence, main merge, rebase, push, deploy, or integration write is authorized.

## Test the complete ingestion boundary

Replace the helper-only memory claim with a deterministic control that exercises
the same descriptor loop and evidence-ingestion path used by repository
validation. The control must include multiple sequential compressed descriptors,
one descriptor at the exact compressed and decompressed limits, and both N+1
cases. It must observe allocation, cancellation, active raw representation, and
release events across the whole path rather than infer them from `readBounded`
alone.

The control must fail the preserved revision-8 design specifically because that
design can retain the full compressed backing while allocating the full
decompressed backing, create a decoded copy while decompressed bytes remain
live, and accumulate decoded bodies for every descriptor. A passing helper test
or garbage-collector assumption is not evidence of the required lifetime.

## Bound aggregate retained evidence

Stream compressed input through an incremental SHA-256 calculation and bounded
decompression so a complete compressed backing is not retained alongside the
complete decompressed representation. At most one descriptor may have an active
raw/decompressed representation. Decode and parse it within that descriptor's
scope, normalize only the authoritative claim data needed by later validators,
then release the compressed, decompressed, and decoded raw representations
before advancing to the next descriptor.

Do not retain a `Map` of complete response strings or bytes. Do not solve the
finding by increasing limits, weakening exact retained-byte derivation, reading
an artifact repeatedly without a measured bound, depending on garbage
collection, or excluding large valid full npm packuments. Exact compressed and
decompressed N boundaries remain accepted; N+1 must cancel and reject before an
additional full representation is allocated or retained. The implementation and
control may truthfully describe one validator-owned bounded active backing plus
transient runtime chunks; they must not claim a whole-process peak that Deno's
native stream internals cannot measure.

Retained normalized authority must preserve every existing bidirectional proof:
full stable-version enumeration, publication and retrieval causality, selected
and newer manifest ranges/integrities, Deno and pnpm edge identity, lifecycle
scripts, Node LTS selection, immutable shadcn imports, OCI descriptor identity,
unused-evidence rejection, and canonical redacted report construction. Add a
negative proving that discarding a raw body cannot silently discard a later
required claim.

## Freeze condition

Every earlier exact-timestamp, captured-provenance, pnpm emitted-shape,
provenance-closure, lifecycle, OCI, Deno, report, focused-RED, exclusion, and
follow-on requirement remains in force. The focused command must still have one
passing controls test and one repository assertion failing only for the same six
absent GREEN artifacts. Direct checks, exact 100 percent coverage without
ignores, root gates, both schema majors, and the schema-v2 checkpoint must pass.
A fresh clean-context review must return zero findings before an evidence log or
GREEN authority exists.
