# FND-003 exact-binding RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/b1cc356e-8360-41cf-a2ef-fe0b6d12fb70`\
Ticket revision: 8\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`9d66aa1a2f30186d5f23aaa084c1ac4fc8794725` preserves the rejected revision-7
oracle at SHA-256
`cd6e256a0c32d8de18fccf01c818c8c94d84d9a44614665369e73198d2a28016`. It has no
GREEN authority or evidence log. Preserve every attempt byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-exact-binding-retry.log`.
No production, manifest, lock, graph, report, provenance, packet, state, prior
evidence, main merge, rebase, push, deploy, or integration write is authorized.

## Preserve exact timestamp precision and causality

Parse UTC instants without `Date.parse` precision loss. Preserve and compare the
accepted one-to-nine fractional digits as seconds plus nanoseconds and require
canonical string equality where two events must be identical. The selection
instant must equal the exact latest retrieval instant, not merely the same
millisecond.

Every publication time, packument `modified` time, release timestamp, and other
claimed event contained in a retained response must be no later than that
response's `retrievedAt`, and every `retrievedAt` remains within the authorized
capture window. Add nanosecond-drift and future-publication/modified negatives.

## Derive stable-version completeness from the response

Do not use `dist-tags.latest` as the completeness boundary. From every full npm
packument, enumerate all semver-stable `versions` entries whose retained
publication time is no later than retrieval. The maximum of that set is the
observed latest stable identity; `dist-tags` is recorded and cross-checked but
cannot hide a higher stable version. Every stable version strictly above the
selected release through that maximum must receive the existing age and
counterfactual-compatibility evaluation. Add a higher-stable-version with stale
`latest` tag negative.

## Redact executable proof at ingestion

Do not retain arbitrary command stdout/stderr in the graph. Model each proof as
an allowlisted structured result: command identity, exact tool version or
expected status token, exit code, run ID, environment-policy fields, and hashes.
If raw output is captured externally, validate and redact it before graph
construction; secret-bearing, credential-like, query-token, or physical-path
text fails closed. The report must render an explicit safe projection, never
serialize the complete graph wholesale. Add token, Windows/POSIX path, and
drift-together proof-output/report negatives.

## Bind every Deno edge to retained manifests

Every npm node represented by `deno.lock`, including transitive nodes, must bind
to exact retained npm manifest bytes. Derive its required, optional, and
optional-peer dependency requests from those bytes and compare them
bidirectionally with the Deno v5 node's compressed dependency tokens and
resolved specifiers. Preserve Deno's documented peer/optional serialization
semantics rather than assuming all manifest fields become required lock edges.

Deleting, adding, moving, aliasing, or version-drifting an edge while changing
the graph and lock together must fail against the manifest. Add an exact
`kysely-postgres-js` peer/optional case and a real required/optional transitive
case.

## Bind pnpm dependency IDs to exact resolutions

For each importer or snapshot dependency/optional-dependency entry, parse the
exact resolved snapshot key, derive its base package key and exact version, and
require the graph dependency ID to identify that same package record. Nested
peer suffixes must not obscure the base identity. Adding a different version's
package/snapshot and retargeting only the resolution must fail. Apply the same
identity binding to peer contexts and transitive peer records.

## Accept the complete historical Node index truthfully

The lossless official Node index contains historical rows that legitimately omit
modern metadata such as npm, zlib, or openssl. Require the stable row identity
fields actually needed for selection and validate optional known fields when
present; do not fabricate absent values. Unknown observed fields still fail
closed unless the exact captured schema is deliberately extended.

Derive the newest LTS line from the full index, but require precise GitHub
release timestamps only for the selection-relevant newest-LTS rows needed to
prove the age boundary and newer interval—not every historical Node release. Add
representative old rows with absent fields to the positive and retain all
current/older/non-LTS/too-young negatives.

## Honor peak evidence-buffer bounds

Use a single bounded backing buffer or a truly streaming consumer for each
compressed and decompressed phase. Do not retain a complete chunk list and then
allocate a second complete joined buffer. A returned view may share the one
backing allocation. Instrument the injected reader/allocator in controls to
prove peak retained bytes at the exact 32 MiB and 64 MiB boundaries, plus N+1
cancellation/rejection. Transient implementation chunks must not be accumulated
alongside another full copy.

## Freeze condition

Every earlier captured-provenance, pnpm emitted-shape, provenance-closure,
lifecycle, OCI, Deno, report, focused-RED, and exclusion requirement remains in
force. The focused command still has one passing controls test and one
repository assertion failing only for the same six absent GREEN artifacts.
Direct checks, exact 100 percent coverage without ignores, root gates, both
schema majors, and schema-v2 checkpoint must pass. A fresh clean-context review
must return zero findings before an evidence log or GREEN authority exists.
