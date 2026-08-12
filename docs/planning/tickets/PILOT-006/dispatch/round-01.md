# PILOT-006 initial RED dispatch, round 1

Authoritative input base: `6c6ea8313f0472c315079a605c50cd2548d2835b`\
Required next state: RED\
Controller run ID:
`PILOT-006/orchestrator/r0/00000000-0000-4000-8000-000000000601`\
Implementer run ID:
`PILOT-006/implementer/r1/00000000-0000-4000-8000-000000000602`\
Execution class: `ordinary`

Before changing the delivery contract, add only
`tools/workflows/pilot006/persistent_desktop_provenance_test.ts` and the concise
RED log. Parse `deno.json` and prove both canonical workflow tasks discover
`tools/workflows`. Then require the following four paragraphs as one exact
contiguous, whitespace-normalized block occurring exactly once in Worktrees,
Branches, and Threads:

> Every persistent desktop pilot has exactly one top-level Codex ticket task and
> exactly one corresponding opaque `ticketTaskId`. `integration.md` records that
> ID exactly once. Implementer and reviewer executions are roles of that ticket
> task and do not create, replace, or count as additional ticket-task
> identities.

> For every implementer or reviewer execution, `integration.md` separately
> records exactly one fresh controller-issued `implementerRunId` or
> `reviewerRunId`, as applicable, and exactly one opaque `worktreeRef`. The
> `ticketTaskId`, the ticket's `controllerRunId`, and all implementer and
> reviewer run IDs are mutually distinct; a task ID never substitutes for a run
> ID or vice versa.

> All persisted task, controller, role-run, and worktree identifiers are opaque
> stable identifiers. A `worktreeRef` is a controller-issued alias of the form
> `worktree:<ticket-id>:<ordinal>`. No persisted identifier or reference
> contains an absolute or repository-relative filesystem path, a `..` segment,
> or user, profile, personal, client, credential, secret-bearing, or other
> sensitive topology information. Within one pilot, two executions use the same
> physical worktree if and only if they record the same `worktreeRef`; distinct
> physical worktrees always use distinct references. Once issued, an alias is
> never rebound to another worktree.

> Sequential role executions may reuse one physical worktree and its
> `worktreeRef`, or use distinct ones. Concurrent write-enabled executions must
> use distinct physical worktrees and distinct references. Reviewers remain
> read-only; a reviewer may share a worktree with another read-only execution,
> but never with an active write-enabled execution.

Run with read access only to `deno.json` and the delivery document. Valid RED
fails solely because this exact policy block is absent; discovery assertions
must already pass. Stop for the controller to freeze the revision and test
SHA-256 before production changes.
