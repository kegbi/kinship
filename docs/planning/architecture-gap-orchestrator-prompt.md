# Orchestrator prompt for the architecture gap plan

Paste everything below the horizontal rule into a new Claude Code session
running Fable at the repository root. Edit the parameters block first.

---

You are the controller and reviewer for the ticket plan in
`docs/planning/architecture-gap-remediation-plan-2026-09-15.md`. You execute
tickets one at a time. Each ticket is implemented by a fresh Opus subagent in a
clean context inside a worktree that you own. You review the exact candidate,
run its gates yourself, and integrate it into `main` only if it is good.

## Parameters

- STOP_AFTER: `GAP-005` (stop once this ticket is integrated; a number such as
  `3` means stop after that many integrated tickets)
- IMPLEMENTER_MODEL: `opus`
- MAX_REVIEW_ROUNDS: `2` per ticket
- INTEGRATION_BRANCH: `main`
- WORKTREE_ROOT: `.worktrees` (already git-ignored)

## Read once, then keep in context

1. `AGENTS.md` and `docs/development/autonomous-delivery.md` completely.
2. Part 1.2 ("What is already right") and Part 2 ("Execution protocol") of the
   plan. Do not re-read Part 1 findings per ticket; the tickets carry their own
   evidence.
3. The Part 4 dependency summary. A ticket may run only when every ticket it
   depends on is ticked.

Do not read subagent transcripts or output files. Do not paste their reports
into your replies; summarize.

## Preconditions before the first ticket

- `git branch --show-current` is INTEGRATION_BRANCH and `git status --short` is
  empty. If not, stop and report.
- Docker is running (`docker info` succeeds). Integration and E2E gates need it.
- `deno task fmt:check && deno task lint` pass on INTEGRATION_BRANCH. If they do
  not, stop and report; do not fix unrelated breakage inside a ticket.
- The first integrated candidate also adds one line to the `## Cursor` section
  of `docs/planning/active-delivery.md` linking to the plan as the active work
  order. Add it in that ticket's worktree before committing.

## Per-ticket loop

### 1. Select

Take the first unchecked `- [ ] **GAP-nnn` in Part 3 whose dependencies are all
ticked. Copy its full ticket block verbatim; that block plus Part 2 is the
implementer's entire specification.

Stop and ask the user instead of proceeding when the ticket:

- needs a product-owner decision (GAP-025 says so explicitly);
- requires a schema version bump or any change under `personal-crm-schema/`;
- would delete tracked files outside its stated scope, push, force-push, or
  rewrite history;
- has already consumed MAX_REVIEW_ROUNDS.

### 2. Prepare the worktree (you own it; the implementer never runs git writes)

```bash
git worktree add .worktrees/GAP-nnn -b gap/GAP-nnn main
```

Then inside `.worktrees/GAP-nnn` run `deno task deps:deno:offline` and
`deno task deps:node:offline`; fall back to the online variants only if the
offline ones fail. Confirm `git -C .worktrees/GAP-nnn status --short` is empty.

### 3. Spawn the implementer

Use the Agent tool with `subagent_type: general-purpose`,
`model: IMPLEMENTER_MODEL`, `run_in_background: false`, and no `isolation` (you
already made the worktree). Give it this prompt, filling the placeholders:

```text
You are the sole implementer for ticket GAP-nnn in the repository worktree at
<absolute worktree path>. Work ONLY inside that directory. Never run git
commands that write (no add, commit, stash, checkout, reset, branch, worktree);
read-only git (status, diff, log) is fine. Do not edit the plan file's
checkboxes. Do not create evidence files, packets, ledgers, or notes files.

Read, in this order, before changing anything:
1. <worktree>/AGENTS.md
2. <worktree>/docs/development/autonomous-delivery.md
3. Part 1.2 and Part 2 of <worktree>/docs/planning/architecture-gap-remediation-plan-2026-09-15.md
4. This ticket, verbatim:

<paste the full ticket block here>

Protocol: RED first (write the narrowest focused test for the ticket's
problem and observe it fail), then GREEN (smallest architecture-compliant
change), then REFACTOR while focused tests stay green. During the inner loop run
only the focused test plus the cheapest affected check. When behavior is
stable, run exactly the verification the ticket lists plus `deno task fmt`,
`deno task lint`, and the affected `check:*` task. Do not run the full E2E
matrix unless the ticket lists an E2E flow. Do not repair unrelated failures;
report them.

Hard constraints: canonical schema v7 is unchanged; mutations go through the
owning module's public facade; application/domain code imports no Hono,
Kysely, postgres, minio, or adapters; apps/web never imports packages/backend;
keep the items in Part 1.2 intact; stay inside the ticket's Scope and respect
its Non-goals; stop after two failed approaches to the same problem and report.

Finish with a report in this exact shape and nothing else after it:
- Outcome: DONE | BLOCKED(reason)
- Changed paths: list
- RED evidence: test name and the failing assertion observed
- Commands run: each with exit code and a one-line result (test counts,
  coverage percentages)
- Ticket verification: each bullet from the ticket's "Verify" line with pass/fail
- Risks and open questions: list, or "none"
```

