SET search_path = crm, public;

ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE files ADD CONSTRAINT files_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE debts ADD CONSTRAINT debts_workspace_id_id_key UNIQUE (workspace_id, id);

CREATE TABLE debt_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  debt_id uuid NOT NULL,
  settled_at timestamptz NOT NULL,
  reason text,
  photo_file_id uuid,
  photo_filename text,
  created_by_member_id uuid,
  CONSTRAINT debt_settlements_debt_fk FOREIGN KEY (workspace_id, debt_id) REFERENCES debts(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT debt_settlements_photo_fk FOREIGN KEY (workspace_id, photo_file_id) REFERENCES files(workspace_id, id) ON DELETE SET NULL (photo_file_id),
  CONSTRAINT debt_settlements_actor_fk FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members(workspace_id, id) ON DELETE SET NULL (created_by_member_id),
  CONSTRAINT debt_settlements_reason_ck CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 10000),
  CONSTRAINT debt_settlements_photo_filename_ck CHECK (photo_filename IS NULL OR length(photo_filename) BETWEEN 1 AND 500)
);
COMMENT ON TABLE debt_settlements IS 'Append-only debt settlement history. Reopening a debt retains earlier settlements; explicit debt/person/workspace deletion cascades history.';
COMMENT ON COLUMN debt_settlements.id IS 'Stable settlement event identity; initial imported and backfilled settlements use their debt identifier.';
COMMENT ON COLUMN debt_settlements.workspace_id IS 'Workspace that owns the debt and this settlement.';
COMMENT ON COLUMN debt_settlements.debt_id IS 'Debt settled by this event; retained across reopening and person merges.';
COMMENT ON COLUMN debt_settlements.settled_at IS 'Original settlement timestamp in UTC, retained after the debt is reopened.';
COMMENT ON COLUMN debt_settlements.reason IS 'Optional explanation of how or why the debt was settled, separate from the original debt reason.';
COMMENT ON COLUMN debt_settlements.photo_file_id IS 'Optional image validated through files for the same person and workspace; cleared on hard file deletion.';
COMMENT ON COLUMN debt_settlements.photo_filename IS 'Original photo filename retained when the image later becomes unavailable or is removed.';
COMMENT ON COLUMN debt_settlements.created_by_member_id IS 'Member who settled the debt; null for historical imports/backfills or after member deletion.';
CREATE INDEX debt_settlements_debt_idx ON debt_settlements (workspace_id, debt_id, settled_at DESC, id);

-- Only the current known settlement can be recovered; previously reopened debt history was not stored.
INSERT INTO debt_settlements (id, workspace_id, debt_id, settled_at)
SELECT id, workspace_id, id, settled_at FROM debts
WHERE status = 'settled' AND settled_at IS NOT NULL;
