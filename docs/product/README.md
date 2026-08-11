# Product Contract

This directory defines what the application exposes to a person using it. It is
the canonical bridge between Monica feature compatibility, the audited Personal
CRM schema, application modules, and executable end-to-end tests.

## Accepted Product Principles

- The product is person-centered. The primary working surface is one complete
  person profile, not a separate route for every kind of person-owned data.
- Cover the information breadth and workflows a Monica user expects, so imported
  data always has a home, with an original visual design, component
  implementation, and route structure.
- Use separate pages for cross-person work, long-running workflows, reports,
  administration, and settings. Use sections and local actions for data whose
  meaning depends on the current person.
- Every page and user flow has a stable identifier. Production routes and E2E
  tests must refer back to those identifiers.
- Rendering is selected per page. Static output remains the default, while
  personalized data is loaded through focused islands or narrowly approved
  on-demand rendering.

## Documents

- [`person-workspace.md`](person-workspace.md) records what belongs on the one
  person workspace and when a separate page is justified.
- [`monica-import-compatibility.md`](monica-import-compatibility.md) records the
  supported Monica export formats, imported data, limits, and exclusions.
- [`dashboard-settings-design.md`](dashboard-settings-design.md) fixes the
  accepted Today and settings UX, route hierarchy, and responsive behavior.
- [`information-architecture.md`](information-architecture.md) defines the
  application navigation and person-profile composition.
- [`page-catalog.yaml`](page-catalog.yaml) is the machine-readable page and
  rendering catalog.
- [`user-flows.md`](user-flows.md) explains the workflow and E2E contract.
- [`user-flows.yaml`](user-flows.yaml) is the machine-readable workflow catalog.
- [`release-slices.md`](release-slices.md) orders implementation as complete
  vertical slices.
- [`../planning/README.md`](../planning/README.md) is the subordinate execution
  index for the proposed MVP roadmap, dependency gates, quality/operations
  strategy, research, and delivery traceability.

## Precedence

1. The canonical schema defines persisted data and invariants.
2. This product contract defines pages, page composition, and user workflows.
3. Architecture documents define implementation boundaries.
4. The Monica import mappings and compatibility notes define what an import must
   accept, preserve, and report.

Changing a stable page ID, flow ID, person-profile composition, Today content
order, settings route, or personalization section ID requires updating the
affected design contract, catalogs, release slices, tests, and `AGENTS.md` in
the same change.
