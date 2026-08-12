# FND-002: Accept DG-06A coordination boundary

Status: ready, round 0\
Owner: trusted top-level orchestrator\
Base revision: `603f6621809f61fab70bc29b8b4a9252ebcecb27`\
Execution class: `ordinary`\
Depends on: none\
Maximum rounds: 3

## Outcome

The authoritative architecture contracts accept DG-06A as a workspaces-owned,
use-case-specific onboarding and invitation coordination boundary with
public-facade-only identity calls, composition-root governance handler
registration, and explicitly owned atomic rollback and postcondition semantics,
without claiming that application behavior has been implemented or proven.

## In scope

- Add and index the accepted DG-06A ADR.
- Specialize the backend transaction and cross-module coordination contract.
- Align only the exact existing manifest dependency and event-consumer edges
  needed by the accepted direction.
- Add one deterministic, built-in-Deno contract check with an in-memory harness
  self-check.

## Out of scope

- Application, PostgreSQL, onboarding, invitation, identity, membership,
  transaction, rollback, postcondition, or audit implementation and proof.
- Planning-status edits, including claims that executable DG-06A proof is
  closed.
- Authentication, migration, ledger, queue, gateway, provider, schema,
  dependency, or version choices.
- Generic coordination services, private adapter imports, direct cross-module
  table writes, or durable event infrastructure.
- `AGENTS.md`, FND-001, planning proposals, product catalogs, schema, `.codex`,
  `.agents`, `.git`, push, deployment, main merge, or integration-state edits.

## Accepted contracts

- `AGENTS.md#mandatory-change-method`
- `docs/development/autonomous-delivery.md#red-green-and-refactor-rules`
- `docs/architecture/backend-architecture.md#dependency-rules`
- `docs/architecture/backend-architecture.md#data-access-and-transactions`
- `docs/architecture/repository-layout.md#layer-contents`
- `docs/architecture/module-boundaries.yaml`
- `docs/planning/roadmap.md#decision-gates` (source recommendation explicitly
  approved for this bounded ticket)

## Acceptance criteria and RED proof

- AC-01: the accepted, indexed ADR records the exact coordinator ownership,
  public-facade call, composition-root registration, and forbidden boundaries.
- AC-02: the backend contract assigns one workspaces-owned transaction/session
  boundary with all-or-nothing rollback and explicit pre-commit postconditions.
- AC-03: the manifest retains `workspaces -> identity`, removes identity-driven
  workspace onboarding consumption, and registers governance consumption of the
  three required existing lifecycle events without a generic module or a
  `workspaces -> governance` edge.
- AC-04: the contracts distinguish synchronous transaction-scoped handlers from
  durable asynchronous delivery and explicitly leave application proof to the
  protected walking skeleton and Slice 1.

The criterion-specific RED details are authoritative in `ticket.json`. Their one
focused command is:

```text
deno test --allow-read=docs/architecture tools/architecture/FND-002/coordination_contract_test.ts
```

Against unchanged contracts, the in-memory parser/discrimination self-test must
pass while the repository-contract test fails only for the absent and
contradictory DG-06A boundary.

## Required gates

- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- Focused FND-002 Deno contract test above.
- `deno task ticket:validate docs/planning/tickets/FND-002` from the canonical
  repository root after each controller metadata commit.

## Risks

The exact security, boundary, proof-overstatement, delivery-model, and scope
risks are recorded in `ticket.json` and are part of review.

## Unresolved decisions

None. The user explicitly approved this safe, local, credential-free,
spending-free, and reversible-before-implementation contract direction.
