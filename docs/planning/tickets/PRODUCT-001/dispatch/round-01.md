# PRODUCT-001 initial RED dispatch, round 1

Authoritative ticket base: `603f6621809f61fab70bc29b8b4a9252ebcecb27`\
Required next state: RED\
Controller run ID:
`PRODUCT-001/orchestrator/r0/68950167-ba0d-4262-bf70-2f962d862fa0`\
Implementer run ID:
`PRODUCT-001/implementer/r1/22c02056-b1f4-45fc-ac07-95dc89cfd5ba`\
Execution class: `ordinary`

## RED-only assignment

Before editing any product or planning contract, add only the narrowest
deterministic release-contract test under `tools/product/PRODUCT-001/` and the
concise redacted `evidence/round-01-red.log`. The test must run from the project
root with read access only to the product/planning inputs it actually consumes.

The harness must first self-check that it truthfully extracts the accepted
catalogs: unique flow and page identities, all current flow priorities and
delivery defaults, the current priority totals, the public home/features route
contracts with empty `flowIds`, and the flow-to-slice inputs needed for
milestone derivation. These controls must pass at RED.

Then require the exact approved contract:

1. Slice 1 owns complete `AUTH-001` through `AUTH-004`, `WORKSPACE-001`,
   `PEOPLE-001`, and `PEOPLE-002`; it starts only a typed, still-planned
   `PEOPLE-003` shell; it owns workspace/member settings and the cataloged
   public home/features route, current `ready`/`not-found` state, navigation,
   and accessibility contracts without assigning either page a stable flow ID.
2. `PEOPLE-004` stays one atomic edit/archive/restore/delete mutation flow and
   is completed only in Slice 2. Slice 1 has no fictional read-only subset.
3. Complete `PEOPLE-003` is accepted in Slice 6 only after every enabled core
   person section exists.
4. The eight milestone meanings in `ticket.json` are accepted. The validator
   derives priority-based milestone membership and the maximum required slice
   from the current catalogs and traceability mapping; it must not encode a
   fixed flow count as milestone authority. With the current accepted catalog,
   Proposed MVP and Core feature complete both fall after Slice 7, while Core
   alpha falls after Slice 4 and Production ready remains independent.
5. Planning status, roadmap decision control, traceability wording, and
   catalog-derived counts agree with that accepted subset, while all 30 current
   flows remain planned and neither public product page gains a flow ID.
6. The contract explicitly preserves the deferred follow-up gates listed in
   `ticket.json` without choosing any branch or adding a stable ID.

The check must not interpret the current public-state catalog shape as deciding
the deferred semantics of state inheritance. PRODUCT-001 records the current
public states only; their inheritance behavior remains a later product gate.

At RED, the catalog extraction/self-checks must pass and the focused command
must fail only because the unchanged base release/planning prose still presents
these approved allocations and milestone meanings as proposals or contradictory
accepted text. Record the exact command, non-zero exit, passing controls,
intended contract failures, changed test/check path, and exact formatted-file
SHA-256 in the RED log, then stop. Do not edit `docs/product/release-slices.md`,
any planning contract, either YAML catalog, or ticket authority/state metadata.

## GREEN/REFACTOR constraints retained for controller resume

- The controller must first reproduce RED, freeze a test/check-only commit, and
  independently hash every changed test/check file.
- Resume this same implementer round only after receiving that immutable RED
  revision and digest.
- GREEN may make the smallest synchronized edits only to the four authorized
  product/planning Markdown files. Do not edit either YAML catalog because the
  current IDs, priorities, routes, and empty public-page `flowIds` already match
  the approved choice.
- Remove proposal/accepted contradictions without falsely marking flows
  delivered, and leave every deferred gap explicit.
- REFACTOR only while the focused check and affected repository gates remain
  green. Return evidence; do not commit, review, accept, push, deploy, or merge.

## Controller GREEN resume

The trusted controller independently reproduced the dispatched RED result and
froze it before authorizing production-contract changes:

- RED revision: `367de245484347847e1914c2c48e91d4356885bf`
- Focused command:
  `deno test --allow-read=docs/product,docs/planning tools/product/PRODUCT-001/release_contract_test.ts`
- Focused result: exit 1; one catalog-extraction control passed and AC-01
  through AC-04 failed for the intended contract contradictions.
- Frozen check: `tools/product/PRODUCT-001/release_contract_test.ts`
- Frozen Git-blob SHA-256:
  `9aab57e93dc888fb9fd7912ffef607a12135ed45a5399efc9fe1ecba90fcdf12`
- RED production files: none.

Resume the same round and verify the frozen revision and digest before editing.
GREEN ownership is restricted to `docs/product/release-slices.md`,
`docs/planning/README.md`, `docs/planning/roadmap.md`,
`docs/planning/traceability.md`, `evidence/round-01-green.log`, and
`evidence/round-01-refactor.log`. Keep the frozen check byte-identical.

Apply the smallest coherent documentation change that satisfies AC-01 through
AC-04. Remove only PRODUCT-001 proposal/approval contradictions; keep the
planning program proposed where unrelated choices remain. Record DG-07 as
partially closed by PRODUCT-001 and keep every named deferred gap open. In
particular, remove planned Slice 6 life-event mutation/editor/proof work that
has no catalog flow, avoid promising broader security-settings or avatar
behavior, and narrow person local-action planning to flow-backed actions. Do not
change either YAML catalog, any stable ID/priority/delivery status, any task
definition, or any file outside this authorization.

Run the focused test to GREEN, then the focused format, lint, and type checks
plus the packet-required root gates that are applicable before returning the
green/refactor logs and structured result. Stop without committing or editing
ticket authority/state/events/results/reviews/acceptance metadata.
