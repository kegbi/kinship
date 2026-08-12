# FND-003 independent-lease RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/fe9b56ac-d226-42de-a3a0-1c74d236170d`\
Ticket revision: 10\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`53e9a1a61bb3cb8afbe1f750e89f1ed80dfbc40e` preserves the rejected revision-9
oracle at SHA-256
`be2a4d8a1e7da528db1e32a86342561c871791a80348d465a4b0412e9b1f4ab0`. Review
finding `FND-003-REV9-001` and an independent adversarial audit proved that its
cancellation assertion used a forbidden timer, its loader-authored events could
self-attest around a hidden raw accumulator, and its Node/OCI normalizers erased
unknown raw fields before validation. The commit has no GREEN authority or
evidence log. Preserve every prior attempt byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-independent-lease-retry.log`.
No production, manifest, lock, graph, report, provenance, packet, state, prior
evidence, main merge, rebase, push, deploy, or integration write is authorized.

## Remove wall-clock scheduling

Delete the cancellation-path `setTimeout` and make the focused oracle statically
reject `setTimeout`, `setInterval`, `Date.now`, `Temporal.Now`, and
`performance.now`. The instrumented source stream must expose an explicit
one-shot cancellation acknowledgement resolved by its `cancel()` callback. The
control awaits that causal acknowledgement, not elapsed time, event-loop delay,
or garbage collection. Preserve upstream cancellation on compressed and
decompressed N+1, hash, decode, parse, and normalizer failures.

## Make raw ownership independently observable

Loader-authored acquire/release notifications are diagnostics, not proof. Route
each validator-owned compressed, decompressed, and decoded raw representation
through an injected lease factory owned by the control. The control—not the
loader—tracks the live lease handles and fails if a second descriptor begins
while any prior raw lease remains active. A released handle must clear access to
its raw value synchronously and deterministically; later access fails. No claim
is made about V8 garbage collection or opaque native stream queues.

Add a deliberate accumulator mutant through the same ingestion boundary. It must
try to retain a raw lease/value across descriptor completion and must fail the
control even if loader-authored lifecycle events and the public authority
surface look correct. Also retain a passing multiple-descriptor path, exact
compressed/decompressed N paths, both N+1 paths, all error paths, a late
required claim, a dropped-late-claim negative, and nonvacuous unused-evidence
rejection. The test fixture's own immutable compressed input map is source data,
not a validator-owned ingested representation; the assertion must distinguish
those roles explicitly.

The repository loader may use the default lease factory, but it must be the same
scoped ingestion function exercised by the controls. Do not replace the finding
with a loader-authored boolean/event sequence, a source-code name check, an
increased limit, or a garbage-collector assumption. The retained authority must
contain freshly detached normalized claims only, and repository validation must
ingest once.

## Validate raw shape before projection

For official Node index rows and OCI index/descriptor objects, validate the raw
key set before selecting normalized fields. Historical Node rows may omit the
documented optional fields, but no unknown key may vanish silently. OCI index
and descriptor keys must likewise be exact for the accepted media types,
including optional `platform` and `annotations` only where the raw schema
permits them. Add drift-together negatives that insert an unknown raw Node row
field and an unknown raw OCI descriptor field, recompute the retained hashes and
graph where applicable, and require rejection before normalization. Preserve
lossless acceptance of the known optional historical and attestation fields.

## Freeze condition

Every earlier exact-timestamp, captured-provenance, pnpm emitted-shape,
provenance-closure, lifecycle, OCI, Deno, report, aggregate-ingestion,
focused-RED, exclusion, and follow-on requirement remains in force. The focused
command must still have all controls passing and one repository assertion
failing only for the same six absent GREEN artifacts. Direct checks, exact 100
percent coverage without ignores, root gates, both schema majors, and the
schema-v2 checkpoint must pass. A fresh clean-context review must return zero
findings before an evidence log or GREEN authority exists.
