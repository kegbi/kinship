# ADR 0002: Authentication Compatibility Spike

- Status: spike-required
- Date: 2026-08-09

## Context

Better Auth has useful Hono, passkey, and relational-adapter capabilities, but
its default data model overlaps canonical user, session, verification, recovery,
MFA, and WebAuthn tables. An authentication package cannot become a second
schema owner or activate imported Monica credentials.

## Decision

Run a bounded compatibility spike before authentication implementation. Better
Auth is a candidate, not an accepted dependency.

Adopt it only if supported configuration or a maintainable public adapter can:

- use the exact canonical schema without adding parallel identity tables;
- pass password/session rotation, revocation, MFA, passkey, recovery, CSRF, and
  workspace-isolation tests;
- keep all imported legacy credentials inactive;
- operate on Deno/Hono and the selected PostgreSQL access layer without private
  APIs or hidden lifecycle-script requirements.

If any criterion fails, implement the identity application layer against the
canonical tables using standards-based cryptography and focused libraries.

## Consequences

- No auth package or version is pinned by this ADR.
- The spike is disposable and must not migrate production data.
- Its result updates this ADR to accepted or rejected before Slice 1 begins.
