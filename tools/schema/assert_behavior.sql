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
  pair_low uuid;
  pair_high uuid;
  person_b uuid;
  dismissing_member uuid;
  rule_id uuid;
  debtor uuid;
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

  -- Duplicate dismissals (v9): one canonical row per unordered pair, and
  -- both people in the row's own workspace.
  INSERT INTO people (workspace_id, given_name) VALUES (workspace_a, 'Twin')
  RETURNING id INTO pair_high;
  SELECT least(person_a, pair_high), greatest(person_a, pair_high)
  INTO pair_low, pair_high;
  INSERT INTO people (workspace_id, given_name) VALUES (workspace_b, 'Other')
  RETURNING id INTO person_b;

  INSERT INTO workspace_members (workspace_id, user_id, role, joined_at)
  VALUES (workspace_a, user_b, 'member', now())
  RETURNING id INTO dismissing_member;
  INSERT INTO person_duplicate_dismissals (
    workspace_id, person_low_id, person_high_id, dismissed_by_member_id
  ) VALUES (workspace_a, pair_low, pair_high, dismissing_member);

  BEGIN
    INSERT INTO person_duplicate_dismissals (
      workspace_id, person_low_id, person_high_id
    ) VALUES (workspace_a, pair_high, pair_low);
    RAISE EXCEPTION 'duplicate dismissal order was not enforced';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_duplicate_dismissals (
      workspace_id, person_low_id, person_high_id
    ) VALUES (workspace_a, pair_low, pair_low);
    RAISE EXCEPTION 'a person was dismissed as their own duplicate';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_duplicate_dismissals (
      workspace_id, person_low_id, person_high_id
    ) VALUES (workspace_a, pair_low, pair_high);
    RAISE EXCEPTION 'a pair was dismissed twice';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_duplicate_dismissals (
      workspace_id, person_low_id, person_high_id
    ) VALUES (
      workspace_a, least(person_a, person_b), greatest(person_a, person_b)
    );
    RAISE EXCEPTION 'a dismissal spanned two workspaces';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO person_duplicate_dismissals (
      workspace_id, person_low_id, person_high_id
    ) VALUES (workspace_b, pair_low, pair_high);
    RAISE EXCEPTION 'a dismissal named another workspace''s people';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM workspace_members WHERE id = dismissing_member;
  SELECT count(*) INTO row_count FROM person_duplicate_dismissals
  WHERE workspace_id = workspace_a AND dismissed_by_member_id IS NULL;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'removing the dismissing member removed the dismissal';
  END IF;

  DELETE FROM people WHERE id = pair_high;
  SELECT count(*) INTO row_count FROM person_duplicate_dismissals
  WHERE workspace_id = workspace_a;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'deleting a person kept % of its dismissals', row_count;
  END IF;

  -- Recurring debts (v10): a rule's person is in its own workspace, and a
  -- rule generates at most one debt per due date.
  INSERT INTO people (workspace_id, given_name) VALUES (workspace_a, 'Debtor')
  RETURNING id INTO debtor;
  INSERT INTO recurring_debts (
    workspace_id, person_id, direction, amount, currency_code,
    day_of_month, starts_on
  ) VALUES (workspace_a, debtor, 'they_owe', 25, 'EUR', 31, '2026-01-31')
  RETURNING id INTO rule_id;
  SELECT is_active::text || interval_months::text INTO stored_value
  FROM recurring_debts WHERE id = rule_id;
  IF stored_value <> 'true1' THEN
    RAISE EXCEPTION 'recurring debt defaults changed: %', stored_value;
  END IF;

  BEGIN
    INSERT INTO recurring_debts (
      workspace_id, person_id, direction, amount, currency_code,
      day_of_month, starts_on
    ) VALUES (workspace_b, debtor, 'they_owe', 25, 'EUR', 1, '2026-01-01');
    RAISE EXCEPTION 'a recurring debt named another workspace''s person';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO recurring_debts (
      workspace_id, person_id, direction, amount, currency_code,
      day_of_month, starts_on
    ) VALUES (workspace_a, debtor, 'they_owe', 25, 'EUR', 32, '2026-01-01');
    RAISE EXCEPTION 'a recurring debt day after the 31st was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO recurring_debts (
      workspace_id, person_id, direction, amount, currency_code,
      interval_months, day_of_month, starts_on
    ) VALUES (workspace_a, debtor, 'they_owe', 25, 'EUR', 0, 1, '2026-01-01');
    RAISE EXCEPTION 'a recurring debt without an interval was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO recurring_debts (
      workspace_id, person_id, direction, amount, currency_code,
      day_of_month, starts_on, ends_on
    ) VALUES (
      workspace_a, debtor, 'they_owe', 25, 'EUR', 1, '2026-02-01', '2026-01-01'
    );
    RAISE EXCEPTION 'a recurring debt ending before it starts was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO recurring_debts (
      workspace_id, person_id, direction, amount, currency_code,
      day_of_month, starts_on
    ) VALUES (workspace_a, debtor, 'sideways', 25, 'EUR', 1, '2026-01-01');
    RAISE EXCEPTION 'a recurring debt direction outside the vocabulary was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO debts (
    workspace_id, person_id, direction, amount, currency_code,
    recurring_debt_id, occurrence_on
  ) VALUES (
    workspace_a, debtor, 'they_owe', 25, 'EUR', rule_id, '2026-02-28'
  );
  INSERT INTO debts (
    workspace_id, person_id, direction, amount, currency_code,
    recurring_debt_id, occurrence_on
  ) VALUES (
    workspace_a, debtor, 'they_owe', 25, 'EUR', rule_id, '2026-02-28'
  ) ON CONFLICT (recurring_debt_id, occurrence_on) DO NOTHING;
  SELECT count(*) INTO row_count FROM debts WHERE recurring_debt_id = rule_id;
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'a recurring period was charged % times', row_count;
  END IF;

  BEGIN
    INSERT INTO debts (
      workspace_id, person_id, direction, amount, currency_code,
      recurring_debt_id
    ) VALUES (workspace_a, debtor, 'they_owe', 25, 'EUR', rule_id);
    RAISE EXCEPTION 'a generated debt without its due date was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO debts (
      workspace_id, person_id, direction, amount, currency_code,
      recurring_debt_id, occurrence_on
    ) VALUES (
      workspace_b, debtor, 'they_owe', 25, 'EUR', rule_id, '2026-03-31'
    );
    RAISE EXCEPTION 'a debt named another workspace''s recurring rule';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;

  DELETE FROM recurring_debts WHERE id = rule_id;
  SELECT count(*) INTO row_count FROM debts
  WHERE person_id = debtor AND recurring_debt_id IS NULL
    AND occurrence_on = '2026-02-28';
  IF row_count <> 1 THEN
    RAISE EXCEPTION 'deleting a recurring rule removed its generated debt';
  END IF;

  INSERT INTO recurring_debts (
    workspace_id, person_id, direction, amount, currency_code,
    day_of_month, starts_on
  ) VALUES (workspace_a, debtor, 'i_owe', 10, 'EUR', 15, '2026-01-01');
  DELETE FROM people WHERE id = debtor;
  SELECT count(*) INTO row_count FROM recurring_debts
  WHERE workspace_id = workspace_a;
  IF row_count <> 0 THEN
    RAISE EXCEPTION 'deleting a person kept % of their recurring debts', row_count;
  END IF;

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

