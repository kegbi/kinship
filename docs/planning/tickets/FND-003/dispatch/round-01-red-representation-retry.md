# FND-003 official-representation RED retry, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Fresh retry implementer run ID:
`FND-003/implementer/r1/09f30892-781e-41bb-b44a-ead4e74fe4d9`\
Ticket revision: 2\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

The packet remains canonically `ready`, round 0, with no result or candidate.
This is a fresh round-1 RED retry, not lifecycle round 2. Start from the clean
controller revision containing this dispatch. No production write is authorized
until the trusted controller independently accepts and freezes this retry.

## Rejected attempts that remain immutable

Do not edit, regenerate, reformat, delete, or overwrite any prior RED evidence
or commit:

- `810afc27a0a1d1e6029ec61793ca067f00f6f40b`, validator SHA-256
  `7515751e75d4c6a7730716c7b3a19e5114b5523026de5d25014aeb3d85bc05d5`;
- `44c71432344a0e9fca0093e7d37a8a52f8fa4fe0`, validator SHA-256
  `f62c935b9199828899f5bdef7057eb949da5de0524307c1e4197e7a4289bd970`;
- `evidence/round-01-red.log`, SHA-256
  `21f9453d8dee94c5a9a2bb6796a009bdc60136d6920c2bfb8a6a4bfd8189e0e4`;
- `evidence/round-01-red-retry.log`, SHA-256
  `2f7ec4618ae4ee0359f99e8a16ad93804053338a4473d40e9ae68ed56c7f3431`; and
- `evidence/round-01-red-oci-correction.log`, SHA-256
  `7548b3753c88e0e91d2047b67ce1ab53b3a3520f12a75bf5e203bb0d9f45ec06`.

The earlier GREEN dispatches are superseded and provide no production-write
authority.

## Bounded retry ownership

Change only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`; and
- `docs/planning/tickets/FND-003/evidence/round-01-red-representation-retry.log`.

You are not alone in the codebase. Preserve controller metadata and other
agents' work; never revert it. Do not touch manifests, locks, graph/report,
ticket/state/events, accepted contracts, or Git metadata. Stop before GREEN,
commit, or self-review.

## Required official-format audit

Before editing, re-audit every field the proposed real GREEN graph must carry
against current official package-manager, lockfile, registry, release, source,
and OCI representations. Use primary evidence and record a concise redacted
field-to-source audit in the retry log. At minimum verify:

- RFC 3339 UTC selection, cutoff, publication, and exclusion timestamps with
  exact source precision, including nonzero milliseconds;
- the integrity/checksum and provenance/evidence form actually available for
  runtimes, npm packages, Corepack descriptors, immutable source, and OCI
  manifests rather than forcing one registry-only encoding on every kind;
- actual `deno.json`, `deno.lock`, `.npmrc`, `package.json`,
  `pnpm-workspace.yaml`, and `pnpm-lock.yaml` names and relevant schema fields;
- direct dependencies, required peers such as React type packages when the
  selected Astro integration requires them, transitive locked resolution, and
  install-hook owners from the resolved pnpm/Deno graph;
- Deno `allowScripts` and pnpm build-policy names/semantics as they are actually
  represented; and
- immutable shadcn Button source identity, its direct imports, the transitive
  `cn` helper imports, and the exact absence or presence of any icon package.

If this audit discovers another representation mismatch, correct and self-test
it in this one consolidated retry. Do not defer a known oracle defect into GREEN
or encode invented data merely to satisfy a check.

## Required synthetic positive graph

Build one complete in-memory positive graph that mirrors actual official
representations rather than generic placeholders. It must exercise together:

- exact RFC 3339 publication timestamps preserving nonzero milliseconds;
- exact root lock names `deno.lock` and `pnpm-lock.yaml` with no `pnpm.lock`;
- a distinction between selected/direct graph nodes and complete transitive
  lock/hook evidence so a real hook owner such as exact `esbuild` can be named
  truthfully without pretending it is Astro or an adopted direct dependency;
- separately reviewed Deno and pnpm lifecycle policies without falsely requiring
  the two ecosystems' allowlists to be identical;
- the provenance-bound shadcn Button import closure derived from its actual
  source, requiring `@base-ui/react`, `class-variance-authority`, `clsx`, and
  `tailwind-merge`, and requiring `lucide-react` only if that exact source
  imports it; and
- every required direct/peer/import edge and corrected official OCI tag/index
  representation needed by FND-003A/B/C without a successor lock mutation.

The positive fixture must still prove strict exact versions, age eligibility,
newer-release exclusions, Corepack integrity/signatures, lifecycle denial,
single-root locks, immutable source/provenance, index-versus-child separation,
required Linux platforms, and proof-pending follow-ons.

## Focused negative discrimination

Add at least one focused negative control for every corrected defect:

- a noncanonical or precision-losing timestamp representation;
- `pnpm.lock` or another invented lock filename;
- a missing, misattributed, duplicate, or unreviewed transitive hook owner;
- a Deno/pnpm policy accidentally coupled across ecosystems;
- an invented Button import such as forced `lucide-react`, plus a missing real
  Button or `cn` helper import;
- a missing required peer or real successor import edge; and
- every additional real-format mismatch discovered by the audit.

Retain all existing valid negatives, including OCI repository/tag templates,
floating tags, wrong variants, package/image drift, wrong index media type,
missing platform, attestation confusion, mutable shadcn invocation, permissive
lifecycle configuration, incompatible TypeScript, missing dialect, and lock
mutation.

## RED acceptance and handoff

The corrected in-memory controls must pass. The full focused command must exit 1
with exactly one failing repository assertion caused only by absent `.npmrc`,
`deno.lock`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, and
`docs/validation/runtime-graph-fnd003.json`:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json tools/runtime/FND-003/runtime_graph_contract_test.ts
```

Prove direct format, lint, type check, and exact 100% line/branch/function
coverage without ignore directives. Run unchanged root `fmt:check`, `lint`,
`check`, and `test:schema:matrix`. Pure schema-v2 bundle validation must have
zero issues; full ticket validation may report only the known pre-candidate
`ready_base_scope_violation`.

Write the retry log with exact commands/exits, accepted sole failure, complete
positive representation summary, one negative per defect, field-format audit,
coverage, root gates, changed paths, all preserved hashes, and production `[]`.
Return the structured payload and stop. The controller alone inspects, freezes,
and later binds GREEN authority.
