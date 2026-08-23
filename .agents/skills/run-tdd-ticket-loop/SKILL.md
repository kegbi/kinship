---
name: run-tdd-ticket-loop
description: Deliver one bounded vertical feature or bug fix with a fast focused test-first loop, proportional candidate gates, one exact candidate, and independent read-only review. Use for application features, fixes, and just-in-time platform work. Avoid foundation work, exhaustive spikes, repeated aggregate gates, or workflow machinery not consumed by the active feature.
---

# Deliver a vertical ticket

Read `AGENTS.md` and `docs/development/autonomous-delivery.md` completely before
acting. Follow the relevant accepted architecture, schema, authorization, and
product contracts.

## Choose the ticket

Prefer a vertical user-visible slice that leaves the application runnable. Add
platform or foundation work only when the slice directly consumes it. Time-box
spikes to one decision; select, reject, or defer instead of productionizing
every candidate.

Give one clean implementer the base revision, owned paths, observable outcome,
relevant contracts, and existing commands. Do not create role packets, state
files, evidence documents, hash catalogs, or test-freeze commits.

Prefer serialized mutations and one authoritative refresh. Before introducing a
third async owner/generation/watermark/registry on one UI surface, simplify the
observable contract or extract a small pure reducer with table-driven tests. Do
not preserve transient state across remount/navigation/process death unless the
accepted product contract requires it. LOC caps are diagnostic, never a reason
to recut or compact an otherwise correct vertical.

## Implement

1. **RED:** add the narrowest focused test and observe the intended behavior
   failure before production changes.
2. **GREEN:** implement the smallest compliant behavior and make the focused
   test pass.
3. **REFACTOR:** clean up while focused and affected tests stay green.
4. During the inner loop, run only the focused test and cheapest directly
   affected check.
5. After behavior stabilizes, run affected coverage/static gates and at most one
   affected integration/browser boundary when the ticket crosses it.
6. Return the commands, exit codes, concise results, changed paths, and risks.

Documentation-only planning edits need review and existing relevant validation,
not a new permanent test. Machine-consumed configuration and infrastructure need
a focused smoke or contract check. Never add a no-op task.

Production code maintains at least 80% line, branch, and function coverage.
Changed-behavior tests, required E2E flows, security and tenant-isolation tests,
and schema tests remain mandatory regardless of the aggregate percentage.

## Review

The controller creates one exact candidate commit. Start one separate clean,
read-only reviewer with:

- the bounded task and accepted contracts;
- the base and exact candidate revision;
- the diff; and
- concise RED/GREEN/REFACTOR and gate evidence.

Review covers correctness, security/privacy, architecture/contracts,
performance/reliability, style/maintainability, and tests/TDD. The reviewer
returns APPROVED or CHANGES_REQUESTED with evidence-backed findings.

Actionable findings return to the same implementer with a focused regression.
The same reviewer may verify a localized amendment. Start fresh implementer and
reviewer contexts only for a high-risk redesign, a changed
schema/security/tenant/API boundary, or a repeated failed approach.

## Accept and integrate

The controller reruns the smallest owning integration gate and integrates the
approved candidate. Full coverage, production images, all browsers, schema
matrices, and release checks run once at the completed flow/phase/release
checkpoint. Git history and test output are the evidence.

## Boundaries

- One write-enabled implementer owns a worktree at a time.
- `.git` remains controller-owned.
- Keep one candidate commit per ticket; ordinary RED evidence does not need its
  own commit.
- Stop after two failed approaches to the same issue. Narrow the ticket, choose
  an option, reject the spike, or ask for the smallest blocking decision.
- Give an unrelated aggregate failure one bounded reproduction. If the candidate
  did not cause it, queue a separate reliability ticket instead of expanding the
  current diff.
- Never delay an application slice to build enforcement for hypothetical future
  code.
