-- Transaction ownership belongs to the canonical migration runner.

ALTER TABLE crm.person_dates
  ADD COLUMN is_year_approximate boolean NOT NULL DEFAULT false;

ALTER TABLE crm.person_dates
  ADD CONSTRAINT person_dates_is_year_approximate_ck
  CHECK (NOT is_year_approximate OR year IS NOT NULL);

COMMENT ON COLUMN crm.person_dates.is_year_approximate IS
  'Whether the stated year is approximate; false does not imply that an unknown year exists.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.person_dates
    WHERE is_year_approximate AND year IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND table_name = 'person_dates'
      AND column_name = 'is_year_approximate'
      AND is_nullable = 'NO'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'person date year-approximation postcondition failed';
  END IF;
END
$$;
