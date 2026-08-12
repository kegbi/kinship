# AUTONOMY-001 accepted control contract

This ticket is authorized by the user's request for a fully autonomous,
worktree-isolated RED-GREEN-REFACTOR delivery loop and by the fresh
clean-context readiness audit that found the current controls insufficient.

The accepted behavior is:

- an integrated ticket records a durable `integrationRevision`, exact passing
  `integrationChecks`, and an `accepted -> integrated` event backed by
  `integration.md`;
- validation remains stable after later unrelated commits and resolves every
  dependency from the dependent ticket's base revision;
- new tickets use schema version 2, while only the exact historical `PILOT-001`
  and `PILOT-002` packets may remain version 1;
- `.git` is never writable, ordinary tickets cannot write `.codex` or `.agents`,
  and protected configuration maintenance requires an exact controller
  authorization;
- implementer and reviewer run IDs are controller-issued, ticket-namespaced,
  role- and round-bound, and unique at their issuance sites; and
- required Deno task definitions are bound to the base and candidate Git
  revisions. A changed task requires an independent unchanged guard and cannot
  certify itself.

The machine-readable ticket is authoritative for the exact field names, allowed
paths, checks, risks, and acceptance criteria. Existing historical RED Git blobs
remain immutable. After the round-one review proved that synthetic schema-v1
fixtures could not bind an exact base revision, the controller authorized a
fixture-only migration of those current test sources to schema version 2. That
migration must preserve every behavioral assertion and may not add a test-only
legacy-identity bypass. The exact historical on-disk PILOT-001 and PILOT-002
packets remain the only schema-v1 identities accepted by production validation.
The AUTONOMY-001 RED suites are authoritative at their recorded RED revisions.
