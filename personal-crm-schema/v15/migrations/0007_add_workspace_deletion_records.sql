CREATE TABLE crm.workspace_lifecycle_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  impact_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  object_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  cleanup_status text NOT NULL DEFAULT 'pending',
  occurred_at timestamptz NOT NULL,
  cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(impact_counts) = 'object'),
  CHECK (jsonb_typeof(object_keys) = 'array'),
  CHECK (cleanup_status IN ('pending', 'complete')),
  CHECK ((cleanup_status = 'complete') = (cleanup_completed_at IS NOT NULL)),
  CHECK (action IN ('reset', 'delete')),
  CHECK (outcome IN ('succeeded', 'forbidden', 'rate-limited', 'reauthentication-required', 'confirmation-invalid', 'stale-impact', 'transactional-failure'))
);
COMMENT ON TABLE crm.workspace_lifecycle_records IS 'Minimal destructive-workspace security result and bounded object cleanup state retained outside workspace data.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.id IS 'Stable lifecycle record and cleanup receipt identifier.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.workspace_id IS 'Affected workspace identifier snapshot; deliberately not a foreign key.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.actor_user_id IS 'Acting owner identity snapshot; deliberately not a foreign key.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.action IS 'reset or delete destructive workspace action.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.outcome IS 'Redacted result of a destructive workspace attempt.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.impact_counts IS 'Non-identifying counts confirmed by the owner before the action.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.object_keys IS 'Internal object keys required only until cleanup completes.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.cleanup_status IS 'pending or complete object cleanup state.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.occurred_at IS 'Atomic destructive database action timestamp.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.cleanup_completed_at IS 'Timestamp when every captured object was removed.';
COMMENT ON COLUMN crm.workspace_lifecycle_records.created_at IS 'Creation timestamp in UTC.';
CREATE INDEX workspace_lifecycle_records_pending_idx
  ON crm.workspace_lifecycle_records (created_at, id)
  WHERE cleanup_status = 'pending';