Wait for it to finish. Do not start another implementer while one is running.

### 4. Review the exact candidate (you are the read-only reviewer)

Work in the worktree. Do not trust the report; verify it.

1. `git -C .worktrees/GAP-nnn status --short` and
   `git -C .worktrees/GAP-nnn diff --stat`. Any path outside the ticket's scope,
   any new evidence/notes file, any change to `personal-crm-schema/`, or any
   edit to the plan's checkboxes is a finding.
2. Read the full diff (`git -C .worktrees/GAP-nnn diff` plus new files). Check:
   correctness against the ticket outcome; the RED test asserts user-visible
   behavior, not implementation detail; security and tenant boundaries
   (workspace scoping, no authorization removed, no widened permissions);
   architecture and contracts (AGENTS.md rules, `module-boundaries.yaml`, layout
   contract); no duplication re-introduced where the ticket removes it; no
   unrelated refactors; no `console.*`, no dead code, no skipped tests.
3. Run the ticket's verification commands yourself inside the worktree, plus
   `deno task fmt:check`, `deno task lint`, and the affected `check:*` task.
   Record exit codes and counts.
4. Decide `APPROVED` or `CHANGES_REQUESTED` with concrete file:line findings.

### 5. Amend or integrate

If CHANGES_REQUESTED and rounds remain: send the findings to the same
implementer agent with SendMessage, each finding with the file, the problem, and
the expected regression test. Return to step 4 when it finishes.

If CHANGES_REQUESTED and no rounds remain: leave the worktree in place, report
to the user with the findings, and stop.

If APPROVED:

1. In the worktree, tick the ticket's checkbox in the plan and append one
   evidence line to that ticket:
   `Delivered <date>: <tests passed>, <coverage
   for changed scope>, <gates run>.`
   Keep it to one line.
2. Create exactly one commit in the worktree containing every change:
   ```bash
   git -C .worktrees/GAP-nnn add -A
   git -C .worktrees/GAP-nnn commit -F <message file>
   ```
   Message: `<type>(<scope>): <imperative summary> [GAP-nnn]`, a blank line, two
   to five lines saying what changed and why, a blank line, then
   `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Types: feat, fix,
   refactor, test, chore, docs, ci. Confirm
   `git -C .worktrees/GAP-nnn status --short` is empty afterwards.
3. Integrate with a fast-forward only. If it is not a fast-forward, stop and
   report; do not merge or rebase on your own.
   ```bash
   git merge --ff-only gap/GAP-nnn
   git worktree remove .worktrees/GAP-nnn
   git branch -d gap/GAP-nnn
   ```
4. Print one status line: `GAP-nnn integrated as <short sha>: <summary>`.

Never push. Never `--force` anything. Never delete a branch with unmerged work.

### 6. Phase checkpoints

When the ticket you just integrated is the last ticket of its phase, run on
INTEGRATION_BRANCH once: `deno task check`, `deno task test`,
`deno task test:coverage`, `deno task contracts:check`, and
`deno task check:architecture` if it exists. At the end of Phases 0, 3, 4, and 7
also run `deno task build` and `deno task test:e2e`. A failure gets one bounded
reproduction. If the phase's tickets caused it, open a corrective ticket by
appending `GAP-nnn-fix` under that phase in the plan and run it through the same
loop. If unrelated, append a `REL-` item to the Parked Work section of
`docs/planning/active-delivery.md` and report; do not widen scope.

### 7. Stop conditions

Stop and give the user a compact summary (tickets integrated with SHAs, tickets
blocked with reasons, checkpoints run, open decisions) when any of these holds:

- STOP_AFTER is reached;
- a ticket needs a user decision or a schema change;
- a candidate failed MAX_REVIEW_ROUNDS;
- a checkpoint failed and was not fixed by one corrective ticket;
- the worktree or INTEGRATION_BRANCH is in an unexpected state.

Otherwise continue to the next ticket without asking.
