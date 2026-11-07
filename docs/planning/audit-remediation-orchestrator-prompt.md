# Orchestrator prompt for the audit remediation plan

Paste everything below the horizontal rule into a new Claude Code session
started at the repository root. Edit the Parameters block first.

---

You are the controller for `docs/planning/audit-remediation-plan-2026-11-07.md`.
Its 41 tickets, in ten lanes, close every finding of the audit in
`docs/validation/audit-2026-11-07/`.

Run independent tickets in parallel:

- Every ticket gets a fresh implementer, in its own isolated checkout.
- Every candidate gets a fresh read-only reviewer.
- You own scheduling, git, gates, and integration. You never write production
  code yourself.

## Parameters

- INTEGRATION_BRANCH: the branch checked out in your working directory. It must
  contain the audit commit `95611424` and the commit that added the plan.
- MAX_PARALLEL: `4` implementers at once. Reviewers do not count.
- IMPLEMENTER_MODEL and REVIEWER_MODEL: `opus`.
- MAX_REVIEW_ROUNDS: `2` per ticket.
- STOP_AFTER: `all`, a ticket ID, or a number of integrated tickets.
- DECISIONS: approved by the product owner on 2026-11-07 and recorded in Part 3
  of the plan. Do not ask about them again.
  - D1 = B: only `/privacy` and `/terms` render on demand; the five former
    on-demand routes become static
    ([ADR 0007](../architecture/decisions/0007-on-demand-rendering-only-for-request-time-content.md),
    AUD-G5).
  - D2 = Approve: least-privilege database roles, workspace-bound foreign keys,
    and forced row-level security, in schema v14
    ([ADR 0008](../architecture/decisions/0008-database-enforced-workspace-isolation.md),
    AUD-V2).
  - D3 = Avatars only: avatar content gets `private, max-age=86400, immutable`;
    JSON and documents stay `private, no-store` (AUD-K7).
  - D4 = Compress, except secrets: gzip JSON and SVG, excluding secret-bearing
    responses and the credential endpoints (AUD-G2).
  - D5 and D6 keep the plan's standing defaults.

## Read once, then keep in context

1. Read these completely: `AGENTS.md`,
   `docs/development/autonomous-delivery.md`, and
   `.agents/skills/run-tdd-ticket-loop/SKILL.md`.
2. Read Parts 1, 2, 3, and 5 of the plan, and
   `docs/validation/audit-2026-11-07/README.md`.

Do not read the five area reports or any subagent transcript yourself;
implementers read the sections their ticket cites. Summarize subagent reports
rather than pasting them.

## Preconditions

- **Clean tree, plan present.** `git status --short` is empty, and
  `git log -1 --format=%h -- docs/planning/audit-remediation-plan-2026-11-07.md`
  prints a commit. If the plan is missing, run
  `git merge --ff-only t3/backend-security-performance-audit`. If that is not a
  fast-forward, stop and ask.
- **Docker.** `docker info` succeeds. Never stop, rebuild, or reuse a Docker
  project you did not create; the user runs their own, such as
  `kinship-local-*`. `deno task test:e2e` creates and removes its own projects.
- **Dependencies.** Run `deno task deps:deno` and `deno task deps:node` once in
  your working directory.
- **Baseline.** On INTEGRATION_BRANCH, run `deno task fmt:check`,
  `deno task lint`, and `deno task check`. Record a failure that matches a REL
  item in Parked Work of `docs/planning/active-delivery.md` as known. Stop on
  any other failure.

## Scheduling

A ticket is ready when all of these hold:

- it is unchecked;
- every ticket in its Depends line is integrated;
- its gate, if it has one (AUD-Q4), allows it.

Keep up to MAX_PARALLEL implementers running. Start ready tickets in priority
order (urgent, high, normal, low), and in plan order within a priority. Two
tickets may run at once unless one depends on the other. Use Part 5 of the plan
for files that unchained tickets share.

Only one V ticket may run at a time. While it runs, no other ticket may change
`personal-crm-schema/`, `packages/backend/platform/postgres/generated/`, or
`tools/migrations/`.

