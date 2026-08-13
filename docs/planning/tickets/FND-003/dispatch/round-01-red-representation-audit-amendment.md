# FND-003 official-format audit amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 2\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

This controller amendment binds the completed read-only official-format audit to
the existing consolidated RED retry. It adds no production-write authority and
does not change lifecycle round or packet state.

The retry validator and complete synthetic positive graph must reflect these
verified representations:

- Corepack's exact descriptor is
  `pnpm@<version>+sha512.<128-lowercase-hex-characters>`. Corepack converts the
  npm registry's `sha512-<base64>` SRI into descriptor hex. These are distinct
  fields and encodings; a base64 descriptor fixture or prefix-only check is
  invalid.
- Corepack integrity proof records the exact descriptor and executable
  environment/command result with `COREPACK_DEFAULT_TO_LATEST=0` and integrity
  keys not disabled. A boolean alone cannot overclaim that registry signature
  verification ran.
- `deno.json` uses exact `npm:<package>@<version>` imports,
  `lock: { path: "./deno.lock", frozen: true }`,
  `minimumDependencyAge: "PT72H"`, and `allowScripts: []` or exact
  `npm:`-prefixed constraints. Deno and pnpm lifecycle policies are independent.
- Deno lockfile v5 is JSON with version `5`, specifiers, and npm/JSR resolution
  maps. npm integrity uses SRI; JSR integrity uses its real raw-hex form.
- pnpm 11 project `.npmrc` carries only truthful registry/auth-safe settings.
  Non-registry policy belongs in `pnpm-workspace.yaml`, including exact-save,
  strict minimum-age, lock trust, and build policy. Frozen behavior is proved by
  `--frozen-lockfile`, not an approximate preference.
- pnpm 11 removed `onlyBuiltDependencies`. The reviewed deny-by-default policy
  uses `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`, and an exact
  `allowBuilds` map for every discovered transitive hook owner, with `false` for
  denied hooks and `true` only when executable evidence proves an exception.
- pnpm 11 writes `pnpm-lock.yaml` with lockfile version `9.0` and `settings`,
  `importers`, `packages`, and `snapshots`. Direct root specifiers live under
  importer `.`, package nodes carry resolution integrity, snapshots carry
  dependency/peer edges, and the Corepack `packageManager` tool is not a pnpm
  dependency lock node.
- The graph separates selected/direct dependency records from complete Deno and
  pnpm lock-node evidence. Required peers and every exact transitive hook owner
  must be representable. Runtime Deno/Node evidence must use their actual
  release checksum/OCI forms rather than fabricated npm SRI.
- Repeatability evidence records exact identities, commands, exits, isolated
  cache/store state, clean-networked versus cached-only/offline mode, lock
  hashes, and zero lifecycle executions. Equal hashes alone are insufficient.
  Deno uses clean `deno ci` followed by a real frozen cached-only resolve; pnpm
  uses an isolated-store frozen install followed by node_modules removal and an
  offline frozen reinstall.

The retry must add focused negative discrimination for: base64 or short Corepack
descriptor hashes; disabled integrity keys; Deno script constraints without
`npm:`; policy misplaced in `.npmrc`; removed pnpm build-policy fields;
invented/flat lockfile models; missing peer, transitive node, or hook owner;
coupled Deno/pnpm allowlists; universal registry SRI; and repeat evidence that
contains only matching hashes without executable identities/commands/modes.

Primary audit anchors were Deno 2.9.5's configuration schema and lock-v5
fixtures, Corepack 0.35.0's authoring/environment documentation and descriptor
source, and pnpm 11's settings, package-json, build-policy, install, and
lockfile fixtures. The retry log must identify exact source URLs and
observations without embedding mutable responses, credentials, cache paths, or
host-sensitive data.

All ownership, prior-artifact immutability, positive-fixture, sole repository
RED, exact coverage, gate, and stop conditions from
`round-01-red-representation-retry.md` remain unchanged.
