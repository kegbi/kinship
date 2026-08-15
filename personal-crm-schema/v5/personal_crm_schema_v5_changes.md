# Repository schema v4 to v5

## Decision

`PEOPLE-005` requires approximate years to round-trip independently from the
set of known date components. V4 records exact component precision but cannot
distinguish “1984” from “about 1984”. Storing approximation in notes or
collapsing it into `precision='year'` would be lossy.

V5 adds `person_dates.is_year_approximate boolean NOT NULL DEFAULT false` and a
constraint requiring a year component whenever approximation is true. The
existing precision constraint remains authoritative for which components are
known.

## Compatibility mappings

The Monica mappings are complete copies of v4. Approximation is new application
metadata without a Monica source column, so import dispositions do not change.

## Migration and recovery

`0005_add_person_date_year_approximation.sql` is transaction-safe and the
canonical migration runner owns its transaction. It adds the field with the
non-lossy default for pre-v5 rows, installs the constraint and comment, and
verifies the postcondition before commit. Failure rolls back atomically.
Application rollback remains compatible because the new field is additive;
removing it would discard new approximation data and therefore needs an
operator-reviewed forward recovery rather than automatic down SQL.

## Validation boundary

V5 requires exact artifact hashes, clean apply, exact v1/v2/v3/v4 upgrades,
idempotent v5 verification, structural and reference-data drift rejection,
transaction rollback, all seven precision shapes plus approximation, and live
PostgreSQL 18/17 matrix execution. V1 through v4 hashes remain immutable.
