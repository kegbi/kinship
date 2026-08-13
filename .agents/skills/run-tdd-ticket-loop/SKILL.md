---
name: run-tdd-ticket-loop
description: Deliver one bounded repository change with strict test-first implementation, a separate clean read-only review of the exact candidate, and fresh test-first rework for findings. Use for implementation, bug fixes, roadmap tickets, or protected repository maintenance. Do not use for read-only explanation or diagnosis.
---

# Run the TDD delivery loop

Read `AGENTS.md` and `docs/development/autonomous-delivery.md` completely before
acting. Follow the relevant accepted architecture, schema, authorization, and
product contracts.

## Prepare

1. Select one ready, bounded change with satisfied dependencies.
2. Record its base revision, allowed paths, observable outcome, acceptance
   criteria, risks, and existing commands that apply.
3. Give one clean implementer exclusive write ownership of its worktree.
4. Do not create directories, task names, or evidence files that have no real
   executable purpose.

## Implement

1. RED: add or tighten the narrowest automated test or deterministic check
   before production changes. Run it and confirm the expected assertion fails
   for missing or incorrect behavior, not setup, syntax, permissions, services,
   or an unrelated defect.
2. GREEN: make the smallest architecture-compliant production change and run the
   focused test to zero exit.
3. REFACTOR: improve structure only while focused and affected tests stay green.
   Run every relevant repository gate that currently exists.
4. Return concise evidence: each exact command, exit code, observed result,
   changed test/check paths, changed production paths, and any blocker.

Configuration, documentation, architecture enforcement, generators,
infrastructure, and migrations also require a truthful failing check before the
change. Never weaken, skip, delete, exclude, reverse, or over-mock the RED
proof.

Production code maintains at least 80% line, branch, and function coverage.
Changed-behavior tests, required E2E flows, security and tenant-isolation tests,
and schema tests remain mandatory regardless of the aggregate percentage.

## Review

After implementation, the trusted controller creates the exact candidate
revision. Start a separate clean, read-only reviewer with only:

- the bounded task and accepted contracts;
- the base and exact candidate revision;
- the diff; and
- concise RED/GREEN/REFACTOR and gate evidence.

Review covers correctness, security/privacy, architecture/contracts,
performance/reliability, style/maintainability, and tests/TDD. The reviewer
returns APPROVED or CHANGES_REQUESTED with evidence-backed findings.

Every actionable finding returns to a fresh implementer for another RED -> GREEN
-> REFACTOR round. A fresh read-only reviewer then examines the new exact
candidate. Any post-review change invalidates the earlier approval.

## Accept and integrate

The controller independently reruns applicable gates against the exact reviewed
candidate. Only the controller commits, accepts, integrates, and reports the
integration revision. Git history records revisions; command results provide the
behavioral evidence.

## Boundaries

- One write-enabled implementer owns a worktree at a time.
- Parallel tickets require disjoint dependencies and write sets.
- `.git` is always forbidden to implementers.
- `.codex` and `.agents` changes require explicit protected-configuration
  authority naming the allowed paths.
- Stop after three bounded attempts at the same external blocker, or sooner for
  missing authority, credentials, a destructive out-of-scope action, or an
  unresolved decision with materially different outcomes.
