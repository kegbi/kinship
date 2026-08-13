# FND-003 captured-provenance RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/8889dbda-aef1-4c7a-b6b3-80d65cfec9f7`\
Ticket revision: 6\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`8c919812c54a402388bcc8e117d0fd9dac91ddf4` preserves the rejected audited oracle
at SHA-256 `cedecbc36562390bb467d2ec6cd82d3f671b7fe99a6e3a4919e25fc1d50117f1`.
It has no GREEN authority and no retry evidence log. Preserve it and every prior
attempt byte-for-byte.

This dispatch authorizes a fresh implementer to edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. After a fresh
independent audit returns zero findings, that implementer may add only
`docs/planning/tickets/FND-003/evidence/round-01-red-captured-provenance-retry.log`.
No manifest, lock, graph, report, provenance snapshot, or other production write
is authorized during RED.

## Official bytes are the evidence authority

The GREEN graph will reference lossless, locally compressed official response
bytes under `tools/runtime/FND-003/provenance/`. The focused command already
permits reads below `tools/runtime/FND-003`; initial RED must still stop first
on the same six absent graph inputs, before attempting provenance reads.

The validator must decompress, hash, and parse the retained bytes and derive
claims from them. A graph-authored URL, timestamp, digest-shaped string, or hash
of another graph field is never sufficient evidence. Synthetic controls use
small in-memory official-shaped response bodies and must prove that changing a
claim and its self-authored hash together still fails against the retained
bytes.

For npm packages, retain an exact official packument response containing the
published-time map, distribution tags, complete stable version interval, and
selected-version manifest/integrity. If a compact response omits any required
field, retain the full response. Recompute publication time, latest stable,
every strictly newer stable release through latest, selected integrity, exact
dependency/peer ranges, scripts, engines, platform fields, and exclusions from
those bytes. Capture source URL, response-content SHA-256, retrieval timestamp,
and local compressed-artifact SHA-256. Do the equivalent from exact official
release indexes/checksum files for Deno and Node and exact immutable source
responses for the shadcn Button/import closure.

The positive fixture may use deterministic synthetic bytes, but every value must
actually be derived from those bytes. Add drift-together, omitted-middle
release, obsolete-selected/latest-equal, mutable-source, wrong-publication-time,
wrong-integrity, wrong-manifest-range, and stale-response-hash negatives.

## Evaluate the exact observed npm ranges

The dependency-free range evaluator must correctly handle every syntax present
in the retained selected manifests, including OR clauses, whitespace
comparators, caret/tilde/wildcard forms, prerelease comparator bounds, and
scoped package names. It must test every alternative rather than throwing on an
earlier nonmatching prerelease clause. Unknown syntax fails closed.

The synthetic positive must use a genuinely compatible real version set. Do not
invent `^<selected-version>` ranges. In particular, the retained current
`eslint-plugin-react-hooks` range containing `^8.0.0-0 || ^9.0.0 || ...` must
accept the selected ESLint 9 release, while a retained Astro-check range must
reject a TypeScript release outside it. Every declared import/peer relation must
bind to the range parsed from retained manifest bytes.

## Separate pnpm packages, snapshots, and importers

Replace the one-node/one-package/one-snapshot abstraction. Model the pnpm v9
`packages` map and `snapshots` map as independent exact collections so one
package record may back multiple peer-qualified snapshots. Importers are a third
collection with separate dependencies, devDependencies, and optionalDependencies
maps. Package and snapshot records retain every emitted field relevant to
identity, resolution, peers, lifecycle, platform selection, and repeatability,
including omitted-versus-present empty values, engines, optional/dev flags,
transitive peers, OS, CPU, and libc.

Use a dependency-free, bounded structural YAML decoder for the pnpm 11 emitted
subset rather than line-position regexes. It must accept actual pnpm-emitted
quoted and unquoted scalars, CRLF/LF, nested peer suffixes, inline and block
empty maps, and supported scalar/list/map fields, while rejecting duplicate
keys, aliases/tags/merge keys, or other unsupported YAML constructs. Compare the
decoded lock and graph bidirectionally. Controls must include two peer-qualified
snapshots backed by one package, alternate valid emitted layouts, a package
`engines` field, snapshot `dev` and `optional` flags, separate required versus
optional edges, and platform `os`/`cpu`/`libc` fields.

## Complete Deno resolution binding

Bind every Deno v5 `specifiers` key and value, including transitive JSR/npm
requests, to the graph resolution—not only direct roots. Resolve bare,
version-qualified, unscoped alias, and scoped alias npm dependency tokens
exactly as Deno 2.9.5 emits them. JSR tokens remain source-qualified. Add a
transitive specifier-value drift control and a scoped alias fixture, while
retaining all prior omitted-leaf, optional, platform, scripts/bin, and JSR
dependency controls.

## Bind lifecycle decisions and executions end to end

Parse each selected/transitive package's exact scripts from retained manifest
bytes. Bind the manifest response hash through lock node, hook inventory,
`allowBuilds`, and execution records. Approval is only the exact matcher
`esbuild@<selected-exact-version>`; broad names and ranges are invalid. fsevents
remains exact `install: node-gyp rebuild` and denied. Deno remains empty.

Every recorded execution must match exact owner, version, hook name, command,
manifest hash, approved matcher, pnpm run ID, and zero exit status. An execution
under a Deno run, an unapproved owner/version, a wrong or floating version, a
missing required execution, an extra execution, or a hook omitted from retained
manifest bytes must fail.

## Parse retained OCI indexes

For each image, retain the exact raw registry index response. Recompute the OCI
index digest from those bytes, parse every top-level descriptor, and compare the
complete set bidirectionally with the graph. Descriptor identity includes media
type, digest, size, platform OS/architecture/optional variant, and annotations.
Classify Docker attestations from their actual unknown/unknown platform and
`vnd.docker.reference.*` annotations; MCR's exact set may contain none.

Adding/removing/relabeling a descriptor while updating graph-authored identity
or hash fields must fail against retained bytes. Also retain all prior wrong
repository/library namespace, variant, missing required platform,
child-as-index, attestation-as-runnable, and Playwright package/image mismatch
controls.

## Freeze condition

The exact focused command remains one passing controls test and one failing
repository assertion naming only `.npmrc`, `deno.lock`, `package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and
`docs/validation/runtime-graph-fnd003.json`. The validator remains dependency
free and production files remain unchanged during RED.

Before presenting a stable hash, pass direct format/lint/type checks, exact 100
percent line/branch/function coverage without ignores, required root gates, and
the schema-v2 packet checkpoint. A fresh clean-context reviewer must return zero
findings. Do not create the retry evidence log or begin GREEN until the
controller explicitly freezes the reviewed bytes and grants GREEN authority.
