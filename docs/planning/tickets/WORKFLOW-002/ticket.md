# WORKFLOW-002: Scale Git evidence validation on growing history

Status: RED frozen, round 1\
Owner: trusted top-level orchestrator\
Ticket revision: 3\
Base revision: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Execution class: `ordinary`\
Depends on: none\
Maximum rounds: 3

Frozen RED revision: `d7a187ae1c2a311be265916121676914388d733e`\
Frozen regression SHA-256:
`8a433e183b9091994a747cf4d3dd0fd69152c21f34258a59180e5dfb91e4e71e`

## Outcome

The workflow validator remains resource-bounded and reaches the intended scope
and mutation decisions as unrelated repository history grows, while exact
evidence enumeration and every existing workflow-integrity failure remain strict
and the complete workflow suite is green at 100% validator coverage.

## In scope

- Replace global changed-path enumeration used only for boolean ready-scope and
  post-integration packet-mutation decisions with no-output Git predicates
  scoped to the exact relation and relevant path set.
- Preserve capped exact RED/candidate evidence enumeration and all existing
  diagnostics for output truncation, dirty metadata, ancestry/content mismatch,
  accepted-phase policy, rename/copy boundaries, and later integrated mutation.
- Freeze one dedicated real-Git regression file covering exactly 101 unrelated
  paths, exactly 101 relevant evidence paths, fewer than 100 records producing
  more than 10,000 streamed bytes, ticket-to-outside renames, ordinary later
  ticket mutation, and intrinsic missing-root-tree Git-error mapping.
- Restore the complete workflow task on current growing history and retain exact
  100% branch, function, and line coverage for `ticket_contract.ts` and
  `validate_ticket.ts`.

## Out of scope

- `tools/workflows/ticket_contract.ts`, `deno.json`, task or coverage changes.
- Any lineage, packet state, result, review, run ID, or evidence reuse from
  blocked WORKFLOW-001. Its candidate diff is design input only after this
  ticket's fresh RED is frozen.
- Prior tickets, application/product/architecture/schema documents, `.agents`,
  `.codex`, `.git`, or global/user/system Git configuration.
- Main integration, `integration.md`, merge, rebase, cherry-pick, push, deploy,
  or production-readiness claims.

## Accepted contracts

- `AGENTS.md#mandatory-change-method`
- `.agents/skills/run-tdd-ticket-loop/SKILL.md#enforce-the-loop`
- `docs/development/autonomous-delivery.md#non-negotiable-invariants`
- `docs/development/autonomous-delivery.md#ticket-files`
- `docs/development/autonomous-delivery.md#orchestrator-acceptance-guard`
- `docs/development/autonomous-delivery.md#command-truth`

## Acceptance criteria and RED proof

- AC-01: 101 unrelated ready-scope paths reach intended validation; a
  ticket-to-outside ready rename remains rejected.
- AC-02: 101 unrelated later paths reach exact post-candidate and integrated
  mutation validation; ordinary later ticket mutation and an integrated
  ticket-to-outside rename remain detected.
- AC-03: 101 relevant exact-evidence paths and fewer than 100 records producing
  more than 10,000 actual streamed bytes remain strictly rejected.
- AC-04: a syntactically valid bogus commit names a proven-absent root tree; the
  fixture proves the exact scoped Git predicate exits greater than 1 and maps to
  the strict Git-error diagnostic without deleting any object file.
- AC-05: all named policy and integrity boundaries remain strict; the exact
  candidate workflow test count is recorded with zero failures and exact 100%
  branch/function/line coverage for both validator production files.

The criterion-specific expectations in `ticket.json` are authoritative. The one
frozen RED command is:

```text
deno test --allow-read --allow-write --allow-run=deno,git tools/workflows/scalable_git_evidence_regression_test.ts
```

RED controls must pass. Unchanged production may fail only for the scalable
boolean-query behavior, never because the real-Git fixture setup is broken.

## Baseline proof

At the exact clean base, `deno task test:workflow` exited 1. The focused
existing failure reported `git_output_limit` at `$.state.candidateRevision`
before the intended legacy Git-metadata check because repository history exceeds
the global `MAX_CHANGED_PATHS` cap. See `evidence/baseline-main-workflow.log`.

## Required gates

- Focused frozen regression command above.
- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task test:workflow` with the exact discovered test count and zero
  failures recorded at the candidate.
- `deno task test:workflow:coverage` with exact 100% branch, function, and line
  coverage for `ticket_contract.ts` and `validate_ticket.ts`.
- Additional controller evidence, not a no-argument required task:
  `deno task ticket:validate docs/planning/tickets/WORKFLOW-002` from the
  canonical Git root after each controller metadata commit.

## Risks

The exact Git exit-code, pathspec, bounded-output, deterministic-fixture, and
scope-concealment risks in `ticket.json` are part of implementation and review.

## Unresolved decisions

None.
