# Repository schema v1 to v2

## Decision

AUTH-003 requires restart-safe per-subject authentication throttling that does
not reveal whether an account exists and does not make people sharing one IP
consume each other's subject budget. Repository v1 could record the real client
IP and a foreign-key-backed authenticated user, but it had no lawful field for
an anonymous subject. Reusing the route, IP, user-agent, or user columns would
have changed their accepted meanings.

V2 adds nullable `api_request_logs.authentication_subject_digest`. Application
code stores only a keyed HMAC-SHA-256 digest over a purpose-scoped normalized
subject. The self-describing representation carries a positive key version and
64 lowercase hexadecimal characters (32 digest bytes). Raw email addresses and challenge tokens
are never stored in this field or emitted to logs.

The partial lookup index supports the five-minute authentication budget without
changing non-authentication request logging.

## Compatibility mappings

The Monica table and column mapping files are complete copies of the accepted v1
dispositions. The new field is runtime security metadata with no Monica source
column and therefore changes no import mapping.

## Migration and recovery

`migrations/0002_add_authentication_subject_digest.sql` is additive and fully
transactional. It adds the nullable field, comment, representation check, and
partial index. On failure PostgreSQL rolls back the transaction. Rollback of the
application can leave the nullable field in place; destructive down SQL is not
required. A correction is delivered as a forward migration and synchronized
future schema version.

## Validation boundary

The historical external audit and its hashes remain attached only to immutable
v1. V2 is validated by repository structural checks, exact artifact hashes,
clean apply, exact v1 upgrade, idempotent v2 verification, drift rejection,
transaction rollback, and the supported live PostgreSQL matrix.
