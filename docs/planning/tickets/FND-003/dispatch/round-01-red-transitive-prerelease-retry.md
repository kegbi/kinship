# FND-003 transitive prerelease RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh controls-only implementer run ID:
`FND-003/implementer/r1/a71f9122-058d-43c7-8ea7-ebac8e437bf8`\
Ticket revision: 15\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0, and this is not a new lifecycle round or a
packet revision. The accepted RED commit is
`ed66255cc521481c3d5e271e1b80366a5d670011`; the production GREEN dispatch is
`7bca01d6db0680db3be5cd047987409adf13558b`. The accepted validator initially had
SHA-256 `f7c85100ebc0080dfd4a27c315acb1a440cb5fb2ed065f5feed57934cd1f9767`.

The successful GREEN acquisition and root artifacts remain deliberately
uncommitted and immutable during this controls-only retry. Their current exact
identities are:

- `.npmrc`: `3a951f66e7e0f3e2dd1832473a871357c4a507b51100636b73bcf6ff0dd78b6c`;
- `deno.json`:
  `7d9dfb8ef9d2faffecb6cc72758ecc8406815e2b5eb97bfa4a950afc26eb927c`;
- `deno.lock`:
  `8a39257b18ec8ff53acb693efe2969d8136284a0a8293517e43313e1fb7898c8`;
- `package.json`:
  `fffd7876558d0aece38e864dbcc51af03800384ac95247e747bab6efb895e5bb`;
- `pnpm-workspace.yaml`:
  `fd1d247e8d44d8e0f0d58cf6497c7642561019321c11a79d9b2adcb95fb59851`;
- `pnpm-lock.yaml`:
  `385fcd5c1e1ffbe7eebefbf62e3730a1f11773f43d1010f7a3c8a9a4d8f4ecf8`;
- intermediate retained-capture manifest:
  `bb76155f3d2b0b4c0ca970c3458b433b350b8af6d9b6457f5c5ac978a7e5d126`;
- retained provenance: 853 gzip files, 76,759,449 compressed bytes, aggregate
  file hash `2975ef1d751078e081c90799e1f343a672b108ecc7f75958be17b7910c86dc39`.

Selection remains fixed at `2026-08-12T23:12:47.294Z`, cutoff
`2026-08-09T23:12:47.294Z`, with Kysely `0.29.4` selected and `0.29.5` excluded
as younger than the cutoff.

## Exact bounded contradiction

The real pnpm 11.21.0 lock and retained official packuments contain these
legitimate required transitive identities:

- `@rolldown/pluginutils@1.0.0-rc.3`;
- `gensync@1.0.0-beta.2`;
- `get-tsconfig@5.0.0-beta.4`.

The frozen validator applies its stable-only `version()` parser to every pnpm
package row while also requiring exact equality with the complete real pnpm v9
lock. This rejects valid package-manager output. Stable-only policy remains
required for selected and direct package versions; it is not a truthful
restriction on transitive lock identities.

## Controls-only authority

The implementer may edit only
`tools/runtime/FND-003/runtime_graph_contract_test.ts`. It must not edit any
GREEN artifact, retained response, existing fixture, ticket metadata, dispatch,
state/event/result/review record, or evidence log during the initial control.

Add the narrowest failing-valid control derived from the exact current real
`pnpm-lock.yaml`. It must prove all of the following before any validator
implementation change:

1. every selected/direct package version remains an exact stable release;
2. the three exact transitive prerelease identities above are accepted as real
   pnpm package/snapshot identities;
3. exact full-lock equality, package identity/resolution binding, retained
   manifest integrity, peer and lifecycle checks remain in force; and
4. malformed transitive versions and prerelease selected/direct versions remain
   rejected.

Run a focused controls-only command with the current GREEN artifacts readable.
The new control must fail specifically because the legitimate transitive
prereleases are passed through the stable-only parser, while every pre-existing
control remains green. Production/capture hashes above must remain unchanged.
Stop and return the exact command, exit, assertion, test SHA-256, whole-source
digest, unchanged artifact hashes, and empty out-of-scope list. Do not implement
the correction, write evidence, run GREEN, commit, or mutate Git.

After the controller independently reproduces the inner RED, it will freeze and
persist the checkpoint and issue a separate fresh correction implementer. That
correction will be limited to applying stable-only validation to selected/direct
packages while allowing exact SemVer prerelease transitive lock identities. It
must not weaken lock equality, 72-hour selection, integrity, lifecycle, peer,
OCI, provenance, or report requirements. No other oracle work is authorized.
