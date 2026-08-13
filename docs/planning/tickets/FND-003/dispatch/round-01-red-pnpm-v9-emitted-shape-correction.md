# FND-003 pnpm v9 emitted-shape correction, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized fresh retry implementer run ID:
`FND-003/implementer/r1/8889dbda-aef1-4c7a-b6b3-80d65cfec9f7`\
Ticket revision: 6\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This controller-only correction belongs to
the existing captured-provenance RED retry, grants no production-write
authority, and does not alter any preserved attempt.

An exact pnpm 11.21.0 disposable resolution and the tagged lockfile conversion
source corrected one non-authoritative example in the controlling dispatch: pnpm
version-9 snapshot records do not serialize a `dev` field. Do not add or require
that invented field. The emitted snapshot subset is dependencies,
optionalDependencies, transitivePeerDependencies, optional, id, or an explicit
empty map, as present in actual selected output.

The same probe confirmed the following controlling representation details:

- importer dependencies, devDependencies, and optionalDependencies remain
  distinct maps of exact specifier and resolved version;
- package records may include resolution, engines, OS, CPU, libc,
  peerDependencies, peerDependenciesMeta, hasBin, deprecated, and
  bundledDependencies;
- package and snapshot maps are independent and one package record may back
  multiple peer-qualified snapshots;
- a literal `{}` is an empty map, while a bare YAML `key:` has the distinct null
  value and must not be normalized to an empty map;
- pnpm may omit an entirely empty top-level section;
- actual output uses single-quoted and plain scalars, doubled single-quote
  escaping, flow maps/lists, and block maps/lists.

The bounded decoder must accept and preserve those emitted forms and fail closed
on duplicate keys, aliases, anchors, tags, merge keys, multi-document input, or
unsupported YAML syntax. No observed package/snapshot count or hash is a
contract constant. All other revision-6 provenance, semantic, lifecycle, OCI,
focused-RED, and coverage requirements remain unchanged.
