# FND-003 no-queued-copy RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/9a3dbcf9-8103-4905-bded-98d58a8137ae`\
Ticket revision: 11\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`113ab729802d72c3a28ac6f358a0ba53f0e16cf1` preserves the rejected revision-10
oracle at SHA-256
`d8df10815975497ec6165f42a3e06a769c84dcae20937b6ffef1a8b06a52ef45`. Review
finding `FND-003-REV10-001` proved that it copied a chunk before the N+1 check
and declared a successful chunk lease released while that copy remained in the
downstream queue. The independent audit also proved that metadata-only
descriptor access could satisfy `assertAllUsed` without consuming the normalized
official-byte claim. The commit has no GREEN authority or evidence log. Preserve
every prior attempt byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-no-queued-copy-retry.log`.
No production, manifest, lock, graph, report, provenance, packet, state, prior
evidence, main merge, rebase, push, deploy, or integration write is authorized.

## Do not create a queued validator-owned copy

For compressed and decompressed transform chunks, check
`chunk.byteLength <= maximum - accepted` before copying, allocating, acquiring a
lease, hashing, or forwarding. Hash the source/native chunk and forward that
same source/native chunk; do not call `slice`, construct another full
`Uint8Array`, or otherwise create a validator-owned compressed/decompressed
copy. The source reader and native stream queues remain outside the asserted
validator-owned lifetime, as already disclosed by the packet. Exact N succeeds.
N+1 rejects and cancels upstream with zero validator-owned acquisition/copy for
the rejected chunk.

Remove compressed/decompressed lease claims when the validator creates no such
owned copy. The external lease factory continues to own the decoded accumulator
capability for the complete descriptor scope. Its control-facing probe must be
opaque: it may retain/release a child capability and inspect kind/identity, but
must not expose the raw string or bytes to the observer. A retained-child mutant
must still reject, revoke the child, stop before descriptor two, and preserve a
simultaneous original parse/normalization failure.

JavaScript cannot revoke an arbitrary primitive or byte copy after hostile code
has already obtained the value. This oracle therefore claims only the reviewed
validator implementation's owned representations and opaque capabilities; it
does not claim adversarial heap noninterference, V8 garbage collection, or
native queue accounting. Enforce the boundary structurally: the decoded raw
value is available only to the scoped loader operation that appends and
normalizes it, never to observer callbacks, authority accessors, or retained
claims. Retain review of the actual source as part of the fresh six-lens audit.

Add a deterministic stalled-downstream control proving no copied
compressed/decompressed lease exists to release early, plus an N+1 acquisition
counter proving rejection occurs before any owned representation is created.
Keep causal cancellation acknowledgements and the no-wall-clock static check.

## Bind metadata use and claim use independently

Track two exact sets for each provenance ID: descriptor metadata use and
normalized content-claim use. `descriptor(id)` marks only metadata; each typed
normalized accessor marks only content. `assertAllUsed()` requires both sets to
equal the complete descriptor ID set. Add three controls: metadata-only access
fails content use, claim-only access fails metadata use, and the real validation
path consumes both for every retained response. Loading or normalizing bytes
must mark neither set.

Preserve the raw Node and OCI key checks before projection, every normalized
claim field, unused-extra-evidence rejection, one repository ingestion, exact
source/hash identities, and all earlier discriminators.

## Freeze condition

Every earlier exact-timestamp, captured-provenance, pnpm emitted-shape,
provenance-closure, lifecycle, OCI, Deno, report, aggregate-ingestion,
raw-shape, focused-RED, exclusion, and follow-on requirement remains in force.
The focused command must still have all controls passing and one repository
assertion failing only for the same six absent GREEN artifacts. Direct checks,
exact 100 percent coverage without ignores, root gates, both schema majors, and
the schema-v2 checkpoint must pass. A fresh clean-context review must return
zero findings before an evidence log or GREEN authority exists.