DO $$
DECLARE
  w uuid; other_w uuid; u uuid; m uuid; p uuid; d uuid; f uuid; event_id uuid;
BEGIN
  INSERT INTO workspaces(name) VALUES ('Settlement history') RETURNING id INTO w;
  INSERT INTO workspaces(name) VALUES ('Foreign settlement') RETURNING id INTO other_w;
  INSERT INTO users(email) VALUES ('settlement-schema@example.test') RETURNING id INTO u;
  INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(w,u,'owner') RETURNING id INTO m;
  INSERT INTO people(workspace_id,given_name) VALUES(w,'Debtor') RETURNING id INTO p;
  INSERT INTO debts(workspace_id,person_id,direction,amount,status,settled_at) VALUES(w,p,'they_owe',1,'settled','2026-01-02T03:04:05.123456Z') RETURNING id INTO d;
  INSERT INTO files(workspace_id,original_filename,mime_type) VALUES(w,'paid.png','image/png') RETURNING id INTO f;
  INSERT INTO debt_settlements(workspace_id,debt_id,settled_at,reason,photo_file_id,photo_filename,created_by_member_id) VALUES(w,d,'2026-01-02T03:04:05.123456Z','Paid cash',f,'paid.png',m) RETURNING id INTO event_id;
  UPDATE debts SET status='open',settled_at=NULL WHERE id=d;
  IF NOT EXISTS(SELECT 1 FROM debt_settlements WHERE id=event_id AND reason='Paid cash' AND settled_at='2026-01-02T03:04:05.123456Z') THEN RAISE EXCEPTION 'reopen lost settlement history'; END IF;
  BEGIN
    INSERT INTO debt_settlements(workspace_id,debt_id,settled_at) VALUES(other_w,d,now());
    RAISE EXCEPTION 'foreign debt accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO debt_settlements(workspace_id,debt_id,settled_at,photo_file_id) VALUES(other_w,d,now(),f);
    RAISE EXCEPTION 'foreign settlement accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE files SET workspace_id=other_w WHERE id=f;
    RAISE EXCEPTION 'foreign photo update accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
DO $$
DECLARE w uuid; m uuid; d uuid; f uuid; event_id uuid;
BEGIN
  SELECT workspace_id,debt_id,photo_file_id,created_by_member_id,id INTO w,d,f,m,event_id FROM debt_settlements WHERE reason='Paid cash';
  DELETE FROM files WHERE id=f;
  DELETE FROM workspace_members WHERE id=m;
  IF NOT EXISTS(SELECT 1 FROM debt_settlements WHERE id=event_id AND workspace_id=w AND photo_file_id IS NULL AND created_by_member_id IS NULL AND photo_filename='paid.png') THEN RAISE EXCEPTION 'photo/actor deletion lost history or workspace'; END IF;
  DELETE FROM debts WHERE id=d;
  IF EXISTS(SELECT 1 FROM debt_settlements WHERE id=event_id) THEN RAISE EXCEPTION 'debt deletion retained history'; END IF;
END $$;

ROLLBACK;

SELECT 'schema_behavior_assertions_passed' AS result;
