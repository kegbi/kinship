# FND-003 targeted ESLint closure amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 3\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This amendment closes an accepted
dependency-graph omission before the operative RED is frozen. It grants no
production-write authority and does not authorize an ESLint configuration or new
command in FND-003.

The accepted technology baseline requires narrowly configured current ESLint for
Astro templates, accessibility, and official React hooks rules, and roadmap
FND-02 explicitly includes the ESLint plugins in its pin set. Add exact,
freshly-selected compatible pnpm roots and complete lock closure for:

- ESLint;
- `eslint-plugin-astro`, its accessibility preset dependency closure, and every
  parser/peer required by the exact selected manifest;
- `eslint-plugin-jsx-a11y`; and
- the official `eslint-plugin-react-hooks` and every required peer.

Select versions at the same recorded UTC cutoff as the rest of the graph. Do not
copy snapshot versions from conversation. Record exact official publication,
integrity, compatibility, newer-release exclusion, import, peer, package, and
snapshot evidence. A missing lint root, accessibility edge, parser peer, React
hooks edge, or graph/lock resolution must reject the graph. FND-003D owns the
minimal flat configuration and command wiring after this lock closure exists.

The full pnpm graph remains target-filtered and dynamically compared with the
actual lock; never hardcode an observed snapshot count. Under the committed
Windows-plus-Linux supported-architecture policy, Darwin-only `fsevents` nodes
and their lifecycle hooks must remain excluded from executable build approval.
The retained hook inventory must still cover every target-relevant hook owner;
the current resolver observation that only `esbuild` remains is evidence to
reverify, not a value to assume.

Add focused negatives for each missing lint/peer/accessibility edge and for a
Darwin-only hook incorrectly admitted or approved. Preserve all other active
retry requirements and every prior failed-attempt byte.
