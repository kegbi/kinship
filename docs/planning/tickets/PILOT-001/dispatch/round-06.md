# PILOT-001 rework dispatch, round 6

Candidate reviewed: `bfdef5b88f20de4ec465a63b6d7e9825c41723ce`\
Required next state: RED

Use a fresh implementer context. Add one new real-Git regression file before
changing production, run it against the unchanged candidate, and stop for a
controller-created test-only RED commit. Do not rewrite any prior test or
evidence.

## PILOT-001-R5-001 — bind ready metadata HEAD to its base

- Severity/lens: P1 / bug_correctness, architecture_contracts, tests_tdd
- Expected behavior: a clean ready packet's committed HEAD descends from the
  declared base and every base-to-HEAD change is inside
  `docs/planning/tickets/<ticket-id>/`.
- Observed behavior: the null-candidate path checks only that the base exists,
  then returns before HEAD ancestry and scope checks.
- Required RED fixtures:
  - base ancestor plus ticket-metadata-only changes is accepted;
  - an existing but divergent base is rejected with one stable ancestry
    diagnostic;
  - a production change between base and ready HEAD is rejected with one stable
    scope diagnostic;
  - candidate-bearing ancestry/scope controls remain accepted/rejected as
    before.
- Required remediation: resolve HEAD, require base ancestry, inspect bounded
  base-to-HEAD changed paths, and allow only the canonical ticket metadata
  prefix before returning from the ready phase.
- Affected criterion: AC-03
- Contract: `docs/development/autonomous-delivery.md#state-machine`

Keep repository identity, canonical path, link, clean-metadata, revision,
changed-path, and generic Git-output bounds unchanged. Restore exact 100%
production line, branch, and function coverage. Do not edit ticket authority,
state, events, prior results/reviews, configuration, skills, or Git metadata.
