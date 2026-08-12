# FND-003 production GREEN, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh GREEN implementer run ID:
`FND-003/implementer/r1/b4eb4550-0817-4ccc-b7b5-cf58ba87a013`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0 until one complete schema-v2 lifecycle
result is recorded. Commit `ed66255cc521481c3d5e271e1b80366a5d670011` freezes
the accepted RED oracle and its final evidence:

- validator SHA-256:
  `f7c85100ebc0080dfd4a27c315acb1a440cb5fb2ed065f5feed57934cd1f9767`;
- real-tool metadata SHA-256:
  `a4a5933ab397fcd65b6a2812297868644b8a14cd37b5fb723f0a6bdca27fb52b`;
- final RED evidence SHA-256:
  `01f492e6a8b57959bc556b1ef667337e816077192ccfd58933dffc83fc625fc9`;
- eleven controls pass, the repository assertion alone fails for the exact six
  missing GREEN artifacts, byte-identical coverage is 100 percent, every root
  gate and both PostgreSQL majors pass, and both fresh independent reviewers
  returned APPROVED with zero findings against those exact bytes.

The accepted validator, fixtures, ticket/state/events, prior dispatches, and RED
evidence are immutable during GREEN. Do not edit them. This dispatch confers
production-write authority only for:

- `.npmrc`;
- existing root `deno.json`, preserving every pre-existing key/value while
  adding only the validated dependency/lock policy;
- `deno.lock`;
- `package.json`;
- `pnpm-workspace.yaml`;
- `pnpm-lock.yaml`;
- `tools/runtime/FND-003/provenance/**` for bounded compressed lossless official
  responses named by the graph;
- `docs/validation/runtime-graph-fnd003.json`; and
- `docs/validation/runtime-graph-fnd003.md`.

Do not write apps, packages, empty workspaces, root tasks, test/e2e members,
Dockerfiles, Compose, production entry points, Better Auth, Atlas, Lefthook,
@axe-core/playwright, application/product catalogs, schema, migrations, other
ticket packets, .agents, .codex, .git, main, integration.md, or any unlisted
path. Do not commit; the controller owns the candidate commit.

## Fresh official selection

Take one fresh exact UTC selection timestamp immediately before resolving the
graph. Its cutoff is exactly 72 hours earlier. Retrieve and retain the complete
official responses required by the frozen validator, using only its canonical
credential-free URLs and content types. Do not reuse preparatory response bytes,
timestamps, or mutable tag assertions as selection authority.

For every required runtime/package, derive the newest compatible stable release
that was published no later than the cutoff. Derive every newer exclusion from
the retained official bytes. In particular, requery Kysely: `0.29.5` was
published at `2026-08-10T00:41:31.479Z` and crosses the floor at
`2026-08-13T00:41:31.479Z`; select it only if the actual selection timestamp is
at or after that instant and the retained manifests prove all accepted ranges.
Otherwise select the newest eligible compatible predecessor and record the
timestamp-only exclusion. Apply the same live derivation to every candidate; the
research snapshot and prompt are hints, not authority.

Reverify the exact five OCI tags live, retain the raw top-level index/list
bytes, recompute each digest and complete descriptor set, distinguish runnable
linux/amd64 and linux/arm64 children from unknown/unknown attestations, and fail
if a tag moved or any required platform is absent. Do not substitute a child
manifest digest for an index.

## Exact manifests and locks

Create only the root graph required by the validator:

- `package.json` with exact engine values, exact direct dependency/devDependency
  versions, and the exact Corepack pnpm descriptor including its reviewed sha512
  hex integrity;
- `.npmrc` containing only the fixed public registry configuration allowed by
  the validator, with no non-auth pnpm-11 policy or secret;
- `pnpm-workspace.yaml` with no empty scaffold members and the exact age,
  save-exact, peer, frozen-lock trust, supported-architecture, lifecycle-deny,
  `autoInstallPeers: false`, and exact `allowBuilds` policy required by the
  validator;
- a real pnpm 11 lockfile emitted from those exact inputs, including explicit
  `@types/react` and `@types/react-dom`, every transitive and platform-optional
  node, and no hardcoded cardinality assumption;
- existing `deno.json` preserved plus exact seven backend imports, lock v5
  frozen policy, 72-hour minimum age, and empty `allowScripts`; and
- one real root `deno.lock`, with every Deno command using
  `DENO_NO_PACKAGE_JSON=1`, no nested/successor lock.

Before declaring lifecycle policy, scan the exact locked tarball manifests.
Record every preinstall/install/postinstall. Approve only an exactly proven
required esbuild hook; explicitly deny every locked fsevents hook; fail rather
than silently approving another owner. Package and image Playwright versions
must match exactly. The immutable shadcn Button source identity and imports must
bind the Base UI/class-helper closure actually used by that source, without an
invented lucide import.

## Executable clean/offline proof

Use OS-disposable absolute directories and record only the frozen redacted
tokens expected by the graph. Capture exact Node, Corepack, pnpm, and Deno
identities. For pnpm, use Corepack 0.35.0 with `COREPACK_DEFAULT_TO_LATEST=0`,
signatures enabled, an isolated Corepack home, an empty isolated store, and an
empty isolated pnpm metadata cache. Run the networked frozen install, remove
only its disposable node_modules, then repeat offline with the same warm
store/cache. For Deno, use an empty isolated `DENO_DIR`,
`DENO_NO_PACKAGE_JSON=1`, clean/frozen resolution, then cached-only frozen
repeat. Hash both root locks before and after every step and require byte
identity. Record exact lifecycle execution and no startup installs. Do not
persist physical paths, secrets, tokens, registry auth, or unredacted output.

## Machine graph and report

Build `docs/validation/runtime-graph-fnd003.json` directly to the frozen schema
and make `runtime-graph-fnd003.md` the validator's exact canonical redacted
rendering. Every retained provenance descriptor must be referenced as both
metadata and a normalized official-byte claim; every graph claim must derive
from its exact response. Preserve all proof-pending follow-on declarations,
single-root-lock reuse, Better Auth/Atlas/axe/Lefthook exclusions, and
no-mutation successor contracts. Do not mark FND-003A/B/C/D behavior proven.

## GREEN and REFACTOR proof

The exact focused validator command must exit 0 with all twelve tests passing.
Run direct format/lint/check and byte-identical exact 100 percent coverage of
the unchanged frozen validator. Run the actual clean-cache and offline commands,
OCI inspection, hook inventory, lock-hash checks, root format/lint/check, and
PostgreSQL 18.4/17.10 matrix. The final worktree may contain only the authorized
GREEN paths; no cache, node_modules, temp path, or nested lock may remain.

Perform only behavior-neutral cleanup while those proofs stay green. Report the
fresh selection/cutoff timestamps, selected exact map and exclusion deltas,
Corepack descriptor, lock hashes, provenance descriptor count/hashes, lifecycle
inventory/execution, OCI indexes/children, every exact command/exit, final dirty
paths, and empty out-of-scope list. Then stop without commit, review artifact,
ticket lifecycle metadata, push, deploy, main merge, or integration. A fresh
independent six-lens candidate review follows.
