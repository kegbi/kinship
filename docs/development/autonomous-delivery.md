# Autonomous TDD Delivery

Status: Accepted repository workflow, revised 2026-08-13

This document defines the smallest reliable delivery loop for repository
changes. It is subordinate to accepted architecture, schema, authorization,
product, and quality contracts and cannot resolve an open product or
architecture decision.

## Invariants

1. One clean implementer owns one implementation or rework round.
2. Every changed behavior begins with the narrowest automated test or
   deterministic executable check and an observed RED failure before production
   files change.
3. RED must fail for the intended missing or incorrect behavior. Syntax, setup,
   permission, service, timeout, and unrelated failures do not count.
4. GREEN is the smallest architecture-compliant change that satisfies the RED
   proof. Tests are not weakened, skipped, excluded, or over-mocked.
5. REFACTOR changes structure only while the focused and affected checks remain
   green.
6. A separate clean, read-only reviewer examines the exact candidate revision.
7. Every actionable finding returns to a fresh implementer for another RED ->
   GREEN -> REFACTOR round and then another fresh review.
8. The controller integrates only the exact reviewed candidate after
   independently rerunning applicable gates.
9. Parallel write-enabled work uses disjoint worktrees and disjoint ownership.

Production code must maintain at least 80% line, branch, and function coverage.
This threshold does not reduce the mandatory checks for changed behavior,
security and tenant isolation, the canonical schema, or required end-to-end user
flows.

## Roles

### Controller

The controller selects a ready ticket or bounded change, records its base and
scope, assigns one write owner, and chooses the applicable gates. It creates the
candidate revision, dispatches review, reruns gates, and integrates an approved
candidate. It does not use hidden metadata to substitute for executable proof.

### Implementer

The implementer receives only the bounded task, accepted contract references,
base revision, allowed paths, and any review findings. It records concise
evidence for RED, GREEN, REFACTOR, and the broader gates, then stops without
committing, reviewing, accepting, or merging its own work.

### Reviewer

The reviewer starts in a fresh context and is read-only. The reviewer receives
the task, accepted contracts, exact candidate revision, diff, and concise
evidence. Review covers:

- bugs and correctness;
- security, privacy, authorization, and workspace isolation;
- architecture, schema ownership, and product/API contracts;
- performance and reliability;
- style and maintainability; and
- test discrimination, coverage, E2E traceability, and TDD integrity.

The reviewer returns either APPROVED or CHANGES_REQUESTED with concrete,
evidence-backed findings. Any actionable finding blocks acceptance.

## RED -> GREEN -> REFACTOR

### RED

- Add or tighten the narrowest test or deterministic check first.
- Run it before editing production or policy files.
- Confirm the non-zero result comes from the intended assertion.
- Record the command, exit code, concise output, and changed test/check paths.
- For review rework, reproduce every dispatched finding together.
- A documentation, contract, configuration, architecture-enforcement, or
  infrastructure change starts with a failing validator or bounded probe.

The test does not require a special commit before GREEN. The controller can use
the diff and command evidence to verify that production files were unchanged
during RED.

### GREEN

- Make the smallest compliant production change that passes the focused check.
- Preserve module ownership, workspace isolation, schema authority, and
  static-first frontend boundaries.
- Do not broaden permissions or scope merely to make a test pass.
- Record the focused passing command and changed production paths.

### REFACTOR

- Improve names and structure only after GREEN.
- Keep the focused suite green and run every affected existing gate.
- New behavior discovered during cleanup begins another RED cycle.
- Record commands actually run, exit codes, and concise observed results.

## Candidate And Review

The trusted controller creates one exact candidate revision from the completed
tree. The review handoff contains only:

- the bounded task and accepted contract references;
- the base and exact candidate revision;
- the base-to-candidate diff;
- concise RED/GREEN/REFACTOR and gate evidence; and
- unresolved risks or prior findings, when present.

No synthetic role identities, mirrored state files, event ledgers, evidence
digests, provenance aliases, or metadata-only commits are required. Git history
is the revision record; tests and command output are the behavioral evidence.

After APPROVED, the controller independently reruns the applicable repository
gates against the exact candidate. Any code, test, generated artifact, contract,
or relevant configuration change after review creates a new candidate and
requires a fresh review.

## Command Truth

Run only commands that exist and have real implementations. Current root tasks
are documented in `deno.json`; policy prose is not a substitute for that file.
Do not add no-op placeholders for planned application, UI, contract, E2E, CI,
hook, or Compose work.

The current pre-application baseline includes formatting, linting, type checks,
the focused workflow-policy tests, frozen dependency bootstrap, and the
PostgreSQL schema matrix. Add broader stable root tasks only with their first
truthful executable harness.

Tests use the smallest permissions needed for their layer. Deno-owned tooling
must not accidentally consume the separate Node workspace. Frozen online
bootstrap and an offline rerun use the same explicit cache and must leave locks
unchanged.

## Coverage And Required Test Classes

The minimum production threshold is 80% independently for lines, branches, and
functions. Coverage exclusions require narrow review and cannot hide changed
behavior. The following remain mandatory regardless of aggregate percentage:

- a regression or changed-behavior test for every production change;
- all required cataloged Playwright flows before a flow is delivered;
- authorization, workspace-isolation, and other security boundary tests;
- the PostgreSQL schema matrix for schema or harness changes; and
- contract, integration, accessibility, or browser tests required by the
  affected accepted contract.

## Worktrees And Protected Paths

One write-enabled implementer owns a worktree at a time. Independent tasks may
run in parallel only when their dependency and write sets are disjoint.
Reviewers are read-only. The trusted controller performs branch, worktree,
commit, merge, and cleanup operations.

`.git` is never writable by an implementer. Ordinary work also does not change
`.codex` or `.agents`; an explicitly authorized protected-configuration task may
change only its named `.codex` or `.agents` paths.

## Stop Conditions

Continue through routine implementation choices. Stop after three bounded
attempts at the same external blocker, or immediately when safe progress needs:

- an unresolved product or architecture decision with materially different
  outcomes;
- missing external authority, credentials, or service state;
- a destructive action outside the authorized scope; or
- a scope expansion that changes the task's risk or ownership.

Report the exact blocker, attempts, evidence, and smallest decision needed.
