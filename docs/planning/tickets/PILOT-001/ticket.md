# PILOT-001: Enforce autonomous ticket evidence

Status: blocked (bootstrap evidence integrity) Owner: orchestrator Base
revision: 9d4693e1335797f1ecf98c4515ddba8e2603d8fb Depends on: none

The final implementation passed independent review and all gates, but this
bootstrap ticket cannot be accepted because rounds one and two changed their
declared immutable RED test blobs. See
`evidence/bootstrap-integrity-blocker.md`.

## Outcome

A dependency-free Deno validator and truthful root tasks mechanically reject an
invalid autonomous ticket record and accept a complete, exact-revision
RED/GREEN/REFACTOR/review record. The same ticket repairs the configuration and
templates identified by the clean-context bootstrap review.

## In scope

- Implement the existing workflow validator bootstrap seams and their CLI.
- Add 100% line, branch, and function coverage for production workflow tooling.
- Add truthful ticket:validate, test:workflow, and test:workflow:coverage tasks.
- Expand packet, result, ledger, review, and dispatch templates so they agree
  with the accepted delivery protocol.
- Bind RED evidence to an exact test-only Git revision and SHA-256 test blobs.
- Make the root format/type tasks cover the new workflow configuration and
  tooling.
- Update current-command documentation after the new tasks are real.

## Out of scope

- Application server, worker, UI, main Compose, Playwright, hooks, or CI.
- Third-party validation/schema libraries.
- Changes to the canonical Personal CRM schema bundle.
- Automatic branch, worktree, commit, merge, or Codex-thread creation inside the
  validator.

## Accepted contracts

- AGENTS.md, Mandatory Change Method
- docs/architecture/quality-gates.md, Test-First Change Contract and review gate
- docs/development/autonomous-delivery.md
- docs/architecture/repository-layout.md, tools/workflows location
- .codex/agents/feature-implementer.toml
- .codex/agents/reviewer.toml

## Acceptance criteria

- AC-01: A complete fixture with valid transitions, exact revisions, a non-zero
  RED result, zero GREEN/REFACTOR results, distinct fresh run IDs, all six
  review lenses, no open finding, and successful orchestrator checks validates.
- AC-02: Unknown fields, duplicate IDs, invalid transitions, path traversal,
  absent Deno tasks, malformed revision/hash values, identical implementer and
  reviewer IDs, missing lens evidence, RED production changes, stale candidate
  review, and open findings each fail with stable path/code diagnostics.
- AC-03: deno task ticket:validate accepts a ticket directory, reports every
  issue deterministically, exits zero only for a valid record, and rejects
  missing/malformed files without a stack trace or secret-bearing dump.
- AC-04: RED evidence names an exact RED commit, its test/check files and
  SHA-256 blob hashes, an intended assertion, the non-zero result, and no
  production path; candidate evidence cannot silently replace or weaken that
  snapshot.
- AC-05: The skill assets express outcome, dependencies, risks, unresolved
  decisions, finding traceability/status, and the append-only event entry needed
  by the delivery document.
- AC-06: Production workflow TypeScript has 100% line, branch, and function
  coverage, with focused tests for valid, invalid, CLI, and filesystem cases.
- AC-07: Root formatting, lint, and type checks include the new owned files and
  pass without weakening the existing schema validator checks.

## Required RED proof

Add tests against the existing not-implemented validator seams without changing
the two production workflow files. Run:

deno test tools/workflows/validate_ticket_test.ts

The valid-bundle/valid-directory assertions must fail because the existing seam
returns code not_implemented or exit 1. A missing module, syntax/type failure,
broken fixture, or unavailable environment is not valid RED evidence.

Stop after RED so the trusted controller can verify only test/evidence/ticket
paths changed and create the content-addressed RED commit. Resume the same
implementation round only after the orchestrator supplies that revision.

## Required gates

- deno task fmt:check
- deno task lint
- deno task check
- deno task test:workflow
- deno task test:workflow:coverage
- deno task ticket:validate docs/planning/tickets/PILOT-001
- deno task test:schema:matrix

## Risks

- A permissive validator could manufacture approval without real TDD/review.
- Recursive/unbounded JSON or directory traversal could create reliability or
  security problems.
- Logs and JSON diagnostics must not dump secrets or Personal CRM data.
- Git commit IDs cannot self-reference; candidate IDs live only in later
  metadata commits.

## Unresolved decisions

None. This ticket implements the accepted workflow contract and does not promote
any proposed product or architecture gate.
