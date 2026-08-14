# ADR 0002: Authentication Compatibility Decision

- Status: accepted
- Date: 2026-08-14

## Context

Better Auth has useful Hono, passkey, and relational-adapter capabilities, but
its default data model overlaps canonical user, session, verification, recovery,
MFA, and WebAuthn tables. An authentication package cannot become a second
schema owner or activate imported Monica credentials.

## Decision

Reject Better Auth for the canonical identity boundary. Its supported core
email/password contract requires user, session, account, and verification
models, and stores password credentials in an account row using the `credential`
provider. The canonical schema instead requires the owned credential in
`crm.users.password_hash` and contains no identity-owned account table.

A supported public configuration or adapter cannot represent that exact storage
contract without a shadow account table, an unowned schema change, or synthetic
model behavior. This fails the first fatal adoption criterion, so the spike
stops without testing or hardening additional plugins.

Use a focused standards-based identity application layer over the canonical
tables. Passwords use the Deno Web Crypto Argon2id primitive through injected
ports; verification and application-entry tokens use secure random bytes and
persist only cryptographic hashes. Transaction ownership remains with the
workspace registration coordinator.

## Consequences

- Better Auth is not a production dependency and no disposable spike machinery
  or generated schema is retained.
- The canonical schema remains the sole DDL authority; no parallel identity
  tables or automatic migrations are permitted.
- Imported legacy credential material remains inactive and is never upgraded or
  overwritten through registration or verification.
- Broader sign-in, MFA, recovery, passkey, and session-management behavior
  remains deferred to its own delivery outcomes.
