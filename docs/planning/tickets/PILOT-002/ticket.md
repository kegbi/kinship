# PILOT-002: Document protected control-path routing

Status: accepted\
Owner: orchestrator\
Base revision: `de45825cf6a087e98a9fdb0338176ad6d82ad2a8`\
Depends on: none\
Accepted candidate: `405209c6f224f1c3c398bcd4043fac022f016e78`

## Outcome

The autonomous-delivery protocol explicitly identifies `.git`, `.codex`, and
`.agents` as protected control paths for ordinary ticket work and routes any
required change to a trusted top-level maintenance context.

## In scope

- Add one static workflow contract assertion first.
- Add the exact protected-path routing guidance to
  `docs/development/autonomous-delivery.md` only after RED is frozen.

## Out of scope

- Runtime sandbox or ticket-validator enforcement.
- Changes to `.git`, `.codex`, `.agents`, agent definitions, skills, templates,
  tasks, or application code.

## Accepted contracts

- `AGENTS.md#mandatory-change-method`
- `docs/development/autonomous-delivery.md#feature-implementer`
- `docs/development/autonomous-delivery.md#worktrees-branches-and-threads`

## Acceptance criterion

- AC-01: The two required protected-path statements are present and locked by a
  static contract test whose exact RED blob remains unchanged through the
  candidate.

## Required RED proof

Run `deno test --allow-read tools/workflows/workflow_assets_test.ts`. Existing
tests pass and the new assertion fails only because the guidance is absent.

## Required gates

- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task test:workflow`
- `deno task test:workflow:coverage`
- `deno task ticket:validate docs/planning/tickets/PILOT-002`

## Risk

The text must say explicitly that it documents authority routing and does not
claim project configuration can override Codex sandbox enforcement.

## Unresolved decisions

None.
