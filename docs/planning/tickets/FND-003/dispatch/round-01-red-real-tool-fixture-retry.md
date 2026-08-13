# FND-003 real-tool fixture RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/d3852b3b-4f50-42d2-9390-c1b0f221eff0`\
Ticket revision: 14\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. Commit
`92b453cad1abfe322d0e0ed0a5dc5eb30bb3cca2` preserves the rejected revision-13
oracle at SHA-256
`9cee53dabfac2d9d6ebeef25ea33e9582b68689222000199d08fbef073576f33`. Its
canonical whole-source integrity proof and mechanical gates passed, but an exact
pnpm 11.21.0 and Deno 2.9.5 feasibility pass plus an independent review proved
four failing-valid rules. This commit has no GREEN authority or evidence log.
Preserve every prior attempt byte-for-byte.

This is a contained real-format correction, not a new oracle expansion. It
authorizes a fresh implementer to edit only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`;
- minimal immutable positive fixtures under
  `tools/runtime/FND-003/fixtures/real-tool/` generated in disposable
  directories by exact pnpm 11.21.0 and Deno 2.9.5; and
- only after controller-declared zero findings,
  `docs/planning/tickets/FND-003/evidence/round-01-red-real-tool-fixture-retry.log`.

No production manifest, root lock, graph, report, provenance, packet, state,
prior evidence, main merge, rebase, push, deploy, or integration write is
authorized.

## Strict inner RED from real outputs

Before changing validator policy, reproduce in OS-disposable directories one
bounded exact positive fixture from each actual tool:

1. pnpm 11.21.0 under Corepack 0.35.0, using the current compatible 26-root
   probe graph: the accepted 24 frontend/test/lint roots plus exact
   `@types/react` and `@types/react-dom`, `autoInstallPeers: false`, the
   existing strict age/build/architecture policy, and exact package-manager
   integrity;
2. Deno 2.9.5 using the seven backend roots, lock v5, empty `allowScripts`, and
   `DENO_NO_PACKAGE_JSON=1`.

The fixtures are format/compatibility evidence, not eventual GREEN selection
authority. Record exact tool versions and source SHA-256 in concise
machine-readable fixture metadata. Do not persist absolute paths, caches,
credentials, tokens, or mutable registry responses. A lossless full real lock is
permitted under the existing 2 MiB bound; a smaller byte-exact emitted slice
plus independently recorded whole-lock field/cardinality observation is
preferred when it discriminates the same four policies. The Deno fixture must
retain the real v5 fields and peer-qualified node forms used by this graph.

First add only controls that feed these real outputs through the repository
policy and reproduce the four intended failures below while every prior control
remains green. Failure must not arise from syntax, type, permission, network,
Docker, package-manager availability, or an invented fixture. Only after that
inner RED may policy implementation change.

## Four corrections only

1. Require `autoInstallPeers: false` in `pnpm-workspace.yaml` as well as
   `pnpm-lock.yaml`. pnpm 11.21.0 otherwise emits lock value `true` and frozen
   install rejects either mismatch with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Add
   removal and inversion negatives.
2. Add exact, age-selected `@types/react` and `@types/react-dom` to the pnpm
   direct/selected root set, package manifest, importer, artifact/provenance,
   and exact peer binding. With automatic peer installation disabled,
   `@astrojs/react@6.0.2` requires these roots. Add a negative removing either.
3. Accept both valid pnpm v9 cardinalities: one package may back one or multiple
   peer-qualified snapshots. Remove the production invariant requiring at least
   one 1:N base, while retain controls that parse and exactly bind a real 1:N
   case and reject missing, extra, or misbound snapshots. Do not hardcode
   package/snapshot counts or hashes.
4. Add `PNPM_CONFIG_CACHE_DIR: isolated:pnpm-cache` to both pnpm repeat-run
   records. It maps to one real disposable absolute directory at execution,
   starts empty for the networked run, and is reused warm only by the offline
   run. Retain isolated Corepack home and `--store-dir`; add removal and
   mismatched-cache negatives.

The exact 26-root feasibility probe produced a 274,998-byte pnpm v9 lock with
917 packages, 918 snapshots, one real 1:N base, both fsevents versions denied,
only esbuild executed, a zero-exit frozen strict-peer install, and unchanged
lock SHA. Counts and that hash are observations, never production invariants.

Do not add any other root, cache field, parser feature, package policy, behavior
claim, or acceptance surface in this retry. Preserve the whole-source digest,
every captured-provenance, lifecycle, OCI, lock, report, exclusion,
opaque-lease, raw-shape, and runtime-side-effect discriminator unchanged in
strength.

## Freeze condition

The real pnpm and Deno positive fixtures and all synthetic controls must pass.
The focused command must then have one repository assertion failing only for the
same six absent GREEN artifacts. Direct checks, byte-identical exact 100 percent
coverage without ignores, root gates, PostgreSQL 18.4 and 17.10, and the
schema-v2 checkpoint must pass. One fresh six-lens review and one independent
real-format/mutation audit must both return zero findings against the same exact
test and fixture hashes before the controller writes RED evidence or grants
GREEN authority.
