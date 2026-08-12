# FND-003 corrected GREEN continuation, round 1

Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Implementer run ID:
`FND-003/implementer/r1/6a8557e3-fbb9-419b-b7de-70f45c4ef79e`\
Ticket revision: 2\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

Resume the same fresh round-1 retry implementer that authored the corrected OCI
RED. This dispatch supersedes `round-01-green.md` only where that file binds the
rejected validator or earlier implementer identity. All graph-closure,
supply-chain, repeatability, write-scope, gate, and handoff requirements in that
dispatch and `round-01-closure-amendment.md` remain mandatory.

## Authoritative corrected RED

- Frozen RED revision: `44c71432344a0e9fca0093e7d37a8a52f8fa4fe0`
- Validator: `tools/runtime/FND-003/runtime_graph_contract_test.ts`
- Validator SHA-256:
  `f62c935b9199828899f5bdef7057eb949da5de0524307c1e4197e7a4289bd970`
- Correction evidence:
  `docs/planning/tickets/FND-003/evidence/round-01-red-oci-correction.log`
- Correction evidence SHA-256:
  `7548b3753c88e0e91d2047b67ce1ab53b3a3520f12a75bf5e203bb0d9f45ec06`

The earlier revision `810afc27a0a1d1e6029ec61793ca067f00f6f40b` is a rejected
RED attempt: its OCI oracle required synthetic package-semver tags that conflict
with official image tags. Preserve that commit, its validator bytes, and both
earlier RED logs as immutable provenance, but do not use it as GREEN authority.

Before writing production inputs, verify the corrected revision and all four
hashes below:

- corrected validator:
  `f62c935b9199828899f5bdef7057eb949da5de0524307c1e4197e7a4289bd970`;
- corrected RED log:
  `7548b3753c88e0e91d2047b67ce1ab53b3a3520f12a75bf5e203bb0d9f45ec06`;
- prior retry log:
  `2f7ec4618ae4ee0359f99e8a16ad93804053338a4473d40e9ae68ed56c7f3431`; and
- initial failed-attempt log:
  `21f9453d8dee94c5a9a2bb6796a009bdc60136d6920c2bfb8a6a4bfd8189e0e4`.

Stop if any byte differs. Do not edit, format, regenerate, weaken, skip, or
replace the corrected validator or any RED evidence.

## GREEN execution

Requery official package and image registries at the actual selection timestamp
and select the newest compatible stable age-eligible graph; no earlier snapshot
is authority. OCI tags may be mutable and version eligibility may cross its
72-hour boundary during this work, so bind the exact observed timestamp,
publication evidence, current OCI indexes, runnable children, and artifact
hashes used by the final proof.

The corrected validator requires these official image declarations around the
independently selected package versions:

- `denoland/deno:debian-<selected Deno version>`;
- `node:<selected Node version>-bookworm-slim`;
- `mcr.microsoft.com/playwright:v<selected @playwright/test version>-noble`;
- `postgres:18.4-alpine3.23`; and
- `postgres:17.10-alpine3.23`.

Each reference must include the exact live OCI index digest. Preserve the
required Linux amd64/arm64 child and attestation classification. Never replace
an official tag with a synthetic tag merely to satisfy a check.

Implement only the allowed root manifests, locks, machine graph/report, and any
genuinely non-empty tool-owned proof asset authorized by the packet. The locked
graph must include every FND-003A/B/C import edge, the immutable shadcn Button
closure, exact Vitest DOM environment, and `@playwright/test`, with one root
`deno.lock` and one root `pnpm-lock.yaml` that successors reuse without
mutation. Keep Corepack integrity/signatures strict and lifecycle execution
denied by default. Prove real fresh-cache frozen resolution, cached-only/offline
repeat, unchanged lock hashes, hook inventory, and no startup install.

Run the corrected focused test, exact 100% coverage, every direct check, and all
unchanged required root gates. Write only truthful, concise, redacted
`round-01-green.log` and `round-01-refactor.log` evidence. Return exact selected
versions/timestamp, official provenance, OCI indexes/children, lifecycle scan,
commands/exits, artifact and lock hashes, changed paths, and clean status. Stop
without committing, self-reviewing, or advancing ticket state.