**Decisions.** D1–D4 are decided (see Parameters), so no ticket waits for the
user. The implementers of AUD-K7, AUD-G2, AUD-G5, and AUD-V2 apply the recorded
decision and the ADR it names; they do not reopen it. If a ticket turns out to
need a decision that Part 3 does not contain, stop that ticket and ask.

Wait for completion notifications. Do not poll, sleep, or watch.

### 1. Start a ticket

1. Give the implementer its own checkout, created from the current head of
   INTEGRATION_BRANCH, with your harness's worktree isolation:
   - T3 Code: `delegate_task` with `isolation: "worktree"`.
   - Claude Code: the Agent tool with `isolation: "worktree"`, in the
     background.
   - Only if the harness has no isolation:
     `git worktree add .worktrees/AUD-XN -b aud/AUD-XN <INTEGRATION_BRANCH>`
     (`.worktrees/` is git-ignored).
2. Record the checkout path, the branch, and the base SHA.
3. Give the implementer this prompt, with the placeholders filled:

```text
You are the sole implementer for ticket AUD-XN in the checkout at <path>,
based on <base SHA>. Work only inside that directory. Never run git commands
that write (add, commit, stash, checkout, reset, branch, worktree, rebase);
read-only git is fine. Do not tick the plan's checkboxes. Do not create
evidence, notes, or packet files.

1. Confirm that `git rev-parse HEAD` is <base SHA>; if not, stop and report.
   Then run `deno task deps:deno` and `deno task deps:node`.
2. Read <path>/AGENTS.md, <path>/docs/development/autonomous-delivery.md,
   Parts 1 and 2 of <path>/docs/planning/audit-remediation-plan-2026-11-07.md,
   and the audit report sections this ticket cites (under
   <path>/docs/validation/audit-2026-11-07/). Do not re-audit.
3. The ticket, verbatim:

<paste the full ticket block>

<For AUD-K7, AUD-G2, AUD-G5, or AUD-V2: "This ticket implements decision
D<n> = <option>, recorded in Part 3 of the plan and in <ADR path, if any>.
Read both before starting; apply the decision exactly and do not reopen it.
When done, update the ADR's status line as the ticket says.">

Protocol:
- RED first: write the ticket's failing test and observe it fail for the
  intended reason.
- GREEN: make the smallest change that complies with the architecture.
- REFACTOR while the focused tests stay green.
- In the inner loop, run only the focused test and the cheapest affected check.
- When behavior is stable, run the ticket's Verify list plus `deno task fmt`,
  `deno task lint`, and the affected `check:*` tasks.
- After a contract change, run `deno task contracts:generate` and then
  `deno task contracts:check`.
- Run the all-browser E2E matrix only if the ticket says so.
- Do not fix unrelated failures; report them.
- Keep coverage of the changed production scope at or above 80% for lines,
  branches, and functions.

Hard constraints:
- The schema stays at v12 unless this is a V ticket.
- Mutations go through the owning module's public facade.
- Read models stay read-only.
- apps/web never imports packages/backend.
- Everything in Part 1.1 of the plan stays true.
- Stay inside Scope and respect Non-goals.
- After two failed approaches to the same problem, stop and report.

Finish with this report and nothing after it:
- Outcome: DONE | BLOCKED(reason)
- Changed paths
- RED evidence: the test's name and the failure observed before the fix
- Commands: each with its exit code and a one-line result (counts, coverage)
- Verify list: each item, pass or fail
- Risks and open questions, or "none"
```

### 2. Make the candidate

When the implementer reports DONE:

1. Run `git -C <path> status --short` and `git -C <path> diff --stat`. Send the
   work back to the implementer if it contains any of these:
   - a path outside the ticket's scope;
   - an evidence or notes file;
   - a schema change in a non-V ticket;
   - an edit to the plan's checkboxes.
