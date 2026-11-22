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
- [`0005-durable-reminder-delivery-and-cadence-coordination.md`](0005-durable-reminder-delivery-and-cadence-coordination.md)
  — `accepted`
- [`0006-ui-stack-shadcn-react-islands.md`](0006-ui-stack-shadcn-react-islands.md)
  — `accepted`
- [`0007-on-demand-rendering-only-for-request-time-content.md`](0007-on-demand-rendering-only-for-request-time-content.md)
  — `accepted`; amends ADR 0001 and takes effect when AUD-G5 integrates
- [`0008-database-enforced-workspace-isolation.md`](0008-database-enforced-workspace-isolation.md)
  — `accepted`; implemented by schema v14 (AUD-V2) and v15 (REL-120)
- [`0009-mcp-endpoint-over-the-token-api.md`](0009-mcp-endpoint-over-the-token-api.md)
  — `accepted`; implemented by the MCP server plan of 2026-11-22
