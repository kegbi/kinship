# Product Contract

This directory defines what the application exposes to a person using it. It is
the canonical bridge between Monica feature compatibility, the audited Personal
CRM schema, application modules, and executable end-to-end tests.

## Accepted Product Principles

- The product is person-centered. The primary working surface is one complete
  person profile, not a separate route for every kind of person-owned data.
- Preserve Monica's information breadth and workflows, but do not copy its
  visual design, component implementation, or historical route quirks.
- Use separate pages for cross-person work, long-running workflows, reports,
  administration, and settings. Use sections and local actions for data whose
  meaning depends on the current person.
- Every page and user flow has a stable identifier. Production routes and E2E
  tests must refer back to those identifiers.
- Rendering is selected per page. Static output remains the default, while
  personalized data is loaded through focused islands or narrowly approved
  on-demand rendering.

## Documents

- [`monica-person-profile-analysis.md`](monica-person-profile-analysis.md)
  records the behavioral lessons taken from Monica's contact profile.
- [`information-architecture.md`](information-architecture.md) defines the
  application navigation and person-profile composition.
- [`page-catalog.yaml`](page-catalog.yaml) is the machine-readable page and
  rendering catalog.
- [`user-flows.md`](user-flows.md) explains the workflow and E2E contract.
- [`user-flows.yaml`](user-flows.yaml) is the machine-readable workflow catalog.
- [`release-slices.md`](release-slices.md) orders implementation as complete
  vertical slices.

## Precedence

1. The canonical schema defines persisted data and invariants.
2. This product contract defines pages, page composition, and user workflows.
3. Architecture documents define implementation boundaries.
4. Monica specifications define source behavior, feature coverage, and import
   compatibility.

Changing a stable page ID, flow ID, or the person-profile composition requires
updating the affected catalogs, release slices, tests, and `AGENTS.md` in the
same change.
