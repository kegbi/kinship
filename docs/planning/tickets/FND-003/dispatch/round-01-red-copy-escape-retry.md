# FND-003 source-locked copy-escape RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/3df52433-b10d-4b0f-be4c-70be4d0be960`\
Ticket revision: 12\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`ee180e148fc7db42550d6821b03cb9e98ec8f840` preserves the rejected revision-11
oracle at SHA-256
`a5752cbd3bbc80f8db48564de91ca136dd450bf0117841e875a3859cd5b1e035`. Its formal
six-lens review returned zero findings, but independent mutation finding
`FND-003-REV11-001` proved that a discarded `chunk.slice()` or
`new Uint8Array(chunk)` inserted before the N+1 invariant would evade the
runtime acquisition counter while every existing control still passed. The
commit has no GREEN authority or evidence log. Preserve every prior attempt
byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-copy-escape-retry.log`. No
production, manifest, lock, graph, report, provenance, packet, state, prior
evidence, main merge, rebase, push, deploy, or integration write is authorized.

## Strict inner RED

Begin from the exact committed revision-11 oracle. First add only the narrow
controls for the missing copy-escape proof. The controls must fail specifically
because the complete transform callback is not yet source-locked and mutations
that insert a discarded owned copy before the limit guard are not rejected. The
existing eight control suites must continue to pass, and the failure must not
arise from syntax, type, permission, fixture, network, Docker, package manager,
or environment state. Record this targeted inner RED before changing the
transform implementation or adding its source lock.

## Exact source-locked transform boundary

Place the complete validator-authored compressed/decompressed transform callback
inside exactly one uniquely marked source region. No validator helper that can
see the chunk may sit outside that region; the only allowed chunk consumers are
the injected hash update and downstream enqueue operations after the preflight
invariant. Read the executing source through `import.meta.url`, require exactly
one start marker and one end marker in the correct order, and compare the exact
region bytes to a reviewed SHA-256 constant stored outside the region. Fail
closed on a missing, duplicate, reordered, or changed region.

Add table-driven mutation controls that alter a valid reviewed region by
inserting each of these before the invariant and prove every mutation is
rejected: `.slice()`, `new Uint8Array(chunk)`, `Uint8Array.from`, spread or
array materialization, `structuredClone`, a copied alias, and computed-property
access to a copy primitive. The actual executing region must be checked, not
only an in-memory positive fixture. Any future callback change intentionally
requires a new RED, updated reviewed digest, and fresh review.

Retain independent runtime spies. At exact N, the hash spy and stalled sink must
receive the exact source object identity and no owned-acquisition capability may
run. At N+1, the preflight invariant must reject before hashing, forwarding, or
any validator-owned acquisition, and causal upstream cancellation must be
acknowledged with zero hash calls and zero writes. If an owned-copy operation is
ever introduced, it may be reachable only through an injected counted
`ownedAcquire` capability and must remain forbidden by the reviewed source
region for this transform.

This proof is deliberately bounded to reviewed validator-authored JavaScript. It
makes no claim about V8/native stream or crypto queue copies, garbage
collection, hostile-code heap noninterference, or whole-process memory. Do not
substitute Uint8Array monkeypatching, subclass traps, elapsed time, GC
observation, or a permissive source-name search for the exact region proof.

## Preserve every prior discriminator

Keep the opaque decoded-accumulator lease boundary, retained-child revocation,
simultaneous original-error preservation, raw Node/OCI pre-projection shape
checks, exact descriptor-metadata and normalized-claim use sets, causal
cancellation, no-wall-clock check, captured official provenance, exact lock and
manifest binding, lifecycle/OCI controls, exclusions, report synchronization,
and every earlier negative case unchanged in strength.

## Freeze condition

The focused command must have all controls passing and one repository assertion
failing only for the same six absent GREEN artifacts. Direct checks, exact 100
percent line/branch/function coverage without ignores, root gates, both schema
majors, and the schema-v2 checkpoint must pass. A fresh clean-context six-lens
review and an independent mutation audit must both return zero findings against
the same exact test SHA before an evidence log or GREEN authority exists.
