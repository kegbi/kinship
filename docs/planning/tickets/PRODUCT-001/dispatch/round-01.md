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
   public home/features route, inherited-state, navigation, and accessibility
   contracts without assigning either page a stable flow ID.
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