2. Create exactly one commit in the checkout: `git -C <path> add -A`, then
   `git -C <path> commit -F <message file>`. The message is
   `<type>(<scope>): <imperative summary> [AUD-XN]`, a blank line, two to five
   lines on what changed and why, a blank line, and then the attribution line
   your harness specifies, for example
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### 3. Review

Start a fresh read-only reviewer (REVIEWER_MODEL; no file edits; no git writes).
Give it:

- the ticket block;
- Parts 1 and 2 of the plan;
- `AGENTS.md` and `autonomous-delivery.md`, by path;
- the base and candidate SHAs;
- the output of `git -C <path> diff <base>..HEAD`;
- the implementer's command evidence.

It may run the ticket's focused tests in the checkout. It checks:

- correctness against the ticket;
- security and tenant boundaries: workspace scoping holds, no permission is
  widened, and no Part 1.1 property is weakened;
- architecture and contracts (`AGENTS.md`, `module-boundaries.yaml`);
- that the RED test discriminates: it fails on the base and passes on the
  candidate;
- coverage of the changed scope;
- no unrelated refactors, no dead code, and no skipped tests.

It returns findings (severity, file:line, evidence, required fix), followed by
`APPROVED` or `CHANGES_REQUESTED`.

**On CHANGES_REQUESTED with rounds left:**

1. Return the findings, each with its expected regression test, to the same
   implementer if your harness can continue it. Otherwise, start a new
   implementer in the same checkout with the findings.
2. Amend the single candidate commit:
   `git -C <path> add -A && git -C <path> commit --amend --no-edit`.
3. Send the amended diff and the previous findings to the reviewer for a
   re-check. Use the same reviewer if your harness can continue it; otherwise,
   start a new one and give it the previous findings.

**With no rounds left:** leave the checkout in place, report to the user, and
stop scheduling that lane.

### 4. Integrate, one candidate at a time

1. Run `git -C <path> rebase <INTEGRATION_BRANCH>`. On a conflict, run
   `git -C <path> rebase --abort`, then send the implementer a rebase-only
   amendment: "make the change apply on <new base SHA>; resolve conflicts only".
   The reviewer re-checks the rebased diff.
2. In the checkout, rerun the ticket's Verify list, `deno task fmt:check`, and
   `deno task lint`. Also run `contracts:check` or `check:architecture` if the
   ticket touched contracts or imports.
3. Tick the ticket's checkbox in the plan, add its one evidence line
   (`Delivered <date>: <tests>, <coverage>, <gates>.`), and amend that into the
   candidate. Nothing else may change at this step.
4. In your working directory, run `git merge --ff-only <candidate branch>`. If
   it is not a fast-forward, return to step 1.
5. Remove the checkout and delete the merged branch, unless the harness cleans
   them up itself.
6. Print `AUD-XN integrated as <short sha>: <summary>`.

Never push, never force anything, never rewrite integrated history, and never
delete a branch that has unmerged work.

### 5. Checkpoints

Run checkpoints C1, C2, and C3 (Part 2.3 of the plan) once their tickets are
integrated, and run AUD-P2 last.

A failure gets one bounded reproduction:

- If these tickets caused it, append `AUD-XN-fix` under that ticket in the plan
  and run it through the same loop.
- If it is unrelated, add a REL item to Parked Work in
  `docs/planning/active-delivery.md`, as its own docs-only candidate reviewed
  like any other, and continue.

### 6. Stop conditions

Stop scheduling and report to the user when any of these holds:

- STOP_AFTER is reached, or AUD-P2 is integrated;
- a ticket needs a decision the plan does not contain;
- a candidate has used up MAX_REVIEW_ROUNDS;
- a checkpoint still fails after one corrective ticket;
- git or a checkout is in an unexpected state;
- the work would need a destructive action outside a ticket's scope.

Let running implementers finish, and leave their candidates unmerged.

### 7. Final report

Give a compact table with:

- each ticket's status: integrated (with its SHA), blocked (with the reason), or
  not started;
- the decisions taken;
- the checkpoint results;
- where AUD-P2's closure table lives.

Do not paste subagent reports.
