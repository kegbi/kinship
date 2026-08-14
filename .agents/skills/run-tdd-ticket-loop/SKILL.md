---
name: run-tdd-ticket-loop
description: Deliver one bounded vertical feature or bug fix with focused test-first implementation, one exact candidate, and a separate clean read-only review. Use for application features, fixes, and just-in-time platform work. Avoid foundation work, exhaustive spikes, or workflow machinery not consumed by the active feature.
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

## Implement

1. **RED:** add the narrowest focused test and observe the intended behavior
   failure before production changes.
2. **GREEN:** implement the smallest compliant behavior and make the focused
   test pass.
3. **REFACTOR:** clean up while focused and affected tests stay green.
4. Run only affected existing gates. Add integration, database, security,
   browser, or infrastructure coverage when this ticket crosses that boundary.
5. Return the commands, exit codes, concise results, changed paths, and risks.

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

Actionable findings return to the implementer with a focused regression. Use a
fresh implementer only for high-risk redesign or a repeated failed approach. A
post-review change requires a fresh read-only review of the new candidate.

## Accept and integrate

The controller reruns applicable gates and integrates the approved candidate.
Git history and test output are the evidence.

## Boundaries

- One write-enabled implementer owns a worktree at a time.
- `.git` remains controller-owned.
- Keep one candidate commit per ticket; ordinary RED evidence does not need its
  own commit.
- Stop after two failed approaches to the same issue. Narrow the ticket, choose
  an option, reject the spike, or ask for the smallest blocking decision.
- Never delay an application slice to build enforcement for hypothetical future
  code.
