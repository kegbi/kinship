# Autonomous Vertical Delivery

Status: Accepted repository workflow, revised 2026-08-23

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
7. Return localized findings to the same implementer and reviewer; restart
   contexts only when the risk boundary or design materially changes.
8. Rerun the owning integration gate once and integrate the approved candidate.

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

Use this gate ladder:

1. **Inner loop:** the narrow focused test plus the cheapest directly affected
   type/contract check. Do not run coverage, Compose, or all browsers here.
2. **Candidate:** after behavior stabilizes, run affected coverage/static gates
   and one affected database/browser boundary when the ticket changes it.
3. **Integration:** run full coverage, production images, all-browser E2E,
   schema matrices, and release checks once for the owning completed flow,
   phase, or release candidate.

Do not rerun dependency bootstrap, the full PostgreSQL compatibility matrix, all
browsers, container builds, or the entire repository for a small amendment.
After one bounded reproduction, an unrelated aggregate failure becomes a
separate reliability ticket. It can block the later integration checkpoint but
must not expand the feature candidate being reviewed.

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
The same reviewer may inspect a localized amendment to its candidate without a
new clean context. Use a fresh implementer and reviewer only for a high-risk
redesign, a changed schema/security/tenant/API boundary, or after a repeated
failed approach.

## Complexity Budget

Choose the smallest observable concurrency contract. Serialize mutations and use
one authoritative refresh unless independent progress is user-visible and
required. Before adding a third async owner, generation, watermark, or in-memory
registry to one UI surface, stop and either simplify the behavior or extract one
small pure reducer with table-driven transition tests. Do not promise transient
state across remount, navigation, or process death unless an accepted product
contract requires it.

LOC counts are review signals, not acceptance gates. Never recut, compact, or
rewrite a correct vertical solely to cross an arbitrary line-count threshold.

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
- Do not repair unrelated flaky tests inside the feature candidate. Queue a
  separate bounded reliability fix and keep the ownership/diff distinct.

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
