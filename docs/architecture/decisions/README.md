# Architecture Decision Records

Architecture decisions record choices that affect multiple modules, persisted
data, security boundaries, deployment, or long-term replaceability.

Statuses:

- `accepted`: mandatory until superseded;
- `spike-required`: the experiment is approved but the candidate dependency is
  not accepted;
- `superseded`: retained for history with a link to the replacement;
- `rejected`: evaluated and intentionally not selected.

Exact dependency versions belong in implementation manifests and lockfiles, not
in an ADR written before scaffolding.

## Records

- [`0001-astro-personalized-rendering.md`](0001-astro-personalized-rendering.md)
- [`0002-authentication-compatibility-spike.md`](0002-authentication-compatibility-spike.md)
- [`0003-migration-runner-spike.md`](0003-migration-runner-spike.md)
- [`0004-onboarding-invitation-and-atomic-audit-coordination.md`](0004-onboarding-invitation-and-atomic-audit-coordination.md)
  — `accepted`
