# Autonomous Vertical Delivery

Status: Accepted repository workflow, revised 2026-08-14

This is the minimum reliable loop for shipping application behavior. Accepted
architecture, schema, authorization, and product contracts remain authoritative,
but new planning or enforcement work is not a prerequisite unless the active
feature directly needs it.

## Default Shape

1. Select one bounded vertical outcome that leaves the application runnable.
2. Give one clean implementer exclusive write ownership.
3. Observe one focused RED failure before production behavior changes.
4. Implement GREEN and refactor with focused and affected checks green.
5. Create a single candidate commit.
6. Have one separate clean, read-only reviewer inspect that exact candidate.
7. Rerun applicable gates and integrate the approved candidate.

Production code maintains at least 80% line, branch, and function coverage.
Changed behavior, tenant/security boundaries, schema behavior, and delivered
cataloged flows still need their focused tests regardless of aggregate coverage.

## Proportional Testing

- Pure domain behavior: focused unit tests.
- PostgreSQL or adapter behavior: focused integration tests against the affected
  supported boundary.
- HTTP contracts: handler/contract tests for changed variants.
- Complete cataloged user flows: Playwright with the stable flow ID.
- Documentation-only planning: review plus existing validators; no new permanent
  test unless machine-consumed behavior changes.
- Configuration, migrations, and infrastructure: a focused executable smoke or
  contract check that consumes the changed artifact.

Do not rerun dependency bootstrap, the full PostgreSQL compatibility matrix, all
browsers, container builds, or the entire repository for an unrelated small
change. Those gates run when their boundary changes and in the appropriate
aggregate/CI gate once it exists.

## Roles

The controller selects scope, owns Git/worktrees, creates the candidate, sends
review, reruns gates, and integrates.

The implementer receives the base revision, outcome, relevant contracts, owned
paths, and commands. It performs RED -> GREEN -> REFACTOR and reports concise
command evidence. It does not write `.git`.

The reviewer receives the outcome, relevant contracts, exact candidate, diff,
and concise test evidence. It is read-only and returns `APPROVED` or
`CHANGES_REQUESTED` with concrete findings.

Review findings normally return to the same implementer with a regression test.
Use a fresh implementer only for a high-risk redesign or after a repeated failed
approach. Every changed candidate receives a fresh clean review.

## Process Limits

- One candidate commit per ticket. No test-freeze commits are required.
- No controller IDs, role packets, state mirrors, event ledgers, evidence hash
  catalogs, or evidence-only files.
- No permanent test for prose unless the prose is an executable contract.
- No foundation ticket unless the active vertical outcome consumes it.
- A spike answers one decision. Stop after selecting, rejecting, or deferring;
  do not harden rejected alternatives.
- After two failed approaches to the same issue, stop, narrow scope, or make the
  smallest explicit decision. Do not grow an implementation framework around the
  blocker.

## Candidate Handoff

The handoff contains only the bounded outcome, relevant contract links, base and
candidate revisions, diff, commands/results, coverage for changed production
scope, and known risks. Git is the revision record; test output is behavioral
evidence.

## Stop Conditions

Stop for a missing product/architecture decision with materially different
outcomes, missing authority or credentials, a destructive out-of-scope action,
or a scope expansion that changes risk. Routine implementation choices do not
require escalation.
