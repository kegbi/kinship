# FND-003 oracle-audit retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/1128638a-a5d9-445c-916d-34b5e447aff2`\
Ticket revision: 5\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`eb64bd55aa86cfbc7237dc7bb5f9b5679d4bd0ee` preserves the rejected test-only
oracle at SHA-256
`f435f639c7985b095e02ac9a25111e80bd426e728017f9aae2962b0a8739d9b4`. That attempt
has no GREEN authority. Preserve it and every earlier failed attempt
byte-for-byte.

This dispatch authorizes a fresh implementer to change only
`tools/runtime/FND-003/runtime_graph_contract_test.ts` and, after every item
below passes, create
`docs/planning/tickets/FND-003/evidence/round-01-red-oracle-audit-retry.log`. No
manifest, lock, graph, report, or other production write is authorized.

## Preserve the existing repository configuration

The validator must accept the exact base `deno.json` compiler, format, lint, and
task configuration and require it to remain semantically unchanged. GREEN may
add only the exact imports, frozen lock, minimum-age, and empty allow-scripts
fields. It may not delete or rewrite existing tasks to fit a synthetic fixture.
The positive repository fixture must contain that real base shape, with a
focused negative for task or compiler-policy drift.

## Bind official selection and compatibility evidence

Model publication time and artifact integrity as distinct official evidence when
one endpoint does not prove both. npm publication times must bind an exact
packument observation and npm integrity/manifest data must bind the selected
version manifest or the same complete packument. Deno and Node release evidence
must identify exact official checksum content, not a mutable or human release
page mislabeled as a checksum. Each observation records its source identity,
content SHA-256, and observation timestamp.

For every selected npm root and every compatibility-critical transitive or peer
edge, record the exact manifest dependency/peer range and immutable manifest
evidence, then evaluate the selected resolution against that range. The bounded
positive uses a mutually compatible real version set. It must reject at least
the Astro-check/TypeScript, Astro integrations/Astro/React/type peers,
Kysely/Postgres.js dialect peers, Vitest/coverage, Base UI/React, and complete
ESLint/parser/plugin relations. In particular, do not pair
`eslint-plugin-astro@1.7.0` with `astro-eslint-parser@1.2.2` when the former's
manifest requires `^1.3.0`.

Selection completeness cannot be represented by a vacuous `newerReleases` array.
Bind the official latest stable identity observed at the cutoff. Require the
selected version to equal it or require every strictly newer stable release
through that identity to appear once with a strictly greater version, exact
publication time, boolean compatibility result, and evidence-backed exclusion.

The synthetic fixture may use deterministic fixture hashes and internally
consistent timestamps; it must not be presented as captured production evidence.
The real repository path and GREEN evidence must bind the actual official bytes.

## Parse real Deno v5 and pnpm v9 output losslessly

Deno npm and JSR leaf nodes may omit empty dependency arrays. Normalize only
documented absent optional fields. Compare npm and JSR dependencies,
optional-dependencies, integrity, and applicable platform fields in both
directions. Interpret dependency tokens exactly as Deno serializes them,
including already-qualified `jsr:` references; never infer every dependency's
kind from its parent node. Add separate JSR, optional-edge, and leaf-node
negatives.

The pnpm parser must accept actual pnpm 11 version-9 YAML forms without relying
on one hand-rendered quoting style. Compare exact root importer membership so an
extra importer dependency fails. Preserve and compare required dependencies and
optional dependencies as different sections. Bind every peer-suffixed snapshot
identity to the peer names and exact selected resolutions it encodes. Compare
package `os`, `cpu`, and other selected platform restrictions instead of
discarding them. Retain every cross-platform optional node pnpm writes and
derive all node, snapshot, edge, and target-closure membership dynamically; no
observed count or hash is a constant.

## Inventory lifecycle scripts exactly

Hook names and commands must come from exact resolved package manifests with
source hashes, not from self-consistent graph labels. `fsevents@2.3.3` exposes
an `install` hook, not `postinstall`; it may remain in the cross-platform lock
but `allowBuilds.fsevents` and every matching inventory decision are false. Deno
`allowScripts` remains `[]`. Only the exact selected esbuild install hook may be
true, and only if the clean proof later establishes it is required. The oracle
must accept and record that reviewed exception while rejecting any fsevents
approval, unknown owner, incorrect hook name/command, or unreviewed execution.
Repeat evidence records each actual allowed execution by owner, version,
command, run, and exit status rather than asserting an unconditional zero count.

## Preserve complete OCI index identity

Represent every top-level descriptor returned by each exact OCI index, not only
the two required architectures. Runnable descriptor identity includes OS,
architecture, optional variant, digest, media type, and size; this must permit
both PostgreSQL `linux/arm/v6` and `linux/arm/v7` without treating them as a
duplicate. Attestations remain separate and cannot satisfy a runnable platform.
The descriptor set must match the hashed registry response exactly and still
require runnable Linux amd64 and arm64 children.

Use exact registry paths: Docker Official Images such as Node and PostgreSQL use
the `library/` repository namespace, while Deno and MCR retain their actual
repositories. Add negatives for variant drift, omitted or extra descriptor,
wrong repository, platform-child-as-index, attestation-as-runnable, and
Playwright package/image version drift.

## Close the remaining required discriminators

Add explicit controls for mutable shadcn invocation and non-empty generated
payloads, extra pnpm importer roots, moving a dependency between required and
optional sections, platform-field drift, approving fsevents, and omitted or
misordered newer-release evidence. Every discriminator must fail for its
intended reason.

After correction, publish one stable hash for a fresh independent audit. Only
after zero findings may the implementer write the retry evidence log. The
focused command must still be exactly one passing controls test and one failing
repository assertion naming only the six absent GREEN artifacts. Direct format,
lint, type-check, exact 100 percent line/branch/function coverage, required root
gates, immutable-attempt hashes, and the canonical packet-validation checkpoint
must all be recorded truthfully.
