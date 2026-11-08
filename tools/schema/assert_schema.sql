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

\copy expected_field_catalog FROM '/tmp/personal_crm_field_catalog_v14.csv' WITH (FORMAT csv, HEADER true)

DO $$
DECLARE
  actual_count bigint;
BEGIN
  IF to_regclass('crm.stay_in_touch_cadence_requests') IS NULL THEN
    RAISE EXCEPTION 'missing durable cadence request history table';
  END IF;
  IF to_regclass('crm.workspace_lifecycle_records') IS NULL THEN
    RAISE EXCEPTION 'missing surviving workspace deletion record table';
  END IF;

  SELECT count(*) INTO actual_count FROM expected_field_catalog;
  IF actual_count <> 897 THEN
    RAISE EXCEPTION 'field catalog row count: expected 897, got %', actual_count;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'crm'
      AND (indexname, indexdef) IN (
        ('notes_search_idx',
          'CREATE INDEX notes_search_idx ON crm.notes USING gin (to_tsvector(''simple''::regconfig, body))'),
        ('activities_search_idx',
          'CREATE INDEX activities_search_idx ON crm.activities USING gin (to_tsvector(''simple''::regconfig, ((summary || '' ''::text) || COALESCE(description, ''''::text))))'),
        ('journal_posts_search_idx',
          'CREATE INDEX journal_posts_search_idx ON crm.journal_posts USING gin (to_tsvector(''simple''::regconfig, ((COALESCE(title, ''''::text) || '' ''::text) || body)))'),
        ('tasks_search_idx',
          'CREATE INDEX tasks_search_idx ON crm.tasks USING gin (to_tsvector(''simple''::regconfig, ((title || '' ''::text) || COALESCE(description, ''''::text))))')
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'full-text search indexes are missing or changed';
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

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'crm'
      AND indexname = 'reminder_occurrences_unique_delivery'
      AND indexdef LIKE '%(reminder_id, member_id, occurs_on, channel, COALESCE(lead_time_days, ''-1''::integer))%'
  ) THEN
    RAISE EXCEPTION 'stable calendar reminder occurrence identity index missing';
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
  ) THEN
    RAISE EXCEPTION 'schema authentication subject constraint missing';
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

-- Schema v13 (AUD-V1): the indexes match the statements that read them.
DO $$
DECLARE
  expected record;
  actual_definition text;
  dropped text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('notes_workspace_created_idx',
        'CREATE INDEX notes_workspace_created_idx ON crm.notes USING btree (workspace_id, created_at DESC, id DESC)'),
      ('reminder_occurrences_member_feed_idx',
        'CREATE INDEX reminder_occurrences_member_feed_idx ON crm.reminder_occurrences USING btree (member_id, date_trunc(''milliseconds''::text, (visible_at AT TIME ZONE ''UTC''::text)) DESC, id DESC) WHERE ((channel = ''in_app''::text) AND (status = ''sent''::text) AND (visible_at IS NOT NULL))'),
      ('reminder_occurrences_member_open_idx',
        'CREATE INDEX reminder_occurrences_member_open_idx ON crm.reminder_occurrences USING btree (member_id, ( CASE WHEN (status = ''retry''::text) THEN next_attempt_at ELSE deliver_at END)) WHERE (status = ANY (ARRAY[''pending''::text, ''retry''::text, ''failed''::text, ''manual_attention''::text]))'),
      -- v14 (ADR 0008, Q4) rebuilds both on stored keys with v13's exact
      -- expressions, so they are sought under row-level security.
      ('people_active_given_name_idx',
        'CREATE INDEX people_active_given_name_idx ON crm.people USING btree (workspace_id, sort_given_name, sort_family_name, id) WHERE ((archived_at IS NULL) AND (deleted_at IS NULL))'),
      ('people_active_duplicate_name_idx',
        'CREATE INDEX people_active_duplicate_name_idx ON crm.people USING btree (workspace_id, duplicate_given_name, duplicate_family_name, duplicate_nickname) WHERE ((archived_at IS NULL) AND (deleted_at IS NULL))'),
      ('reminders_person_date_idx',
        'CREATE INDEX reminders_person_date_idx ON crm.reminders USING btree (person_date_id) WHERE (person_date_id IS NOT NULL)'),
      ('reminders_life_event_idx',
        'CREATE INDEX reminders_life_event_idx ON crm.reminders USING btree (life_event_id) WHERE (life_event_id IS NOT NULL)'),
      ('reminders_task_idx',
        'CREATE INDEX reminders_task_idx ON crm.reminders USING btree (task_id) WHERE (task_id IS NOT NULL)'),
      ('api_request_logs_post_subject_idx',
        'CREATE INDEX api_request_logs_post_subject_idx ON crm.api_request_logs USING btree (path, authentication_subject_digest, occurred_at DESC) WHERE (method = ''POST''::text)'),
      -- Kept: the worker's claim and lease scans (AUD-W2), and the only
      -- workspace-leading indexes the workspace delete and reset cascades,
      -- lifecycle counts, and last-contact aggregate have on these tables.
      ('reminder_occurrences_due_idx',
        'CREATE INDEX reminder_occurrences_due_idx ON crm.reminder_occurrences USING btree (status, COALESCE(next_attempt_at, deliver_at)) WHERE (status = ANY (ARRAY[''pending''::text, ''retry''::text]))'),
      ('reminder_occurrences_lease_idx',
        'CREATE INDEX reminder_occurrences_lease_idx ON crm.reminder_occurrences USING btree (lease_expires_at) WHERE (status = ''claimed''::text)'),
      -- A removed member's delete cascade reads their occurrences, the sent
      -- history included, through it.
      ('reminder_occurrences_member_idx',
        'CREATE INDEX reminder_occurrences_member_idx ON crm.reminder_occurrences USING btree (member_id)'),
      ('calls_workspace_date_idx',
        'CREATE INDEX calls_workspace_date_idx ON crm.calls USING btree (workspace_id, called_at DESC)'),
      ('conversation_threads_workspace_idx',
        'CREATE INDEX conversation_threads_workspace_idx ON crm.conversation_threads USING btree (workspace_id, happened_at DESC)'),
      ('gifts_status_idx',
        'CREATE INDEX gifts_status_idx ON crm.gifts USING btree (workspace_id, status)')
    ) AS indexes (name, definition)
  LOOP
    SELECT regexp_replace(indexdef, '\s+', ' ', 'g') INTO actual_definition
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'crm' AND indexname = expected.name;
    IF actual_definition IS DISTINCT FROM expected.definition THEN
      RAISE EXCEPTION 'v13 index % is missing or changed: %',
        expected.name, coalesce(actual_definition, '<missing>');
    END IF;
  END LOOP;

  FOREACH dropped IN ARRAY ARRAY[
    'people_workspace_idx',
    'people_active_name_idx',
    'person_dates_person_idx',
    'api_request_logs_auth_subject_idx',
    'person_contact_methods_normalized_idx',
    'users_status_idx',
    'workspaces_status_idx',
    'workspace_members_status_idx',
    'debts_status_idx'
  ] LOOP
    IF to_regclass('crm.' || dropped) IS NOT NULL THEN
      RAISE EXCEPTION 'v13 drops the unused or redundant index %', dropped;
    END IF;
  END LOOP;

  -- Whatever its name, a full index leads with the member foreign key, so the
  -- member delete cascade never reads every tenant's occurrences.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index AS indexes
    JOIN pg_catalog.pg_attribute AS columns
      ON columns.attrelid = indexes.indrelid
     AND columns.attnum = indexes.indkey[0]
    WHERE indexes.indrelid = 'crm.reminder_occurrences'::regclass
      AND columns.attname = 'member_id'
      AND indexes.indpred IS NULL
      AND indexes.indisvalid
  ) THEN
    RAISE EXCEPTION 'no full index leads with reminder_occurrences.member_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE connamespace = 'crm'::regnamespace
      AND conname = 'user_sessions_purpose_check'
      AND pg_get_constraintdef(oid) =
        'CHECK ((purpose = ANY (ARRAY[''authenticated''::text, ''verified-entry''::text, ''legacy''::text, ''mfa-challenge''::text])))'
  ) THEN
    RAISE EXCEPTION 'v13 user-session purposes do not admit mfa-challenge';
  END IF;

  -- A registration holds the workspace name it asked for until verification
  -- provisions the workspace (AUD-A2), within the registration contract's
  -- limits: trimmed and 1 to 120 characters.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'crm' AND table_name = 'users'
      AND column_name = 'pending_workspace_name' AND data_type = 'text'
      AND is_nullable = 'YES' AND column_default IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'crm.users'::regclass
      AND conname = 'users_pending_workspace_name_ck'
      AND convalidated
      AND pg_get_constraintdef(oid) =
        'CHECK (((pending_workspace_name IS NULL) OR ((pending_workspace_name = btrim(pending_workspace_name)) AND ((char_length(pending_workspace_name) >= 1) AND (char_length(pending_workspace_name) <= 120)))))'
  ) THEN
    RAISE EXCEPTION 'v13 users.pending_workspace_name or its limits are missing';
  END IF;

  IF (SELECT count(*) FROM crm.emotion_options) <> 132 OR (
    SELECT count(DISTINCT lower(name)) FROM crm.emotion_options
  ) <> 132 OR NOT EXISTS (
    SELECT 1 FROM crm.emotion_options
    WHERE name = 'adoration' AND sort_order = 1 AND parent_id IS NULL
      AND is_active
  ) OR NOT EXISTS (
    SELECT 1 FROM crm.emotion_options WHERE name = 'dread' AND sort_order = 133
  ) THEN
    RAISE EXCEPTION 'v13 global emotion catalog is not seeded';
  END IF;

  IF (SELECT count(*) FROM crm.pet_categories) <> 11 OR (
    SELECT string_agg(name || ':' || is_common, ',' ORDER BY sort_order)
    FROM crm.pet_categories
  ) <> 'reptile:false,bird:false,cat:true,dog:true,fish:true,hamster:false,horse:false,rabbit:false,rat:false,small_animal:false,other:false' THEN
    RAISE EXCEPTION 'v13 global pet category catalog is not seeded';
  END IF;
END
$$;

SELECT 'schema_catalog_assertions_passed' AS result;
