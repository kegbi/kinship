# FND-003 Deno lock-v5 shape amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 4\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This controller-only clarification is part
of the existing round-1 representation retry. It grants no production-write
authority and does not alter or relabel any preserved failed attempt.

## Exact Deno 2.9.5 lock representation

Before freezing the operative RED, read the Deno 2.9.5 lockfile schema/source
and make the synthetic positive use its actual version-5 representation. npm
and JSR lock nodes must use the documented dependency-name arrays, including
`dependencies` and `optionalDependencies` where the resolved node actually has
them, together with only documented optional node fields such as `os`, `cpu`,
or `tarball`. Do not invent a dependency-name-to-resolution property that Deno
does not serialize.

The positive may not fabricate a dependency between real selected packages.
Use a truthful relation from the selected backend graph when Deno records one.
If that selected graph has no suitable transitive edge in its actual lock, keep
the official-format schema control separate and require the repository graph to
match the real resolved lock exactly rather than claiming that the fixture is
the selected graph.

Repository validation must compare every actual Deno npm/JSR lock key,
integrity value, dependency array, optional-dependency array, and applicable
platform restriction against the machine graph in both directions. Add focused
negatives for missing and extra nodes, missing and extra dependency names,
optional-dependency drift, platform drift, and integrity drift. Do not assume a
fixed lock-node count.

Preserve the exact focused-command contract: all in-memory controls pass and
the repository assertion is the sole RED failure for the six absent GREEN
artifacts. Exact line, branch, and function coverage must remain 100 percent
before the controller can freeze the revised oracle.
