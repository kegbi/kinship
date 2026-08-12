# FND-003 RED retry dispatch, round 1

Authoritative input base: `895731f27f66d614cb431e9ab6bb570b94d1a476`\
Committed ready packet: `a812440a45427ec72f5ff4eaeca30af88a3270be`\
Required next state: valid RED, then stop\
Controller run ID:
`FND-003/orchestrator/r0/b308fcda-6e91-4fec-8b40-bf19c6e21a16`\
Fresh implementer run ID:
`FND-003/implementer/r1/f04996a4-92e8-48b8-94af-e0f2b5f854ac`\
Execution class: `ordinary`\
Worktree reference: `worktree:FND-003:1`

Read only the sources authorized by `dispatch/round-01.md`, this retry, and the
existing uncommitted RED check and failed-attempt log. The first execution under
`FND-003/implementer/r1/a5eca5bd-4ec8-4aad-be03-e683b901d72d` produced a
truthful focused failure but did not satisfy the mandatory exact coverage gate:
99.73% lines, 98.21% branches, and 100% functions. It therefore granted no GREEN
authority and must not become the authoritative RED evidence.

Preserve `docs/planning/tickets/FND-003/evidence/round-01-red.log` byte-for-byte
as the failed-attempt record. Write the valid retry evidence to
`docs/planning/tickets/FND-003/evidence/round-01-red-retry.log`.

## Narrow retry authority

Remain entirely in RED. Modify only
`tools/runtime/FND-003/runtime_graph_contract_test.ts` and the new retry log. No
fixture is currently justified. Do not edit a manifest, lock, `.npmrc`, pin
record, validation report, ticket authority/state/event file, accepted contract,
schema, catalog, application path, protected control path, or any other file.

Make the smallest test-only correction that preserves all existing positive and
negative discrimination while obtaining truthful exact 100% line, branch, and
function coverage:

- remove any coverage-ignore directive; coverage exclusions are not authorized;
- exercise the real repository-test wrapper in the coverage run even though its
  one intended assertion exits non-zero, and separately run/report the coverage
  threshold against the emitted profile;
- replace synthetic rejected-reader constructs that create untaken V8 callback
  branches with direct deterministic injected readers whose actual throw paths
  execute and remain fully attributable; and
- do not weaken, delete, skip, filter away, reverse, or over-mock the real
  repository assertion or any required control.

If Deno does not emit usable coverage after the intentional non-zero repository
test, use two deterministic runs into one disposable coverage profile: one that
covers every helper/control path and one that executes the real wrapper. The
combined profile must still bind to the exact same check bytes and must reach
100/100/100 without ignore directives or source exclusions.

Run the exact focused command from `round-01.md` and require the same sole
repository failure. Run direct format, lint, and type checks. Run exact coverage
from a disposable directory outside the repository. Then rerun the applicable
root tasks and ticket validation. Every gate except the intentionally RED
focused test must exit zero.

Record exact commands, exits, the 100/100/100 report, concise intended failure,
changed paths, and empty production-file list in the retry log. Stop without
committing or beginning GREEN. Return the fresh run ID and repeat
`issuedByControllerRunId` exactly.
