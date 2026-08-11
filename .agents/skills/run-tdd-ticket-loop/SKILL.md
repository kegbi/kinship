---
name: run-tdd-ticket-loop
description: Run repository implementation tickets through an autonomous, clean-context orchestrator/implementer/reviewer loop with strict RED-GREEN-REFACTOR evidence, independent multi-lens review, rework dispatch, worktree isolation, integration, and final verification. Use when Codex is asked to implement a feature, fix a bug, execute roadmap tickets, continue toward a milestone or MVP, or coordinate parallel coding work in this repository. Do not use for read-only explanation or diagnosis that makes no repository change.
---

# Run the autonomous TDD ticket loop

Read AGENTS.md and docs/development/autonomous-delivery.md completely before
acting. Those files are authoritative when this skill is invoked.

## Prepare one ticket

1. Select only a ready ticket whose dependencies and accepted decisions are
   satisfied.
2. Give it one branch and one worktree. Never give two write-enabled agents the
   same worktree.
3. Create its disk packet under docs/planning/tickets/<ticket-id>/ using the
   templates in assets/. Keep ticket.md and ticket.json synchronized, replace
   every placeholder, and run deno task ticket:validate.
4. Record the base revision, in-scope and out-of-scope files or behavior,
   architecture references, acceptance criteria, required tests, and commands.

## Dispatch with clean contexts

- Start a new orchestrator context for the delivery run when possible.
- Start a new feature_implementer thread for every implementation or rework
  round. Give it only the repository and worktree paths, both ticket files,
  state.json, accepted contract references, and the latest dispatch packet.
- Start a new reviewer thread for every review round. Give it only the ticket,
  base and candidate revisions, evidence, and diff. The reviewer is read-only.
- Never forward hidden reasoning or conversational summaries between roles. The
  versioned ticket artifacts are the entire handoff.

## Enforce the loop

1. RED: the implementer changes tests or a deterministic check first, leaves
   production untouched, runs the focused command, and records the intended
   non-zero failure. The trusted controller must freeze the RED revision and
   record a SHA-256 digest for every changed test/check file before dispatching
   the same round for GREEN.
2. GREEN: the implementer makes the smallest compliant production change and
   records the focused passing command.
3. REFACTOR: the implementer improves the code only while tests remain green,
   then runs every relevant gate currently available.
4. CANDIDATE: the trusted primary controller commits code, tests, and redacted
   logs, then the orchestrator records that commit ID in a later
   ticket-metadata-only commit.
5. REVIEW: a fresh reviewer inspects the exact candidate through all six lenses
   and returns either APPROVED or CHANGES_REQUESTED.
6. REWORK: the orchestrator writes each actionable finding to a new dispatch
   packet. A fresh implementer first reproduces it with a failing regression
   test or static check, fixes it, and produces a new candidate. A fresh
   reviewer reviews that candidate from scratch.
7. ACCEPT: the orchestrator independently reruns applicable focused and full
   gates, verifies the reviewer covered the exact candidate, validates ticket
   evidence, and accepts only with zero open actionable findings.
8. INTEGRATE: merge only the reviewed candidate. After integration, run the
   aggregate suite. Any conflict resolution or post-review code change creates a
   new candidate and returns to RED/REVIEW as applicable.

Do not skip RED because a change looks small. Documentation, configuration,
architecture, and migration tickets need a failing validator, contract test,
schema test, or executable probe before their change. A behavior-preserving
refactor starts from characterization tests and must not introduce new behavior.

## Parallel delivery

Parallelize only tickets with disjoint ownership and satisfied dependencies. Use
a separate Codex chat and Git worktree per ticket. Keep the integration chat
focused on dependency decisions, ticket state, reviewed revisions, merges, and
aggregate results. Rebase or merge the latest integration branch into a stale
candidate, resolve conflicts in a fresh implementation round, and review again.
Start each ticket as a top-level task rooted in its worktree; spawned agents
inherit the parent checkout and cannot be assigned an arbitrary sibling
worktree. A trusted primary controller performs Git metadata operations instead
of broadening child sandboxes.

## Stop conditions

Continue without asking for routine implementation choices. Pause only for an
unresolved product or architecture decision, missing external authority or
credential, an out-of-scope destructive action, or the same blocker surviving
three independent attempts. Record the blocker and evidence before pausing.
