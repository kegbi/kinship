-- Schema v14 -> v15: the root table and its single-parent children join the
-- workspace backstop (REL-120, ADR 0008). Runs as the schema owner
-- (kinship_migrator, which bypasses row-level security) inside the runner's
-- one transaction. Each child gains its parent's workspace, backfilled from
-- the parent chain; a child whose parent chain no longer names one
-- workspace fails its NOT NULL or composite key here, and the whole upgrade
-- rolls back; see personal_crm_schema_v15_changes.md for recovery.
SET search_path = crm, public;

-- 1. Denormalized workspace_id on single-parent children, backfilled from the
-- parent. billing_subscription_items reads billing_subscriptions after it.
ALTER TABLE activity_emotions ADD COLUMN workspace_id uuid;
UPDATE activity_emotions child SET workspace_id = parent.workspace_id FROM activities parent WHERE parent.id = child.activity_id;
ALTER TABLE activity_emotions ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN activity_emotions.workspace_id IS 'Workspace of the activities row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE billing_subscriptions ADD COLUMN workspace_id uuid;
UPDATE billing_subscriptions child SET workspace_id = parent.workspace_id FROM billing_customers parent WHERE parent.id = child.billing_customer_id;
ALTER TABLE billing_subscriptions ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN billing_subscriptions.workspace_id IS 'Workspace of the billing customers row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE billing_subscription_items ADD COLUMN workspace_id uuid;
UPDATE billing_subscription_items child SET workspace_id = parent.workspace_id FROM billing_subscriptions parent WHERE parent.id = child.subscription_id;
ALTER TABLE billing_subscription_items ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN billing_subscription_items.workspace_id IS 'Workspace of the billing subscriptions row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE call_emotions ADD COLUMN workspace_id uuid;
UPDATE call_emotions child SET workspace_id = parent.workspace_id FROM calls parent WHERE parent.id = child.call_id;
ALTER TABLE call_emotions ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN call_emotions.workspace_id IS 'Workspace of the calls row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE data_import_entities ADD COLUMN workspace_id uuid;
UPDATE data_import_entities child SET workspace_id = parent.workspace_id FROM data_imports parent WHERE parent.id = child.import_id;
ALTER TABLE data_import_entities ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN data_import_entities.workspace_id IS 'Workspace of the data imports row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE data_import_reports ADD COLUMN workspace_id uuid;
UPDATE data_import_reports child SET workspace_id = parent.workspace_id FROM data_imports parent WHERE parent.id = child.import_id;
ALTER TABLE data_import_reports ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN data_import_reports.workspace_id IS 'Workspace of the data imports row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE location_weather_cache ADD COLUMN workspace_id uuid;
UPDATE location_weather_cache child SET workspace_id = parent.workspace_id FROM locations parent WHERE parent.id = child.location_id;
ALTER TABLE location_weather_cache ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN location_weather_cache.workspace_id IS 'Workspace of the locations row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE member_preferences ADD COLUMN workspace_id uuid;
UPDATE member_preferences child SET workspace_id = parent.workspace_id FROM workspace_members parent WHERE parent.id = child.member_id;
ALTER TABLE member_preferences ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN member_preferences.workspace_id IS 'Workspace of the workspace members row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE pets ADD COLUMN workspace_id uuid;
UPDATE pets child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE pets ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN pets.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE romantic_relationship_details ADD COLUMN workspace_id uuid;
UPDATE romantic_relationship_details child SET workspace_id = parent.workspace_id FROM relationships parent WHERE parent.id = child.relationship_id;
ALTER TABLE romantic_relationship_details ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN romantic_relationship_details.workspace_id IS 'Workspace of the relationships row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';

-- 2. Every newly referenced parent is unique by (workspace_id, id).
ALTER TABLE billing_customers ADD CONSTRAINT billing_customers_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE billing_subscriptions ADD CONSTRAINT billing_subscriptions_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE calls ADD CONSTRAINT calls_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE data_import_entities ADD CONSTRAINT data_import_entities_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE data_imports ADD CONSTRAINT data_imports_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE relationships ADD CONSTRAINT relationships_workspace_id_id_key UNIQUE (workspace_id, id);

