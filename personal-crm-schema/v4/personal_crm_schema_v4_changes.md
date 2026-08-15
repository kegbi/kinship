# Repository schema v3 to v4

## Decision

AUTH-004 exposes currency preferences backed by foreign keys to `currencies`.
The prior schema defined the reference table but shipped no supported rows, so
fresh installations could not save a non-empty currency without test or
operator seeding.

V4 seeds the 165 current ISO 4217 List One codes that declare numeric minor
units in the official SIX snapshot retrieved on 2026-08-15. The XML source
SHA-256 is
`838dfb991648cf36df939edd5fe3811737962b75a32252847d239cedd1e291c9`.
The table comment records the snapshot boundary, making v3 and v4 catalogs
structurally distinguishable without adding a schema-version table.

## Compatibility mappings

The Monica mappings and field catalog are complete copies of v3. Reference data
does not change a Monica table or column disposition.

## Migration and recovery

`0004_seed_iso_4217_currencies.sql` is transactional and idempotently upserts
the supported rows, activates them, updates their names and minor units, updates
the catalog comment, and verifies a bounded postcondition before commit. It
preserves extra historical/import rows. A failure rolls back atomically. A
future catalog correction requires a forward migration and synchronized schema
version.

## Validation boundary

V4 requires exact artifact hashes, clean apply, exact v1/v2/v3 upgrades,
idempotent v4 verification, structural and reference-data drift rejection,
transaction rollback, and live PostgreSQL 18/17 matrix execution. V1, v2, and
v3 hashes remain immutable.
