# FND-001S: Accept and enforce the DG-01 rendering topology

Status: ready, round 0\
Owner: trusted top-level orchestrator\
Base revision: `976e01716145aa29cc8b5ab22c22210689234ecd`\
Execution class: `ordinary`\
Depends on: none\
Maximum rounds: 3

## Outcome

Accepted architecture contracts and one deterministic successor check
consistently require a private production/test Astro renderer for exactly the
cataloged on-demand routes, gateway-served static output, a separately private
API, and gateway-only public exposure. The check consumes each complete unique
canonical section and rejects every renderer-route or public-reachability
declaration outside its accepted structure.

## In scope

- Reconcile the approved DG-01 direction onto the exact current main base in
  `AGENTS.md`, ADR 0001, and the technology, Compose, configuration, and
  observability contracts.
- Require private production/test `web` for exactly the five cataloged on-demand
  ID/path pairs, gateway-served static output, `/api/v1/*` routing to private
  `api`, gateway-only host exposure, and a development-only `astro dev`
  override.
- Constrain renderer authority and define its readiness, correlation, redaction,
  and caching boundaries without claiming implementation.
- Add one self-contained, built-in-Deno successor check under
  `tools/architecture/FND-001S/` with complete-section in-memory discriminators
  and an authoritative repository assertion.

## Out of scope

- A dependency on blocked FND-001, FND-002, or PRODUCT-001; any change to the
  blocked FND-001 packet; or any blocked-lineage merge, cherry-pick, or file
  copy.
- Runtime application or Compose scaffolding, root manifests or locks, schema,
  catalogs, route assignments, module boundaries, ADR index, planning status,
  protected configuration, or unrelated documentation.
- Selecting DG-12's gateway product, config generation, forwarding, security
  headers, test TLS, adapter, runtime, package manager, ingress, or deployment
  provider.
- Push, deployment, main merge, integration, `integration.md`, or claims of
  production-image and end-to-end implementation proof.

## Accepted contracts

- `AGENTS.md#mandatory-change-method`
- `docs/development/autonomous-delivery.md#red-green-and-refactor-rules`
- `docs/architecture/decisions/0001-astro-personalized-rendering.md#decision`
- `docs/architecture/technology-baseline.md#accepted-constraints`
- `docs/architecture/technology-baseline.md#compose-topology`
- `docs/architecture/compose-contract.md#service-topology`
- `docs/architecture/compose-contract.md#network-exposure`
- `docs/architecture/configuration-and-secrets.md#client-configuration`
- `docs/architecture/observability.md#correlation`
- `docs/architecture/backend-architecture.md#http-contract`
- `docs/architecture/repository-layout.md#entry-points`
- `docs/architecture/quality-gates.md#test-first-change-contract`
- `docs/product/page-catalog.yaml` (read-only route authority)
- `docs/planning/roadmap.md#decision-gates` (DG-01's documented safe and
  reversible direction is explicitly approved for this bounded contract ticket;
  DG-12 remains excluded and open)

## Historical evidence, not a dependency

Blocked ticket FND-001 remains unaccepted and immutable. Its canonically valid
blocked tip is `8659d26cda5548483e2e8741df3efe2514d17ae1`; its reviewed but
unapproved candidate is `4b3fec5fbd36bb2d921c993b61890077301dbccd`. The blocker
at
`8659d26cda5548483e2e8741df3efe2514d17ae1:docs/planning/tickets/FND-001/evidence/round-03-max-rounds-blocker.md`
records open finding `FND-001-R1-TDD-001` and the observed route-probe result.
These Git-bound records are historical design and adversarial-test input only.

No blocked commit may be merged or cherry-picked. If wording or cases are reused
after the fresh RED freeze, the round evidence must cite exact source revision
`4b3fec5fbd36bb2d921c993b61890077301dbccd` and identify the path-limited
semantic source. The implementer must reconcile only the six authorized contract
paths onto this ticket's main base and preserve all integrated FND-002 and
PRODUCT-001 content.

## Acceptance criteria and RED proof

- AC-01: the synchronized contracts require the exact catalog-derived private
  renderer routing and gateway-only topology. Before repository assertion, the
  test proves that the canonical Gateway Routing section passes while a
  contiguous extra row, separated extra row, later contradictory prose, second
  table, missing row, duplicate row, and malformed section each fail.
- AC-02: renderer capability is limited to generated API contracts, private API
  origin, forwarded request context, and operations configuration, with no
  persistence, provider, identity-key, backend-internal, or direct-adapter
  authority.
- AC-03: renderer health/readiness, gateway dependency, correlation, redaction,
  personalized-response no-cache, and fingerprinted-static immutable-cache
  requirements are explicit without claiming implementation.
- AC-04: the single frozen check derives the route set from the unchanged page
  catalog, structurally allowlists the complete Network Exposure section,
  rejects all declared malformed and bypass cases, validates real contracts, and
  achieves exact 100% line, branch, and function coverage.

The criterion-specific RED details in `ticket.json` are authoritative. The
focused command is:

```text
deno test --allow-read=AGENTS.md,docs/architecture/decisions/0001-astro-personalized-rendering.md,docs/architecture/technology-baseline.md,docs/architecture/compose-contract.md,docs/architecture/configuration-and-secrets.md,docs/architecture/observability.md,docs/product/page-catalog.yaml tools/architecture/FND-001S/astro_rendering_topology_contract_test.ts
```

On the unchanged baseline, all in-memory discriminators must pass and only the
authoritative repository assertion may fail for missing DG-01 clauses. Every
authorized contract file must remain byte-identical during RED. The controller
freezes the test/check-only revision and exact lowercase SHA-256 before GREEN.

## Required gates

- The focused test command above.
- Exact 100% line, branch, and function coverage for the single successor check.
- Direct type checking of the successor check.
- `deno task fmt:check`
- `deno task lint`
- `deno task check`
- `deno task ticket:validate docs/planning/tickets/FND-001S` from the canonical
  repository root after controller metadata commits.
- Clean candidate, exact allowed-write audit, frozen-byte verification, and
  post-candidate metadata-only audit.

## Risks

The complete parser, exposure, renderer-authority, sensitive-data, divergent
lineage, and DG-12 scope risks are recorded exactly in `ticket.json` and are
mandatory review inputs.

## Unresolved decisions

None within this bounded ticket. DG-12 is explicitly outside scope and remains
open for its separate decision ticket.
