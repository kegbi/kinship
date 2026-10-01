-- Transaction ownership belongs to the canonical migration runner.

ALTER TABLE crm.people
  ADD CONSTRAINT people_workspace_id_id_key UNIQUE (workspace_id, id);

CREATE TABLE crm.person_duplicate_dismissals (
  workspace_id uuid NOT NULL REFERENCES crm.workspaces(id) ON DELETE CASCADE,
  person_low_id uuid NOT NULL,
  person_high_id uuid NOT NULL,
  dismissed_by_member_id uuid REFERENCES crm.workspace_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, person_low_id, person_high_id),
  CONSTRAINT person_duplicate_dismissals_order_ck CHECK (person_low_id < person_high_id),
  CONSTRAINT person_duplicate_dismissals_low_person_fk FOREIGN KEY (workspace_id, person_low_id) REFERENCES crm.people(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT person_duplicate_dismissals_high_person_fk FOREIGN KEY (workspace_id, person_high_id) REFERENCES crm.people(workspace_id, id) ON DELETE CASCADE
);
COMMENT ON TABLE crm.person_duplicate_dismissals IS 'Workspace-shared decisions that two people are not duplicates. Each unordered pair is stored once, lower person id first.';
COMMENT ON COLUMN crm.person_duplicate_dismissals.workspace_id IS 'Workspace that owns the decision and both people.';
COMMENT ON COLUMN crm.person_duplicate_dismissals.person_low_id IS 'The pair member with the lower id; same workspace by composite foreign key.';
COMMENT ON COLUMN crm.person_duplicate_dismissals.person_high_id IS 'The pair member with the higher id; same workspace by composite foreign key.';
COMMENT ON COLUMN crm.person_duplicate_dismissals.dismissed_by_member_id IS 'Member who marked the pair as not duplicates, when still known.';
COMMENT ON COLUMN crm.person_duplicate_dismissals.created_at IS 'When the pair was dismissed, in UTC.';
CREATE INDEX person_duplicate_dismissals_high_idx
  ON crm.person_duplicate_dismissals (workspace_id, person_high_id);

-- Search (SEARCH-001) matches exactly these expressions, so each text group
-- reads its index instead of every row in the workspace.
CREATE INDEX activities_search_idx ON crm.activities
  USING gin (to_tsvector('simple', summary || ' ' || coalesce(description, '')));
CREATE INDEX notes_search_idx ON crm.notes
  USING gin (to_tsvector('simple', body));
CREATE INDEX journal_posts_search_idx ON crm.journal_posts
  USING gin (to_tsvector('simple', coalesce(title, '') || ' ' || body));
CREATE INDEX tasks_search_idx ON crm.tasks
  USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

-- Documentation only: email delivery (PLANNING-003) made the v8 wording stale.
COMMENT ON COLUMN crm.reminder_occurrences.channel IS
  'Delivery channel: in_app for the in-app reminder inbox or email for single reminder email and the daily digest.';

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'crm'
      AND indexname IN (
        'activities_search_idx',
        'notes_search_idx',
        'journal_posts_search_idx',
        'tasks_search_idx',
        'person_duplicate_dismissals_high_idx'
      )
  ) <> 5 OR EXISTS (SELECT 1 FROM crm.person_duplicate_dismissals) THEN
    RAISE EXCEPTION 'search index and duplicate dismissal postcondition failed';
  END IF;
END
$$;
