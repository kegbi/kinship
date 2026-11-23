-- Schema v15 -> v16: request tombstones (MCP-E3). Runs as the schema owner
-- (kinship_migrator) inside the runner's one transaction. It adds one
-- workspace-owned table under the v14 isolation policy and changes nothing
-- else. Retry keys on the creates that read it exist only on unreleased code,
-- so no existing row needs a tombstone and nothing is backfilled; see
-- personal_crm_schema_v16_changes.md.
SET search_path = crm, public;

CREATE TABLE request_tombstones (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id uuid NOT NULL,
  record_type text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, record_id),
  CONSTRAINT request_tombstones_record_type_ck CHECK (record_type IN ('activity', 'call', 'conversation', 'debt', 'gift', 'journal_post', 'note', 'recurring_debt'))
);
COMMENT ON TABLE request_tombstones IS 'Ids of permanently deleted records a retry key derived, so a keyed create replayed after the delete is refused instead of recording the record again (MCP-E3). Append-only; a workspace deletion or reset removes them with the workspace.';
COMMENT ON COLUMN request_tombstones.workspace_id IS 'Workspace the deleted record belonged to; the retry key is the workspace''s.';
COMMENT ON COLUMN request_tombstones.record_id IS 'Id of the deleted record, as derived from the workspace and the create''s requestId.';
COMMENT ON COLUMN request_tombstones.record_type IS 'Kind of the deleted record: activity, call, conversation, debt, gift, journal_post, note, or recurring_debt.';
COMMENT ON COLUMN request_tombstones.deleted_at IS 'When the record was deleted, in UTC.';

ALTER TABLE request_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_tombstones FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON request_tombstones
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The API reads and adds tombstones and never changes or removes one; a
-- workspace deletion or reset removes them through the workspace cascade,
-- which runs as the table's owner. The worker never touches them.
GRANT SELECT, INSERT ON request_tombstones TO kinship_app;
