# FND-003 provenance-closure RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/d6307562-c0be-4c23-aa26-f070678454cf`\
Ticket revision: 7\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`d6bd646046d2667625a7e3e4584132d78f0bbd42` preserves the rejected revision-6
oracle at SHA-256
`ad022fa9a9094cd99e9982fd301af0a676a73f9d49c2442af52f94292a21751e`. It has no
GREEN authority or evidence log. Preserve all prior attempts byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a controller-
declared zero-finding audit, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-provenance-closure-retry.log`.
No production, manifest, lock, graph, report, provenance, packet, state, or
prior evidence write is authorized during RED.

## Bounded valid official responses

The retained-response loader must accept measured complete official npm
packuments. Current full responses include TypeScript about 15.6 MB and Astro
and Playwright about 9.5 MB before compression; abbreviated registry responses
also exceed 2 MB. Apply explicit byte bounds, not a character count that rejects
valid input. Use a bounded streaming decompression/read path that aborts before
materializing more than 64 MiB decompressed or 32 MiB compressed per artifact,
and reject an artifact beyond either limit. Controls include a structurally
complete byte-size-equivalent response above 2 MB and compressed/decompressed
oversize negatives. The exact official response itself still supplies every
required field; filler never substitutes for missing metadata.

## Bidirectional peer identity

For every pnpm snapshot, derive required and optional peers from the exact
retained package manifest. Require every non-optional peer in the snapshot's
peer context and permit an omitted optional peer only when the manifest marks it
optional. Every encoded direct or nested peer name and exact resolution must map
to an existing package and appropriate snapshot; no extra peer is allowed.

Retain one package record with at least two real peer-qualified snapshot
contexts. Add negatives for an omitted required peer, nonexistent peer version,
extra peer, optionality drift, missing backing package/snapshot, and nested peer
resolution drift. Continue comparing importer, package, and snapshot collections
independently and losslessly.

## Derive newer-release compatibility

`compatible`, exclusion reason, and prose cannot be graph authority. For every
strictly newer stable npm version through the retained latest identity, build a
hypothetical graph that substitutes that version and re-evaluate every retained
required dependency and peer range in both directions. An age-eligible newer
release may be excluded only when a retained manifest constraint produces a
specific failing edge; record that machine-derived edge and range. If all
constraints pass, the selected older release is invalid. Age-ineligible releases
remain excluded solely from their retained publication timestamp.

This must catch reverse constraints such as an Astro-check peer excluding a
newer TypeScript and forward constraints such as a newer ESLint plugin requiring
an incompatible ESLint. Reject arbitrary incompatibility labels, missing
intermediate versions, and a graph/hash drift-together relabeling.

## Bind provenance exactly, safely, and temporally

Every provenance descriptor must be referenced by at least one validated claim,
and every validated claim must reference an existing descriptor. Descriptor IDs
and local artifact paths are unique; a byte artifact may be intentionally shared
by multiple claims only through the same descriptor ID. Reject unused or extra
descriptors.

Parse URLs and allowlist exact origins and path shapes by evidence kind. Reject
userinfo, query, fragment, non-HTTPS, mutable `latest` paths, and unapproved
origins before report rendering. Do not persist response headers or credentials.

All response retrievals must occur no later than `selection.selectedAt`, the
selection time must equal the latest retrieval timestamp, and every retrieval
must fall within the preceding 30-minute capture window. Publication age is
computed at that final selection instant. Add before-window, after-selection,
unused-descriptor, duplicate-path, userinfo, query, fragment, and origin/path
negatives.

## Enforce current Node LTS

Use the exact official Node release index containing the `lts` field. Select the
newest age-eligible stable entry on the newest LTS line present at the selection
instant; `lts` must be a non-empty codename, not `false`. A newer non-LTS
current release does not displace that choice. Add a current-LTS positive and
stable non-LTS, older-LTS-line, too-young-LTS, and graph/index drift negatives.

## Synchronize the human report completely

The deterministic Markdown report must expose every human-auditable AC-02 and
AC-05 claim, not merely IDs and versions. Include the selection/cutoff/capture
window; each selected version, publication time, integrity, latest stable/LTS
identity, newer-release outcome, and provenance artifact hash/source; every
dependency/peer/source relation with kind, exact range when applicable,
resolution, optionality, compatibility result, and manifest evidence; lifecycle
inventory/approvals/executions; complete OCI references and descriptor sets;
repeatability; exclusions; and follow-on status. It may embed one canonical
redacted JSON representation derived from the validated graph to avoid a second
lossy model.

The report must omit no required claim and must never include credentials,
query/fragment secrets, local physical paths, or raw unredacted response bodies.
Add representative omission/staleness and secret-bearing URL controls.

## Freeze condition

All revision-6 and pnpm emitted-shape requirements remain in force. The focused
command still has one passing controls test and one repository assertion failing
only for the six absent GREEN artifacts before provenance reads. Direct checks,
exact 100 percent line/branch/function coverage, root gates, schema matrix, and
schema-v2 checkpoint must pass. A fresh clean-context audit must return zero
findings before any evidence log or GREEN authority exists.
