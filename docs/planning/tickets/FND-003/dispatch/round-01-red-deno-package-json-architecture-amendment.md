# FND-003 Deno package discovery and architecture amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 2\
Worktree reference: `worktree:FND-003:1`

This controller amendment binds two repository-resolution facts discovered
before the operative round-1 RED was frozen. It grants no production-write
authority and does not change the packet lifecycle from `ready`, round 0.

## Deno root-package discovery policy

Deno 2.9 discovers a root `package.json` in addition to `deno.json`. FND-003
selects an explicit backend-only Deno dependency graph, so every clean,
cached-only, frozen, and semantic Deno resolution command must set the actual
`DENO_NO_PACKAGE_JSON` environment variable to its documented enabled value. The
evidence must record that environment value for each Deno run. A prose label or
invented derived state does not substitute for the real environment.

The validator must parse and compare the actual Deno import and lock content
against the machine graph. It must not assume that a lock has a fixed small
number of nodes or require an unused fixture-only dependency. It must reject:

- a missing, false, or unbound `DENO_NO_PACKAGE_JSON` setting on any Deno
  resolution or repeat command;
- a pnpm-only root dependency entering `deno.json` or `deno.lock` under the
  backend-only policy;
- a missing, stale, extra, or integrity-mismatched Deno lock node relative to
  the machine graph; and
- a graph that claims a backend-only lock while its executable proof allows root
  `package.json` discovery.

## pnpm policy and architecture closure

For pnpm 11, `.npmrc` may carry only the fixed registry and any deliberately
required authentication/registry configuration; this ticket must not place
minimum-age, lock-trust, lifecycle/build, or architecture policy there. All
non-auth project settings belong in `pnpm-workspace.yaml`, including:

- `saveExact`, minimum-release-age and missing-publication-time policy;
- `trustLockfile` and strict, deny-by-default build policy; and
- the exact official `supportedArchitectures` representation required to lock
  Linux x64 and arm64 resolution for the pinned runtime/image successors while
  retaining any current-host value that the clean Windows proof genuinely
  requires.

The implementer must verify the exact pnpm 11 field names, scalar/list syntax,
and architecture identifiers from current official primary evidence before
encoding the positive fixture. The validator must reject a missing required
Linux architecture, an invented architecture identifier, a setting misplaced in
`.npmrc`, and graph or lock evidence that cannot support both required Linux
architectures without successor lock mutation.

## RED boundary

Add one focused negative per defect above and preserve every earlier negative.
The complete synthetic repository positive must use the same real environment,
workspace, importer, package, snapshot, and lock representations expected from
GREEN. Re-run the unchanged focused RED command, exact 100% line/branch/function
coverage, direct format/lint/type checks, root gates, and pure packet
validation. Only the repository-absence assertion may fail. Preserve all prior
failed attempt bytes, change no production file, write the existing
representation retry log only after this amendment is read, and stop for
controller freeze.
