# Repository schema v2 to v3

## Decision

AUTH-004 exposes member-owned authenticated sessions while the identity module
also stores ten-minute verified-entry handoffs in `user_sessions`. V2 has no
purpose field or constraint. Token duration, user agent, and issuance route are
incidental values and cannot be an authorization discriminator.

V3 adds required `user_sessions.purpose` with `authenticated`,
`verified-entry`, and `legacy` values. Application issuers and consumers state
the exact purpose. `legacy` exists only for fail-closed migration of ambiguous
v2 rows and is constrained to revoked rows.

## Compatibility mappings

The Monica mappings are complete copies of v2. Purpose is new runtime security
metadata without a Monica source column, so import dispositions do not change.

## Migration and recovery

`0003_add_user_session_purpose.sql` is transactional. It adds the field,
revokes all ambiguous pre-v3 authorities, labels them `legacy`, then installs
the required constraints and comment. A failure rolls back atomically. A
correction is a forward migration and synchronized future schema version.

## Validation boundary

V3 requires exact artifact hashes, clean apply, exact v1→v2→v3 and v2→v3
upgrades, idempotent v3 verification, drift rejection, transaction rollback,
and live PostgreSQL 18/17 matrix execution. V1 and v2 hashes remain immutable.
