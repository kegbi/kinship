\set ON_ERROR_STOP on

BEGIN;
SET LOCAL search_path = crm, public;

DO $$
DECLARE
  user_a uuid;
  user_b uuid;
  workspace_a uuid;
  workspace_b uuid;
  member_a uuid;
  member_b uuid;
  person_a uuid;
  missing_file uuid;
  import_run uuid;
  created_reminder_id uuid;
  created_task_id uuid;
  row_count integer;
  stored_value text;
BEGIN
  INSERT INTO users (email, first_name)
  VALUES ('owner-a@example.test', 'Owner A')
  RETURNING id INTO user_a;

  INSERT INTO users (email, first_name)
  VALUES ('owner-b@example.test', 'Owner B')
  RETURNING id INTO user_b;

  BEGIN
    INSERT INTO users (email) VALUES ('OWNER-A@example.test');
    RAISE EXCEPTION 'citext email uniqueness was not enforced';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO workspaces (name, status) VALUES ('Invalid', 'unknown');
    RAISE EXCEPTION 'workspace status check was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO workspaces (name, slug, created_by_user_id)
  VALUES ('Workspace A', 'workspace-a', user_a)
  RETURNING id INTO workspace_a;

  INSERT INTO workspaces (name, slug, created_by_user_id)
  VALUES ('Workspace B', 'workspace-b', user_b)
  RETURNING id INTO workspace_b;

  INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
  VALUES (workspace_a, user_a, 'owner', now())
  RETURNING id INTO member_a;

  INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
  VALUES (workspace_b, user_b, 'owner', now())
  RETURNING id INTO member_b;

  INSERT INTO people (workspace_id, created_by_member_id, given_name)
  VALUES (workspace_a, member_a, 'Person A')
  RETURNING id INTO person_a;

  INSERT INTO person_dates (person_id, kind, year, month, day, precision)
  VALUES
    (person_a, 'custom_full', 2000, 2, 29, 'full'),
    (person_a, 'custom_year_month', 2000, 2, NULL, 'year_month'),
    (person_a, 'custom_month_day', NULL, 2, 29, 'month_day'),
    (person_a, 'custom_year', 2000, NULL, NULL, 'year'),
    (person_a, 'custom_month', NULL, 2, NULL, 'month'),
    (person_a, 'custom_day', NULL, NULL, 29, 'day'),
    (person_a, 'custom_unknown', NULL, NULL, NULL, 'unknown');

  SELECT count(*) INTO row_count
  FROM person_dates
  WHERE person_id = person_a
    AND kind LIKE 'custom_%';
  IF row_count <> 7 THEN
    RAISE EXCEPTION 'partial-date round trip: expected 7 precision rows, got %', row_count;
  END IF;

  UPDATE person_dates SET is_year_approximate = true
  WHERE person_id = person_a AND kind = 'custom_year';
  IF NOT EXISTS (
    SELECT 1 FROM person_dates
    WHERE person_id = person_a AND kind = 'custom_year'
      AND year = 2000 AND precision = 'year' AND is_year_approximate
  ) THEN
    RAISE EXCEPTION 'approximate year did not round trip independently';
  END IF;

  BEGIN
    INSERT INTO person_dates (
      person_id, kind, precision, is_year_approximate
    ) VALUES (person_a, 'invalid_approximation', 'unknown', true);
    RAISE EXCEPTION 'year approximation without a year was not rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_dates (person_id, kind, year, month, precision)
    VALUES (person_a, 'invalid_full', 2000, 2, 'full');
    RAISE EXCEPTION 'partial-date precision shape was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_dates (person_id, kind, month, precision)
    VALUES (person_a, 'invalid_month', 13, 'month');
    RAISE EXCEPTION 'partial-date month range was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO person_dates (person_id, kind, month, day, precision)
  VALUES (person_a, 'birthday', 8, 9, 'month_day');

  BEGIN
    INSERT INTO person_dates (person_id, kind, month, day, precision)
    VALUES (person_a, 'birthday', 8, 10, 'month_day');
    RAISE EXCEPTION 'singleton person date uniqueness was not enforced';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO files (
    workspace_id,
    uploaded_by_member_id,
    original_filename,
    status,
    storage_key
  )
  VALUES (workspace_a, member_a, 'missing.jpg', 'missing', NULL)
  RETURNING id INTO missing_file;

  INSERT INTO person_file_links (person_id, file_id, kind)
  VALUES (person_a, missing_file, 'photo');

  IF NOT EXISTS (
    SELECT 1
    FROM files AS files
    JOIN person_file_links AS links ON links.file_id = files.id
    WHERE files.id = missing_file
      AND files.status = 'missing'
      AND files.storage_key IS NULL
  ) THEN
    RAISE EXCEPTION 'missing-file metadata could not remain linked';
  END IF;

  BEGIN
    INSERT INTO files (workspace_id, status)
    VALUES (workspace_a, 'lost');
    RAISE EXCEPTION 'file status check was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO data_imports (
    workspace_id,
    requested_by_member_id,
    source_system,
    source_profile
  )
  VALUES (workspace_a, member_a, 'monica', 'sql_export')
  RETURNING id INTO import_run;

  INSERT INTO data_import_entities (
    import_id,
    source_table,
    source_primary_key,
    target_table,
    target_key
  )
  VALUES (import_run, 'contacts', '42', 'people', person_a::text);

  BEGIN
    INSERT INTO data_import_entities (
      import_id,
      source_table,
      source_primary_key,
      target_table,
      target_key
    )
    VALUES (import_run, 'contacts', '42', 'people', gen_random_uuid()::text);
    RAISE EXCEPTION 'import source identity uniqueness was not enforced';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO data_import_entities (
    import_id,
    source_table,
    source_primary_key,
    target_table,
    target_key,
    status
  )
  VALUES (import_run, 'contacts', '42', 'people', person_a::text, 'mapped')
  ON CONFLICT (import_id, source_table, source_primary_key)
    WHERE source_primary_key IS NOT NULL
  DO UPDATE SET
    target_table = EXCLUDED.target_table,
    target_key = EXCLUDED.target_key,
    status = EXCLUDED.status;

  SELECT count(*), max(target_key)
  INTO row_count, stored_value
  FROM data_import_entities
  WHERE import_id = import_run
    AND source_table = 'contacts'
    AND source_primary_key = '42';
  IF row_count <> 1 OR stored_value <> person_a::text THEN
    RAISE EXCEPTION 'import identity upsert was not idempotent';
  END IF;

  BEGIN
    INSERT INTO reminder_rules (workspace_id, days_before)
    VALUES (workspace_a, -1);
    RAISE EXCEPTION 'negative reminder lead time was not rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO reminders (workspace_id, target_kind, anchor_on)
    VALUES (workspace_a, 'task', DATE '2026-08-09');
    RAISE EXCEPTION 'invalid reminder target shape was not rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO tasks (workspace_id, person_id, title)
  VALUES (workspace_a, person_a, 'Test task')
  RETURNING id INTO created_task_id;

  INSERT INTO reminders (
    workspace_id,
    task_id,
    target_kind,
    title,
    anchor_on,
    recurrence_unit
  )
  VALUES (
    workspace_a,
    created_task_id,
    'task',
    'Test reminder',
    DATE '2026-08-09',
    'year'
  )
  RETURNING id INTO created_reminder_id;

  INSERT INTO reminder_occurrences (
    reminder_id,
    member_id,
    occurs_on,
    deliver_at,
    channel
  )
  VALUES (
    created_reminder_id,
    member_a,
    DATE '2027-08-09',
    TIMESTAMPTZ '2027-08-08 12:00:00+00',
    'email'
  );

  BEGIN
    INSERT INTO reminder_occurrences (
      reminder_id,
      member_id,
      occurs_on,
      deliver_at,
      channel
    )
    VALUES (
      created_reminder_id,
      member_a,
      DATE '2027-08-09',
      TIMESTAMPTZ '2027-08-08 13:00:00+00',
      'email'
    );
    RAISE EXCEPTION 'reminder occurrence uniqueness was not enforced';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  INSERT INTO reminder_occurrences (
    reminder_id,
    member_id,
    occurs_on,
    deliver_at,
    channel,
    title_snapshot
  )
  VALUES (
    created_reminder_id,
    member_a,
    DATE '2027-08-09',
    TIMESTAMPTZ '2027-08-08 12:00:00+00',
    'email',
    'Regenerated reminder'
  )
  ON CONFLICT (reminder_id, member_id, occurs_on, channel, (COALESCE(lead_time_days, -1)))
  DO UPDATE SET
    occurs_on = EXCLUDED.occurs_on,
    title_snapshot = EXCLUDED.title_snapshot;

  SELECT count(*), max(title_snapshot)
  INTO row_count, stored_value
  FROM reminder_occurrences
  WHERE reminder_id = created_reminder_id
    AND member_id = member_a
    AND occurs_on = DATE '2027-08-09'
    AND channel = 'email';
  IF row_count <> 1 OR stored_value <> 'Regenerated reminder' THEN
    RAISE EXCEPTION 'reminder occurrence regeneration was not idempotent';
  END IF;

  BEGIN
    UPDATE reminder_occurrences SET status = 'claimed'
    WHERE reminder_id = created_reminder_id;
    RAISE EXCEPTION 'claim without ownership and lease was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE reminder_occurrences SET status = 'claimed',
    claim_token = gen_random_uuid(), claim_owner = 'schema-test',
    lease_expires_at = now() + interval '30 seconds', attempt_count = 1
  WHERE reminder_id = created_reminder_id;

  BEGIN
    UPDATE reminder_occurrences SET status = 'sent', claim_token = null,
      claim_owner = null, lease_expires_at = null
    WHERE reminder_id = created_reminder_id;
    RAISE EXCEPTION 'sent occurrence without confirmed receipt was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE reminder_occurrences SET status = 'sent', sent_at = now(),
    claim_token = null, claim_owner = null, lease_expires_at = null,
    provider_receipt = 'schema-receipt', provider_result_state = 'confirmed',
    provider_effect_at = now(), visible_at = now()
  WHERE reminder_id = created_reminder_id;

  INSERT INTO member_preferences (member_id) VALUES (member_a);
  SELECT reminder_delivery || '|' || coalesce(digest_time::text, 'none')
  INTO stored_value FROM member_preferences WHERE member_id = member_a;
  IF stored_value <> 'in_app|none' THEN
    RAISE EXCEPTION 'member reminder delivery default was %', stored_value;
  END IF;
  UPDATE member_preferences SET reminder_delivery = 'both',
    digest_time = '07:30'
  WHERE member_id = member_a;

  BEGIN
    UPDATE member_preferences SET reminder_delivery = 'sms'
    WHERE member_id = member_a;
    RAISE EXCEPTION 'member reminder delivery vocabulary was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  IF member_b IS NULL OR workspace_b IS NULL THEN
    RAISE EXCEPTION 'secondary workspace fixture was not created';
  END IF;
END
$$;

DO $$
BEGIN
  INSERT INTO api_request_logs (
    method, path, client_ip, authentication_subject_digest, status_code
  ) VALUES
    ('POST', '/api/v1/sessions', '127.0.0.1', NULL, 401),
    ('POST', '/api/v1/sessions', '127.0.0.1',
      'hmac-sha256:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      401);

  BEGIN
    INSERT INTO api_request_logs (
      method, path, authentication_subject_digest, status_code
    ) VALUES ('POST', '/api/v1/sessions', 'owner@example.test', 401);
    RAISE EXCEPTION 'raw authentication subject digest was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END
$$;

ROLLBACK;

SELECT 'schema_behavior_assertions_passed' AS result;
