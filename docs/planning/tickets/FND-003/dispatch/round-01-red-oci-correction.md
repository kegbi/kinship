# FND-003 OCI-tag RED correction, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Fresh correction implementer run ID:
`FND-003/implementer/r1/6a8557e3-fbb9-419b-b7de-70f45c4ef79e`\
Ticket revision: 2\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

The earlier round-1 GREEN continuation stopped before any production write. At
`2026-08-12T15:02:22.000Z`, official registry inspection demonstrated that the
frozen validator cannot accept the official image-tag forms required by AC-05:

- the PostgreSQL images use two-component server versions plus the required
  Alpine base suffix, such as `18.4-alpine3.23` and `17.10-alpine3.23`, rather
  than a synthetic three-component package semver;
- the Playwright image uses `v<package-version>-noble`, not the bare
  `@playwright/test` package version; and
- the Deno and Node images likewise carry official variant prefixes or suffixes
  around their selected runtime versions.

The prior validator applies package-only `x.y.z` syntax to every OCI tag and
compares the Playwright tag directly to the bare package version. No truthful
machine graph can pass that combination. This is a RED-oracle defect, not
authority to invent registry tags or weaken immutable index/platform proof.

## Correction authority

Start from exact revision `e20f922331500488231154dd37f6077ac757d28d`. Change
only:

- `tools/runtime/FND-003/runtime_graph_contract_test.ts`; and
- `docs/planning/tickets/FND-003/evidence/round-01-red-oci-correction.log`.

Do not edit any production manifest, lock, graph, report, ticket/state/event
authority, or prior RED evidence. You are not alone in the codebase; preserve
all controller commits and accommodate concurrent metadata without reverting it.

Keep exact package versions under the existing package-semver rule. Add the
narrowest self-tested OCI rule that instead requires each official repository
and tag template:

- `denoland/deno:debian-<selected Deno version>`;
- `node:<selected Node version>-bookworm-slim`;
- `mcr.microsoft.com/playwright:v<selected @playwright/test version>-noble`;
- `postgres:18.4-alpine3.23`; and
- `postgres:17.10-alpine3.23`.

The reference must remain exact
`<repository>:<official-tag>@<OCI-index-digest>`. Required Linux amd64/arm64
children, index media type, child/attestation distinction, and package/image
version correspondence remain strict. Add positive controls for every official
form and focused negative controls for a bare Playwright package version,
synthetic PostgreSQL patch version, wrong variant/base suffix, wrong official
repository, floating tag, and package/image version drift. Do not hardcode a
spike-selected mutable index digest or a newly selected package version in the
validator.

## Corrected RED proof

The controls must pass and the focused repository test must still fail only
because the six repository graph inputs are absent:

```text
deno test --allow-read=.npmrc,deno.json,deno.lock,package.json,pnpm-workspace.yaml,pnpm-lock.yaml,tools/runtime/FND-003,docs/validation/runtime-graph-fnd003.json tools/runtime/FND-003/runtime_graph_contract_test.ts
```

Prove direct format, lint, type check, and exact 100% line/branch/function
coverage for the corrected check without ignore directives. Run the unchanged
root `fmt:check`, `lint`, `check`, and `test:schema:matrix` gates. The full
ticket validator is expected to report only `ready_base_scope_violation` at this
pre-candidate checkpoint; also run the pure schema-v2 bundle validation and
require zero structural issues.

Write concise redacted correction evidence with exact commands, exits, the
intended sole repository failure, controls, coverage, unchanged prior hashes,
changed paths, and an empty production list. Stop before GREEN and do not commit
or self-review. The trusted controller will inspect and freeze the corrected RED
before issuing replacement GREEN authority.
