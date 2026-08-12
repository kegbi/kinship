# FND-003 pnpm optional-closure amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 4\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This clarification belongs to the same
round-1 representation retry, grants no production-write authority, and does not
alter any preserved failed attempt.

## Complete pnpm v9 graph versus runnable target closure

An actual disposable pnpm 11.21.0 resolution showed that
`supportedArchitectures` does not prune all non-host optional packages from the
version-9 lockfile. The committed lock and machine graph must therefore preserve
every package and snapshot that pnpm writes, including Darwin, ARM, and musl
optional nodes. The validator must derive package, snapshot, peer-suffix, edge,
optional, and target-relevant membership dynamically from the actual lock. It
must never assert an observed node count or precomputed lock hash.

The current direct frontend/test root set comprises the 19 required B/C roots
and the five targeted ESLint roots. Required peers such as `@types/react` and
`@types/react-dom`, the Astro parser, platform packages, and other transitive
nodes belong to the complete lock graph rather than becoming extra direct roots
unless an executable manifest requirement independently proves that ownership.

Do not treat lock presence as build permission. The fresh complete hook scan
must inventory every resolved lifecycle owner. Darwin-only `fsevents` nodes may
remain in the lock but their builds must be explicitly denied. Only `esbuild`
may be build-approved, and only after the clean install proves that exception is
required; any newly observed hook owner rejects the graph until it is reviewed.
Deno's lifecycle allowlist remains independently empty.

The bounded synthetic fixture need only be internally complete and
official-shaped. It must include representative optional, peer-suffixed, and
platform-restricted cases and prove their fail-closed comparisons, while the
repository path must accept and compare an arbitrarily sized real pnpm v9 graph
without hardcoded counts, versions, or hashes.