-- 3. Every child's reference to its parent carries the workspace.
ALTER TABLE activity_emotions DROP CONSTRAINT activity_emotions_activity_id_fkey,
  ADD CONSTRAINT activity_emotions_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE billing_subscription_items DROP CONSTRAINT billing_subscription_items_subscription_id_fkey,
  ADD CONSTRAINT billing_subscription_items_subscription_id_fkey FOREIGN KEY (workspace_id, subscription_id) REFERENCES billing_subscriptions (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE billing_subscriptions DROP CONSTRAINT billing_subscriptions_billing_customer_id_fkey,
  ADD CONSTRAINT billing_subscriptions_billing_customer_id_fkey FOREIGN KEY (workspace_id, billing_customer_id) REFERENCES billing_customers (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE call_emotions DROP CONSTRAINT call_emotions_call_id_fkey,
  ADD CONSTRAINT call_emotions_call_id_fkey FOREIGN KEY (workspace_id, call_id) REFERENCES calls (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE data_import_entities DROP CONSTRAINT data_import_entities_import_id_fkey,
  ADD CONSTRAINT data_import_entities_import_id_fkey FOREIGN KEY (workspace_id, import_id) REFERENCES data_imports (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE data_import_reports DROP CONSTRAINT data_import_reports_entity_id_fkey,
  ADD CONSTRAINT data_import_reports_entity_id_fkey FOREIGN KEY (workspace_id, entity_id) REFERENCES data_import_entities (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE data_import_reports DROP CONSTRAINT data_import_reports_import_id_fkey,
  ADD CONSTRAINT data_import_reports_import_id_fkey FOREIGN KEY (workspace_id, import_id) REFERENCES data_imports (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE location_weather_cache DROP CONSTRAINT location_weather_cache_location_id_fkey,
  ADD CONSTRAINT location_weather_cache_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE member_preferences DROP CONSTRAINT member_preferences_member_id_fkey,
  ADD CONSTRAINT member_preferences_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE pets DROP CONSTRAINT pets_person_id_fkey,
  ADD CONSTRAINT pets_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE romantic_relationship_details DROP CONSTRAINT romantic_relationship_details_relationship_id_fkey,
  ADD CONSTRAINT romantic_relationship_details_relationship_id_fkey FOREIGN KEY (workspace_id, relationship_id) REFERENCES relationships (workspace_id, id) ON DELETE CASCADE;

-- 4. Forced row-level security: each child on its workspace_id, the root
-- workspaces table on its own id. An unset or emptied setting matches none.
ALTER TABLE activity_emotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_emotions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_emotions
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE billing_subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscription_items FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON billing_subscription_items
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON billing_subscriptions
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE call_emotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_emotions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON call_emotions
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_import_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_import_entities FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_import_entities
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_import_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_import_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_import_reports
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE location_weather_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_weather_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON location_weather_cache
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE member_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON member_preferences
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pets FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON pets
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE romantic_relationship_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE romantic_relationship_details FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON romantic_relationship_details
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspaces
  USING (id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- 5. The narrow paths that read workspaces before a scope is set keep doing
-- so, each through its own policy, as they read workspace_members: session
-- resolution and the switcher, registration cleanup, account and workspace
-- lifecycle. The worker reads members' delivery choices across workspaces,
-- and its stale-registration purge reads workspaces before any scope is set;
-- it deletes one only from inside that workspace's scope.
CREATE POLICY session_resolution ON workspaces FOR SELECT
  TO kinship_session_resolver USING (true);
CREATE POLICY registration_cleanup ON workspaces FOR SELECT
  TO kinship_registration USING (true);
CREATE POLICY account_lifecycle ON workspaces FOR SELECT
  TO kinship_account_lifecycle USING (true);
CREATE POLICY workspace_lifecycle ON workspaces FOR SELECT
  TO kinship_workspace_lifecycle USING (true);
CREATE POLICY worker_scan ON member_preferences FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspaces FOR SELECT TO kinship_worker USING (true);
