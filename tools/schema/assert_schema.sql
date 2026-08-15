\set ON_ERROR_STOP on

SET search_path = crm, public;

CREATE TEMP TABLE expected_field_catalog (
  module text,
  deployment_class text,
  catalog_table text,
  table_purpose text,
  catalog_column text,
  sql_definition text,
  nullable text,
  default_value text,
  primary_key text,
  foreign_key text,
  field_class text,
  purpose text,
  v1_to_v3_change text,
  change_reason text
);

\copy expected_field_catalog FROM '/tmp/personal_crm_field_catalog_v5.csv' WITH (FORMAT csv, HEADER true)

DO $$
DECLARE
  actual_count bigint;
BEGIN
  SELECT count(*) INTO actual_count FROM expected_field_catalog;
  IF actual_count <> 814 THEN
    RAISE EXCEPTION 'field catalog row count: expected 814, got %', actual_count;
  END IF;

  IF EXISTS (
    SELECT catalog_table, catalog_column
    FROM expected_field_catalog
    EXCEPT
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'crm'
  ) THEN
    RAISE EXCEPTION 'field catalog contains a table/column absent from PostgreSQL';
  END IF;

  IF EXISTS (
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'crm'
    EXCEPT
    SELECT catalog_table, catalog_column
    FROM expected_field_catalog
  ) THEN
    RAISE EXCEPTION 'PostgreSQL contains a table/column absent from the field catalog';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM expected_field_catalog AS expected
    JOIN information_schema.columns AS live
      ON live.table_schema = 'crm'
      AND live.table_name = expected.catalog_table
      AND live.column_name = expected.catalog_column
    WHERE (expected.nullable = 'yes') <> (live.is_nullable = 'YES')
  ) THEN
    RAISE EXCEPTION 'field catalog nullability disagrees with PostgreSQL';
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_tables AS tables
  WHERE tables.schemaname = 'crm'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraints
      WHERE constraints.conrelid = format('%I.%I', tables.schemaname, tables.tablename)::regclass
        AND constraints.contype = 'p'
    );
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'canonical tables without a primary key: %', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_class AS tables
  JOIN pg_catalog.pg_namespace AS namespaces
    ON namespaces.oid = tables.relnamespace
  WHERE namespaces.nspname = 'crm'
    AND tables.relkind = 'r'
    AND obj_description(tables.oid, 'pg_class') IS NULL;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'canonical tables without comments: %', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_attribute AS columns
  JOIN pg_catalog.pg_class AS tables ON tables.oid = columns.attrelid
  JOIN pg_catalog.pg_namespace AS namespaces ON namespaces.oid = tables.relnamespace
  WHERE namespaces.nspname = 'crm'
    AND tables.relkind = 'r'
    AND columns.attnum > 0
    AND NOT columns.attisdropped
    AND col_description(tables.oid, columns.attnum) IS NULL;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'canonical columns without comments: %', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_index AS indexes
  JOIN pg_catalog.pg_class AS index_relations
    ON index_relations.oid = indexes.indexrelid
  JOIN pg_catalog.pg_namespace AS namespaces
    ON namespaces.oid = index_relations.relnamespace
  WHERE namespaces.nspname = 'crm'
    AND (NOT indexes.indisvalid OR NOT indexes.indisready);
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'invalid or unready canonical indexes: %', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_constraint
  WHERE connamespace = 'crm'::regnamespace
    AND NOT convalidated;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'unvalidated canonical constraints: %', actual_count;
  END IF;

  SELECT count(*) INTO actual_count
  FROM pg_catalog.pg_trigger AS triggers
  JOIN pg_catalog.pg_class AS tables ON tables.oid = triggers.tgrelid
  JOIN pg_catalog.pg_namespace AS namespaces ON namespaces.oid = tables.relnamespace
  WHERE namespaces.nspname = 'crm'
    AND NOT triggers.tgisinternal;
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'unexpected user-defined triggers: %', actual_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND column_name IN (
        'api_key',
        'google2fa_secret',
        'remember_token',
        'session_payload',
        'u2f_key_handle'
      )
  ) THEN
    RAISE EXCEPTION 'a known raw Monica credential column exists in the canonical schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE connamespace = 'crm'::regnamespace
      AND conname = 'api_request_logs_auth_subject_digest_ck'
      AND convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'crm'
      AND indexname = 'api_request_logs_auth_subject_idx'
  ) THEN
    RAISE EXCEPTION 'schema authentication subject constraint/index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE connamespace = 'crm'::regnamespace
      AND conname = 'user_sessions_purpose_check'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE connamespace = 'crm'::regnamespace
      AND conname = 'user_sessions_legacy_revoked_check'
  ) THEN
    RAISE EXCEPTION 'user-session purpose constraints missing';
  END IF;

  IF (SELECT count(*) FROM crm.currencies) <> 165 OR NOT EXISTS (
    SELECT 1 FROM crm.currencies
    WHERE code = 'EUR' AND name = 'Euro' AND minor_unit = 2 AND is_active
  ) THEN
    RAISE EXCEPTION 'schema v5 ISO 4217 currency catalog missing or drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'person_dates'
      AND column_name = 'is_year_approximate' AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE connamespace = 'crm'::regnamespace
      AND conname = 'person_dates_is_year_approximate_ck'
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'schema v5 person-date approximation invariant missing';
  END IF;
END
$$;

SELECT 'schema_catalog_assertions_passed' AS result;
