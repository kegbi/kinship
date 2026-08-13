# FND-003 final compatibility and follow-on amendment, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Authorized retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 4\
Worktree reference: `worktree:FND-003:1`

The packet remains `ready`, round 0. This amendment resolves the final
pre-freeze compatibility and follow-on boundaries and grants no production-write
authority.

## Coherent targeted ESLint graph

The independent closure audit identified this compatible candidate set to
reverify from official metadata at the actual selection timestamp:

- ESLint `9.39.5`;
- `eslint-plugin-astro` `1.7.0`;
- `eslint-plugin-jsx-a11y` `6.10.2`;
- `@typescript-eslint/parser` `8.66.0`; and
- `eslint-plugin-react-hooks` `7.1.1`.

Do not hardcode those versions from this dispatch. Select them only if they
remain newest compatible and age-eligible at the common cutoff. The graph must
select `@typescript-eslint/parser` as a direct test/tooling root and bind its
ESLint and TypeScript peer edges. `astro-eslint-parser` is a transitive lock
node of the selected Astro plugin, not an extra direct root unless the official
exact manifest proves otherwise. TypeScript must satisfy the selected parser's
upper bound.

Reject the incoherent current-major alternative: `eslint-plugin-astro` 3.1.0
requires ESLint 10 or newer while `eslint-plugin-jsx-a11y` 6.10.2 supports only
through ESLint 9. The synthetic positive must exercise at least one real
peer-suffixed pnpm v9 snapshot and bind every declared import/peer edge to the
complete lock graph.

## Complete Deno lock graph

The synthetic Deno positive must likewise be nontrivial. Its machine nodes must
represent each actual npm/JSR lock key, integrity, and dependency resolution;
include at least one transitive node and edge in the positive. Repository
validation must compare actual `deno.lock` v5 npm dependency maps in both
directions with the machine graph while accepting only the documented optional
top-level lock sections. Add missing, stale, extra, and integrity-mismatched
transitive edge negatives. Do not assume that only the seven selected backend
roots exist in the lock.

## Corepack known vector

At the actual selection timestamp, select pnpm by the same exact 72-hour rule.
If pnpm `11.21.0` is eligible, its package-manager descriptor is:

```text
pnpm@11.21.0+sha512.521705bce689924eac72f5a3587122f362689ef6571e55ba80076fd637c11132ecffada26fad4ea79c485bfddbfd3d5a2a5b05805a77e893de71ec8a6cca3bb1
```

The implementer must independently requery the exact npm publication timestamp
and SRI, preserve registry timestamp precision, and derive/verify the Corepack
hex form. Add this descriptor as a known-vector control, not as an early version
selection. If the common cutoff precedes the release's 72-hour eligibility
instant, select the prior eligible patch rather than adjusting a timestamp.

## Accessibility E2E prerequisite

Do not add `@axe-core/playwright` or `axe-core` to FND-003C's intentionally bare
Chromium smoke graph. Name `FND-003F` as
`accessibility-e2e-root-lock-amendment`. Before accessibility E2E/FND-11/FND-12,
that separate strict-TDD ticket will freshly select the matching age-eligible
published tarballs and amend the same root lock. It must not approve or execute
the source-registry `prepare` hook; the retained install-hook inventory is
expected to remain empty and must be proven then. The current `4.12.1`
observation is not an FND-003 pin.

Add both axe packages to current early exclusions and exact-membership
rejection. Preserve all earlier retry requirements, amendments, and immutable
failed-attempt bytes.
