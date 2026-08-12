# FND-001S initial RED dispatch, round 1

Authoritative input base: `976e01716145aa29cc8b5ab22c22210689234ecd`\
Required next state: RED, then stop\
Controller run ID:
`FND-001S/orchestrator/r0/940c1592-d106-4088-96d8-b500b1f6f2be`\
Implementer run ID:
`FND-001S/implementer/r1/c361d6ab-2e58-4434-8d5a-fe9ce1b582b0`\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-001S:1`

Read only `AGENTS.md`, this ticket's `ticket.md`, `ticket.json`, `state.json`,
this dispatch, and the accepted contract references declared in the ticket. The
Git-bound FND-001 evidence listed in `ticket.md` is historical input, not a
dependency or authorization to import its implementation.

Before editing any production, configuration, or accepted contract file, add
only:

- `tools/architecture/FND-001S/astro_rendering_topology_contract_test.ts`; and
- the concise redacted RED log at
  `docs/planning/tickets/FND-001S/evidence/round-01-red.log`.

Do not create a separate helper or additional test surface. The single check
must use Deno built-ins only and be self-contained. It must derive the exact
accepted on-demand set from unchanged `docs/product/page-catalog.yaml`:
`auth.verify-email` at `/auth/verify-email`, `auth.reset` at
`/auth/reset-password`, `auth.mfa` at `/auth/mfa`, `invitation.accept` at
`/invite/:token`, and `compliance.accept` at `/app/compliance`.

## Mandatory in-memory discriminators

Before its authoritative repository assertion, the test must prove all of these
locally and report them as passing tests or subtests:

1. The exact canonical unique `## Gateway Routing` section passes.
2. A contiguous extra route row fails.
3. An extra route row separated by non-table content fails.
4. Later contradictory renderer-route prose fails.
5. A second noncanonical route table fails.
6. Missing, duplicate, malformed, duplicate-section, oversized-document, and
   excessive-route shapes fail closed.
7. The unique complete `## Network Exposure` section is structurally
   allowlisted: the exact accepted gateway-public/private-service claim set
   passes, while missing gateway, malformed, mixed, duplicate, unrecognized,
   synonym-based additional-public, and additional-public-service claims fail.

The complete-section parser must inspect the entire unique level-two section; it
must not stop at the first blank, prose, or non-table line. Route-shaped,
on-demand, and renderer-routing declarations outside the sole canonical table
must fail.

The authoritative repository assertion must cover AC-01 through AC-04 and read
only the seven declared repository inputs. Against the unchanged baseline, it
must fail only for the missing accepted DG-01 topology clauses. Parser,
catalog-extraction, in-memory discrimination, permissions, fixtures, syntax, and
type behavior must all pass.

Run exactly:

```text
deno test --allow-read=AGENTS.md,docs/architecture/decisions/0001-astro-personalized-rendering.md,docs/architecture/technology-baseline.md,docs/architecture/compose-contract.md,docs/architecture/configuration-and-secrets.md,docs/architecture/observability.md,docs/product/page-catalog.yaml tools/architecture/FND-001S/astro_rendering_topology_contract_test.ts
```

Then run a coverage command over that same file and require exact 100% line,
branch, and function coverage for its helper/check implementation; use a
temporary directory outside the repository so no coverage artifact is created in
the worktree. Run `deno fmt --check`, `deno lint`, and `deno check` directly on
the new check and require exit 0. RED remains valid only if the focused test
still exits non-zero solely at the authoritative repository assertion.

Record the exact commands, exits, passing discriminator summary, intended
repository assertion failure, and concise redacted output in the RED log. Stop
without committing. Return the changed check path, RED log path, and an empty
production/contract file list.

## Strict boundaries

- Every authorized contract path and `docs/product/page-catalog.yaml` must
  remain byte-identical to base during RED.
- Do not edit `deno.json`, a root manifest or lock, the page catalog, any
  FND-001 path, or any file outside the exact RED paths.
- Do not merge, cherry-pick, copy, or check out a predecessor file. Historical
  semantics and adversarial cases may be independently reimplemented in the new
  single check, but this is a fresh RED with new bytes, digest, and run IDs.
- Do not inspect or mutate `.git`, commit, or begin GREEN. The trusted
  controller will reproduce RED, verify byte identity and scope, freeze the
  test/check-only revision, compute the exact SHA-256, and issue a GREEN
  continuation for this same round.
