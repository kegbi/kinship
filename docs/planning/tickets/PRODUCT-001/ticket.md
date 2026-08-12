# PRODUCT-001: Accept the DG-07 release and milestone contract subset

Status: review, round 1\
Owner: trusted top-level orchestrator\
Base revision: `603f6621809f61fab70bc29b8b4a9252ebcecb27`\
Execution class: `ordinary`\
Depends on: none

## Outcome

The authoritative release-slice contract and subordinate planning documents
consistently record the explicitly approved PRODUCT-001 slice ownership and
catalog-derived milestone meanings without changing catalog IDs, resolving
deferred product gaps, or claiming any application flow delivered.

## Decision authority

The user explicitly approved this documented recommendation on 2026-08-12 as a
local, safe, reversible-before-implementation, credential-free, and
spending-free product-contract choice. No unresolved decision remains inside
this bounded assignment.

## In scope

- Accept the exact Slice 1, Slice 2, and Slice 6 flow/shell/page ownership in
  `ticket.json`.
- Accept all eight milestone meanings and derive their current cuts from the
  accepted catalogs rather than a fixed flow count.
- Synchronize only the authoritative release summary and the necessary
  subordinate planning status, roadmap, traceability, and current counts.
- Add one bounded deterministic release-contract test under
  `tools/product/PRODUCT-001/`.

## Out of scope and follow-up gates

The complete exclusions are authoritative in `ticket.json`. In particular,
PRODUCT-001 does not decide life-event catalog coverage, operations UI,
`page.flowIds` semantics, inherited states, multi-workspace, security settings,
avatars, help/what-is-new, saved filters, external API parity, P2 availability,
romantic metadata, or optional-source imports. It adds no stable ID and delivers
no application behavior.

## Accepted contracts

- `AGENTS.md#product-and-user-flow-contract`
- `docs/product/release-slices.md`
- `docs/product/user-flows.yaml`
- `docs/product/page-catalog.yaml`
- `docs/planning/README.md#milestone-definitions`
- `docs/planning/roadmap.md#decision-gates`
- `docs/planning/traceability.md#flow-to-slice-matrix`

## Acceptance criteria and RED proof

`ticket.json` contains the four stable acceptance criteria and their exact RED
proofs. Round 1 must first add only the focused deterministic contract test and
its concise RED log. Catalog-extraction/self-consistency controls must pass;
only assertions discriminating the base release/planning contradictions may
fail. Production contract files remain unchanged until the controller freezes
and hashes that RED revision.

## Required gates

- Focused PRODUCT-001 deterministic contract test.
- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task test:workflow`
- `deno task ticket:validate docs/planning/tickets/PRODUCT-001`

## Risks

The packet's authoritative risk list covers split atomic flows, hard-coded
milestone drift, accidental catalog decisions, false delivery/readiness claims,
and weak Markdown discrimination. This ticket adds no runtime, tenant, personal
data, external-service, credential, or spending behavior.

## Unresolved decisions

None inside PRODUCT-001. The explicitly deferred product gaps above remain
follow-up gates and are not silently resolved.
