-- Schema v14 (ADR 0008): the database backstops workspace isolation.
-- Runs as the scratch cluster's superuser against a database holding the
-- canonical DDL, and acts as the service roles with SET ROLE, which binds
-- row-level security exactly as a login as that role would.
\set ON_ERROR_STOP on

DO $$
DECLARE
  offending text;
BEGIN
  -- The service and function-owner roles are not superusers and do not
  -- bypass row-level security; only the migrator does, and it cannot log in
  -- here.
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO offending
  FROM pg_roles
  WHERE rolname LIKE 'kinship\_%'
    AND (rolsuper OR (rolbypassrls AND rolname <> 'kinship_migrator'));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'roles that are superusers or bypass RLS: %', offending;
  END IF;

  -- Every table with a workspace_id forces row-level security under the one
  -- isolation policy, in its exact form.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO offending
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'crm'
  WHERE c.relkind = 'r'
    AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
      AND a.attname = 'workspace_id' AND NOT a.attisdropped)
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (
      SELECT 1 FROM pg_policy p
      WHERE p.polrelid = c.oid AND p.polname = 'workspace_isolation'
        AND p.polcmd = '*' AND p.polpermissive AND p.polroles = '{0}'
        AND pg_get_expr(p.polqual, p.polrelid) =
          '(workspace_id = (NULLIF(current_setting(''app.workspace_id''::text, true), ''''::text))::uuid)'
        AND pg_get_expr(p.polwithcheck, p.polrelid) =
          pg_get_expr(p.polqual, p.polrelid)
    ));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'tenant tables without the forced isolation policy: %', offending;
  END IF;
  IF (SELECT count(*) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'crm'
      WHERE c.relkind = 'r' AND c.relforcerowsecurity) <> 64 THEN
    RAISE EXCEPTION 'expected 64 tenant tables under forced row-level security';
  END IF;

  -- Every reference between two tenant tables carries the workspace, apart
  -- from the one request-log key that outlives its workspace.
  SELECT string_agg(con.conname, ', ' ORDER BY con.conname) INTO offending
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  WHERE con.contype = 'f' AND con.connamespace = 'crm'::regnamespace
    AND src.relforcerowsecurity AND tgt.relforcerowsecurity
    AND con.conname <> 'api_request_logs_member_id_fkey'
    AND NOT EXISTS (
      SELECT 1 FROM unnest(con.conkey) k(attnum)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE a.attname = 'workspace_id'
    );
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'tenant references without their workspace: %', offending;
  END IF;

  -- Every function is a SECURITY DEFINER with a pinned search path, owned by
  -- a role that neither logs in nor bypasses row-level security, and callable
  -- only by the service roles.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO offending
  FROM pg_proc p
  JOIN pg_roles owner ON owner.oid = p.proowner
  WHERE p.pronamespace = 'crm'::regnamespace
    AND NOT (p.prosecdef
      AND p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']
      AND NOT owner.rolcanlogin AND NOT owner.rolbypassrls
      AND NOT owner.rolsuper
      AND NOT has_function_privilege('public', p.oid, 'EXECUTE'));
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'cross-workspace functions that are not narrow: %', offending;
  END IF;

  -- The API's role has no DDL: it creates nothing in crm or public.
  IF has_schema_privilege('kinship_app', 'crm', 'CREATE')
    OR has_schema_privilege('kinship_app', 'public', 'CREATE')
    OR has_schema_privilege('kinship_worker', 'crm', 'CREATE') THEN
    RAISE EXCEPTION 'a service role can create objects';
  END IF;
END
$$;

-- The reference guard (ADR 0008), the same rules and lists as
-- tests/integration/workspace_isolation_postgres_test.ts and
-- tests/support/workspace_references.ts:
--
-- - from a table without forced row-level security into a tenant table, only
--   today's single-parent children, each with its one parent;
-- - into a workspace-owned table that row-level security does not bind (the
--   root workspaces table, and every child either list names), only a forced
--   table's own workspace key, exactly (workspace_id) -> workspaces(id), or a
--   listed further level below a child;
-- - every listed reference still exists.
--
-- Any other such reference — a link table without its own workspace_id, or a
-- table below an unforced child — has neither a forced policy nor a composite
-- key, so it fails here.
CREATE FUNCTION pg_temp.single_parent_references()
RETURNS TABLE (name text, child text, parent text)
LANGUAGE sql AS $function$
  VALUES
    ('activity_emotions_activity_id_fkey', 'activity_emotions', 'activities'),
    ('billing_subscriptions_billing_customer_id_fkey', 'billing_subscriptions', 'billing_customers'),
    ('call_emotions_call_id_fkey', 'call_emotions', 'calls'),
    ('data_import_entities_import_id_fkey', 'data_import_entities', 'data_imports'),
    ('data_import_reports_import_id_fkey', 'data_import_reports', 'data_imports'),
    ('location_weather_cache_location_id_fkey', 'location_weather_cache', 'locations'),
    ('member_preferences_member_id_fkey', 'member_preferences', 'workspace_members'),
    ('pets_person_id_fkey', 'pets', 'people'),
    ('romantic_relationship_details_relationship_id_fkey', 'romantic_relationship_details', 'relationships')
$function$;

CREATE FUNCTION pg_temp.unforced_child_references()
RETURNS TABLE (name text, child text, parent text)
LANGUAGE sql AS $function$
  VALUES
    ('billing_subscription_items_subscription_id_fkey', 'billing_subscription_items', 'billing_subscriptions'),
    ('data_import_reports_entity_id_fkey', 'data_import_reports', 'data_import_entities')
$function$;

CREATE FUNCTION pg_temp.unlisted_unforced_references() RETURNS text
LANGUAGE sql AS $function$
  WITH fk AS (
    SELECT con.conname::text AS name, src.relname::text AS child,
      tgt.relname::text AS parent, src.relforcerowsecurity AS forced,
      tgt.relforcerowsecurity AS parent_forced,
      (
        con.confrelid = 'crm.workspaces'::regclass
        AND cardinality(con.conkey) = 1 AND cardinality(con.confkey) = 1
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
            AND a.attname = 'workspace_id'
        )
        AND EXISTS (
          SELECT 1 FROM pg_attribute a
          WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]
            AND a.attname = 'id'
        )
      ) AS workspace_key
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class tgt ON tgt.oid = con.confrelid
    WHERE con.contype = 'f' AND con.connamespace = 'crm'::regnamespace
  ), unforced_tenant AS (
    SELECT 'workspaces' AS name
    UNION SELECT child FROM pg_temp.single_parent_references()
    UNION SELECT child FROM pg_temp.unforced_child_references()
  ), listed AS (
    SELECT * FROM pg_temp.single_parent_references()
    UNION ALL SELECT * FROM pg_temp.unforced_child_references()
  )
  SELECT string_agg(offending, ', ' ORDER BY offending) FROM (
    SELECT fk.name AS offending FROM fk
    WHERE NOT fk.forced AND fk.parent_forced
      AND (fk.name, fk.child, fk.parent) NOT IN (
        SELECT * FROM pg_temp.single_parent_references())
    UNION
    SELECT fk.name FROM fk
    WHERE fk.parent IN (SELECT name FROM unforced_tenant)
      AND NOT (fk.forced AND fk.workspace_key)
      AND (fk.name, fk.child, fk.parent) NOT IN (
        SELECT * FROM pg_temp.unforced_child_references())
    UNION
    SELECT 'stale: ' || listed.name FROM listed
    WHERE NOT EXISTS (
      SELECT 1 FROM fk
      WHERE (fk.name, fk.child, fk.parent) = (listed.name, listed.child, listed.parent))
  ) refused
$function$;

DO $$
DECLARE
  offending text := pg_temp.unlisted_unforced_references();
BEGIN
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'references the reference guard refuses: %', offending;
  END IF;
  -- The guard catches the shapes it exists for, and each block rolls back:
  -- a link table without workspace_id, and a table below an unforced child.
  BEGIN
    CREATE TABLE crm.person_x_links (
      person_id uuid NOT NULL REFERENCES crm.people (id),
      x_id uuid NOT NULL
    );
    IF pg_temp.unlisted_unforced_references() IS DISTINCT FROM 'person_x_links_person_id_fkey' THEN
      RAISE EXCEPTION 'a link table without workspace_id passed the reference guard';
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'reference guard self-test rolled back';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reference guard self-test rolled back' THEN RAISE; END IF;
  END;
  BEGIN
    CREATE TABLE crm.pet_photos (
      pet_id uuid NOT NULL REFERENCES crm.pets (id),
      caption text
    );
    IF pg_temp.unlisted_unforced_references() IS DISTINCT FROM 'pet_photos_pet_id_fkey' THEN
      RAISE EXCEPTION 'a table below an unforced child passed the reference guard';
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'reference guard self-test rolled back';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reference guard self-test rolled back' THEN RAISE; END IF;
  END;
  -- Keys on a forced table that are not its own workspace key: a
  -- workspace_id compared with something other than a workspace's id (a
  -- person id through pets, a user id through workspaces), and a column other
  -- than workspace_id into workspaces(id). None passes as the table's own
  -- workspace key.
  BEGIN
    CREATE UNIQUE INDEX pets_person_id_id_unique ON crm.pets (person_id, id);
    CREATE TABLE crm.pet_x_links (
      workspace_id uuid NOT NULL,
      pet_id uuid NOT NULL,
      CONSTRAINT pet_x_links_pet_fkey FOREIGN KEY (workspace_id, pet_id)
        REFERENCES crm.pets (person_id, id)
    );
    ALTER TABLE crm.pet_x_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.pet_x_links FORCE ROW LEVEL SECURITY;
    IF pg_temp.unlisted_unforced_references() IS DISTINCT FROM 'pet_x_links_pet_fkey' THEN
      RAISE EXCEPTION 'a workspace_id key into pets passed the reference guard';
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'reference guard self-test rolled back';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reference guard self-test rolled back' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE crm.workspaces SET created_by_user_id = NULL;
    CREATE UNIQUE INDEX workspaces_created_by_user_id_unique
      ON crm.workspaces (created_by_user_id);
    CREATE TABLE crm.creator_x_links (
      workspace_id uuid NOT NULL,
      CONSTRAINT creator_x_links_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES crm.workspaces (created_by_user_id)
    );
    ALTER TABLE crm.creator_x_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.creator_x_links FORCE ROW LEVEL SECURITY;
    IF pg_temp.unlisted_unforced_references() IS DISTINCT FROM 'creator_x_links_workspace_fkey' THEN
      RAISE EXCEPTION 'a workspace_id key into workspaces(created_by_user_id) passed the reference guard';
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'reference guard self-test rolled back';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reference guard self-test rolled back' THEN RAISE; END IF;
  END;
  BEGIN
    CREATE TABLE crm.owner_x_links (
      owner_id uuid REFERENCES crm.workspaces (id)
    );
    ALTER TABLE crm.owner_x_links ENABLE ROW LEVEL SECURITY;
    ALTER TABLE crm.owner_x_links FORCE ROW LEVEL SECURITY;
    IF pg_temp.unlisted_unforced_references() IS DISTINCT FROM 'owner_x_links_owner_id_fkey' THEN
      RAISE EXCEPTION 'a key from a column other than workspace_id into workspaces(id) passed the reference guard';
    END IF;
    RAISE EXCEPTION USING MESSAGE = 'reference guard self-test rolled back';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'reference guard self-test rolled back' THEN RAISE; END IF;
  END;
  IF to_regclass('crm.person_x_links') IS NOT NULL
    OR to_regclass('crm.pet_photos') IS NOT NULL
    OR to_regclass('crm.pet_x_links') IS NOT NULL
    OR to_regclass('crm.creator_x_links') IS NOT NULL
    OR to_regclass('crm.owner_x_links') IS NOT NULL
    OR to_regclass('crm.pets_person_id_id_unique') IS NOT NULL
    OR to_regclass('crm.workspaces_created_by_user_id_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'a reference guard self-test left its table behind';
  END IF;
END
$$;

-- Behavior as the API's role: two workspaces with one person each.
BEGIN;
INSERT INTO crm.users (id, email) VALUES
  ('00000000-0000-4000-8000-00000000a001', 'isolation-a@example.test'),
  ('00000000-0000-4000-8000-00000000b001', 'isolation-b@example.test');
INSERT INTO crm.workspaces (id, name, created_by_user_id) VALUES
  ('00000000-0000-4000-8000-00000000a0a0', 'Isolation A', '00000000-0000-4000-8000-00000000a001'),
  ('00000000-0000-4000-8000-00000000b0b0', 'Isolation B', '00000000-0000-4000-8000-00000000b001');
INSERT INTO crm.people (id, workspace_id, given_name) VALUES
  ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-00000000a0a0', 'Ann'),
  ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-00000000b0b0', 'Bob');
INSERT INTO crm.tags (id, workspace_id, name, slug) VALUES
  ('00000000-0000-4000-8000-0000000a7a90', '00000000-0000-4000-8000-00000000a0a0', 'friends', 'friends');
SET LOCAL ROLE kinship_app;
DO $$
BEGIN
  IF (SELECT count(*) FROM crm.people) <> 0 THEN
    RAISE EXCEPTION 'a transaction without app.workspace_id sees tenant rows';
  END IF;
  PERFORM set_config('app.workspace_id', '00000000-0000-4000-8000-00000000a0a0', true);
  IF (SELECT count(*) FROM crm.people) <> 1
    OR (SELECT given_name FROM crm.people) <> 'Ann' THEN
    RAISE EXCEPTION 'a scoped transaction does not see exactly its workspace';
  END IF;
  -- The link row's workspace defaults from the scope.
  INSERT INTO crm.person_tags (person_id, tag_id)
  VALUES ('00000000-0000-4000-8000-0000000a0001', '00000000-0000-4000-8000-0000000a7a90');
  IF (SELECT workspace_id FROM crm.person_tags) <> '00000000-0000-4000-8000-00000000a0a0' THEN
    RAISE EXCEPTION 'a link row does not take its workspace from the scope';
  END IF;
  -- An emptied setting, as a pooled connection reads it back after a
  -- transaction that set it, matches nothing and does not fail the cast.
  PERFORM set_config('app.workspace_id', '', true);
  IF (SELECT count(*) FROM crm.people) <> 0 THEN
    RAISE EXCEPTION 'an emptied app.workspace_id sees tenant rows';
  END IF;
  -- A write into another workspace than the scope's is refused.
  PERFORM set_config('app.workspace_id', '00000000-0000-4000-8000-00000000a0a0', true);
  BEGIN
    INSERT INTO crm.people (workspace_id, given_name)
    VALUES ('00000000-0000-4000-8000-00000000b0b0', 'Intruder');
    RAISE EXCEPTION 'a row was written into another workspace';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- A reference to another workspace's row is refused at the database, even
  -- when the row's own workspace is the scope's.
  PERFORM set_config('app.workspace_id', '00000000-0000-4000-8000-00000000b0b0', true);
  BEGIN
    INSERT INTO crm.notes (workspace_id, person_id, body)
    VALUES ('00000000-0000-4000-8000-00000000b0b0', '00000000-0000-4000-8000-0000000a0001', 'cross');
    RAISE EXCEPTION 'a cross-workspace composite reference was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO crm.person_tags (person_id, tag_id)
    VALUES ('00000000-0000-4000-8000-0000000b0001', '00000000-0000-4000-8000-0000000a7a90');
    RAISE EXCEPTION 'a link row bridging two workspaces was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$$;
ROLLBACK;

-- The narrow functions' own refusals, as the API's role: session resolution
-- names only active memberships of active workspaces; an enter_* function
-- scopes the transaction to the secret's workspace, leaves it unscoped for an
-- unknown secret, and refuses to move a transaction scoped to another one.
BEGIN;
INSERT INTO crm.users (id, email, email_verified_at) VALUES
  ('00000000-0000-4000-8000-00000000c001', 'definer@example.test', now());
INSERT INTO crm.workspaces (id, name, created_by_user_id, deleted_at) VALUES
  ('00000000-0000-4000-8000-00000000c0a0', 'Active', '00000000-0000-4000-8000-00000000c001', NULL),
  ('00000000-0000-4000-8000-00000000c0b0', 'Suspended in', '00000000-0000-4000-8000-00000000c001', NULL),
  ('00000000-0000-4000-8000-00000000c0c0', 'Left', '00000000-0000-4000-8000-00000000c001', NULL),
  ('00000000-0000-4000-8000-00000000c0d0', 'Deleted', '00000000-0000-4000-8000-00000000c001', now());
INSERT INTO crm.workspace_members (workspace_id, user_id, role, status, left_at, joined_at) VALUES
  ('00000000-0000-4000-8000-00000000c0a0', '00000000-0000-4000-8000-00000000c001', 'owner', 'active', NULL, now()),
  ('00000000-0000-4000-8000-00000000c0b0', '00000000-0000-4000-8000-00000000c001', 'member', 'suspended', NULL, now()),
  ('00000000-0000-4000-8000-00000000c0c0', '00000000-0000-4000-8000-00000000c001', 'member', 'left', now(), now()),
  ('00000000-0000-4000-8000-00000000c0d0', '00000000-0000-4000-8000-00000000c001', 'owner', 'active', NULL, now());
INSERT INTO crm.api_tokens (id, workspace_id, user_id, name, token_hash) VALUES
  ('00000000-0000-4000-8000-00000000c7a0', '00000000-0000-4000-8000-00000000c0a0',
   '00000000-0000-4000-8000-00000000c001', 'Definer test', 'definer-token-hash');
INSERT INTO crm.workspace_invitations (workspace_id, email, token_hash, role, status) VALUES
  ('00000000-0000-4000-8000-00000000c0b0', 'invitee@example.test', 'definer-invitation-hash', 'member', 'pending');
SET LOCAL ROLE kinship_app;
DO $$
DECLARE
  scoped text;
BEGIN
  IF (SELECT array_agg(workspace_id ORDER BY workspace_id)
      FROM crm.session_workspace_contexts('00000000-0000-4000-8000-00000000c001'))
      IS DISTINCT FROM ARRAY['00000000-0000-4000-8000-00000000c0a0'::uuid] THEN
    RAISE EXCEPTION 'session resolution named a suspended, left, or deleted membership';
  END IF;

  -- An unknown secret answers null and leaves the transaction unscoped.
  IF crm.enter_api_token_workspace('00000000-0000-4000-8000-00000000ffff') IS NOT NULL
    OR crm.enter_invitation_workspace('no-such-invitation') IS NOT NULL
    OR coalesce(current_setting('app.workspace_id', true), '') <> '' THEN
    RAISE EXCEPTION 'an unknown secret scoped the transaction';
  END IF;

  -- A known secret scopes it to the secret's workspace, and entering the same
  -- workspace again is allowed.
  IF crm.enter_api_token_workspace('00000000-0000-4000-8000-00000000c7a0')
      IS DISTINCT FROM '00000000-0000-4000-8000-00000000c0a0'::uuid
    OR current_setting('app.workspace_id', true) <> '00000000-0000-4000-8000-00000000c0a0'
    OR crm.enter_api_token_workspace('00000000-0000-4000-8000-00000000c7a0')
      IS DISTINCT FROM '00000000-0000-4000-8000-00000000c0a0'::uuid THEN
    RAISE EXCEPTION 'a token did not scope the transaction to its workspace';
  END IF;

  -- Already scoped to A, neither function moves the transaction to B.
  BEGIN
    PERFORM crm.enter_invitation_workspace('definer-invitation-hash');
    RAISE EXCEPTION 'an invitation moved a transaction scoped to another workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'transaction is already scoped to another workspace' THEN RAISE; END IF;
  END;
  PERFORM set_config('app.workspace_id', '00000000-0000-4000-8000-00000000c0b0', true);
  BEGIN
    PERFORM crm.enter_api_token_workspace('00000000-0000-4000-8000-00000000c7a0');
    RAISE EXCEPTION 'a token moved a transaction scoped to another workspace';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'transaction is already scoped to another workspace' THEN RAISE; END IF;
  END;
  scoped := current_setting('app.workspace_id', true);
  IF scoped <> '00000000-0000-4000-8000-00000000c0b0' THEN
    RAISE EXCEPTION 'a refused entry changed the scope to %', scoped;
  END IF;
END
$$;
ROLLBACK;
