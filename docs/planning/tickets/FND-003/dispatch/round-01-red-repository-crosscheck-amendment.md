# FND-003 repository cross-check amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 2\
Worktree reference: `worktree:FND-003:1`

This controller amendment closes one final representation gap in the
consolidated test-only retry. It grants no production-write authority.

The dependency-free validator must not accept a graph merely because it hashes
opaque repository files. Its complete synthetic positive repository fixture must
contain bounded realistic representations of `.npmrc`, `deno.json`, `deno.lock`
v5, `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` v9. The
validator must cross-check the relevant file content against the machine graph,
including:

- exact manifest/import specs with no range, tag, alias drift, or `latest`;
- exact Corepack package-manager descriptor and engine declarations;
- actual Deno lock/specifier nodes and pnpm importer/package/snapshot nodes for
  every declared direct, peer, and successor-required edge;
- exact root lock filenames and versions;
- minimum-age, lock-trust/frozen, and independent Deno/pnpm lifecycle policy in
  the file where each ecosystem actually defines it; and
- exact graph artifact hashes after those semantic checks.

Add focused negative repository fixtures for at least: a range or `latest`, a
missing/stale lock edge, a graph/file version or integrity disagreement, an
invented lock filename/schema, and a removed or misplaced lifecycle/build
policy. Fail closed on duplicate keys or ambiguous representations.

Implement only the narrow deterministic JSON and YAML subset needed by these
committed files; do not introduce a dependency, general-purpose parser, mutable
fixture fetch, or production file. All prior retry requirements and immutable
attempt hashes remain unchanged.
