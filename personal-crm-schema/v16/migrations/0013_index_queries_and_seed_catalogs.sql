-- Repository schema v12 to v13: indexes that match the queries, the MFA
-- challenge session purpose, a pending registration's workspace name, and the
-- global emotion and pet catalogs seeded.
-- Transaction ownership belongs to the canonical migration runner. Each index
-- is built inside that transaction, so writes to its table wait until commit.

-- The Today feed and attention read a member's own occurrences: delivered
-- in-app ones in the feed's order, and open ones by their effective time.
-- reminder_occurrences_member_idx stays: a removed member's delete cascade
-- finds every occurrence of theirs, the sent history included.
CREATE INDEX reminder_occurrences_member_feed_idx
  ON crm.reminder_occurrences (member_id, date_trunc('milliseconds', visible_at AT TIME ZONE 'UTC') DESC, id DESC)
  WHERE channel = 'in_app' AND status = 'sent' AND visible_at IS NOT NULL;
CREATE INDEX reminder_occurrences_member_open_idx
  ON crm.reminder_occurrences (member_id, (CASE WHEN status = 'retry' THEN next_attempt_at ELSE deliver_at END))
  WHERE status IN ('pending', 'retry', 'failed', 'manual_attention');

-- Today's recent activity reads the newest notes of a workspace.
CREATE INDEX notes_workspace_created_idx
  ON crm.notes (workspace_id, created_at DESC, id DESC);

-- The directory's default order and its continuation, and the duplicate-name
-- check on create, on the exact expressions their statements use.
CREATE INDEX people_active_given_name_idx
  ON crm.people (workspace_id, lower(COALESCE(NULLIF(btrim(given_name), ''), NULLIF(btrim(nickname), ''), NULLIF(btrim(family_name), ''), '')), lower(COALESCE(family_name, '')), id)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX people_active_duplicate_name_idx
  ON crm.people (workspace_id, lower(btrim(given_name)), lower(btrim(COALESCE(family_name, ''))), lower(btrim(COALESCE(nickname, ''))))
  WHERE archived_at IS NULL AND deleted_at IS NULL;
DROP INDEX crm.people_active_name_idx;
DROP INDEX crm.people_workspace_idx;

-- A date, life event, or task finds its reminder, and their deletes cascade.
CREATE INDEX reminders_person_date_idx
  ON crm.reminders (person_date_id) WHERE person_date_id IS NOT NULL;
CREATE INDEX reminders_life_event_idx
  ON crm.reminders (life_event_id) WHERE life_event_id IS NOT NULL;
CREATE INDEX reminders_task_idx
  ON crm.reminders (task_id) WHERE task_id IS NOT NULL;

-- Authentication budgets count an address's and an account's attempts in
-- every outcome, so the failures-only index serves no statement any more.
CREATE INDEX api_request_logs_post_subject_idx
  ON crm.api_request_logs (path, authentication_subject_digest, occurred_at DESC)
  WHERE method = 'POST';
DROP INDEX crm.api_request_logs_auth_subject_idx;

-- Redundant prefixes, an unread column, and low-selectivity status indexes.
DROP INDEX crm.person_dates_person_idx;
DROP INDEX crm.person_contact_methods_normalized_idx;
DROP INDEX crm.users_status_idx;
DROP INDEX crm.workspaces_status_idx;
DROP INDEX crm.workspace_members_status_idx;
DROP INDEX crm.debts_status_idx;

-- A durable MFA challenge is a hashed session row of its own purpose.
ALTER TABLE crm.user_sessions DROP CONSTRAINT user_sessions_purpose_check;
ALTER TABLE crm.user_sessions
  ADD CONSTRAINT user_sessions_purpose_check
  CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy', 'mfa-challenge'));
COMMENT ON COLUMN crm.user_sessions.purpose IS
  'Exact authority purpose: authenticated session, verified identity entry, revoked legacy authority, or a pending MFA challenge.';

-- A registration holds the workspace name it asked for until verification
-- provisions the workspace. Existing users have none: no backfill.
ALTER TABLE crm.users
  ADD COLUMN pending_workspace_name text,
  ADD CONSTRAINT users_pending_workspace_name_ck CHECK (
    pending_workspace_name IS NULL OR (
      pending_workspace_name = btrim(pending_workspace_name)
      AND char_length(pending_workspace_name) BETWEEN 1 AND 120
    )
  );
COMMENT ON COLUMN crm.users.pending_workspace_name IS
  'Workspace name a pending registration asked for, held until email verification provisions that workspace; null otherwise.';

-- The global catalogs are seeded once. A name a Monica import already added
-- is kept as it is, with its id, so the rows that reference it are untouched.
INSERT INTO crm.emotion_options (name, sort_order)
SELECT stock.name, stock.sort_order
FROM (VALUES
    ('adoration', 1),
    ('affection', 2),
    ('love', 3),
    ('fondness', 4),
    ('liking', 5),
    ('attraction', 6),
    ('caring', 7),
    ('tenderness', 8),
    ('compassion', 9),
    ('sentimentality', 10),
    ('arousal', 11),
    ('desire', 12),
    ('lust', 13),
    ('passion', 14),
    ('infatuation', 15),
    ('longing', 16),
    ('amusement', 17),
    ('bliss', 18),
    ('cheerfulness', 19),
    ('gaiety', 20),
    ('glee', 21),
    ('jolliness', 22),
    ('joviality', 23),
    ('joy', 24),
    ('delight', 25),
    ('enjoyment', 26),
    ('gladness', 27),
    ('happiness', 28),
    ('jubilation', 29),
    ('elation', 30),
    ('satisfaction', 31),
    ('ecstasy', 32),
    ('euphoria', 33),
    ('enthusiasm', 34),
    ('zeal', 35),
    ('zest', 36),
    ('excitement', 37),
    ('thrill', 38),
    ('exhilaration', 39),
    ('contentment', 40),
    ('pleasure', 41),
    ('pride', 42),
    ('eagerness', 44),
    ('hope', 45),
    ('enthrallment', 46),
    ('rapture', 47),
    ('relief', 48),
    ('amazement', 49),
    ('surprise', 50),
    ('astonishment', 51),
    ('aggravation', 52),
    ('irritation', 53),
    ('agitation', 54),
    ('annoyance', 55),
    ('grouchiness', 56),
    ('grumpiness', 57),
    ('exasperation', 58),
    ('frustration', 59),
    ('anger', 60),
    ('rage', 61),
    ('outrage', 62),
    ('fury', 63),
    ('wrath', 64),
    ('hostility', 65),
    ('ferocity', 66),
    ('bitterness', 67),
    ('hate', 68),
    ('loathing', 69),
    ('scorn', 70),
    ('spite', 71),
    ('vengefulness', 72),
    ('dislike', 73),
    ('resentment', 74),
    ('disgust', 75),
    ('revulsion', 76),
    ('contempt', 77),
    ('envy', 78),
    ('jealousy', 79),
    ('agony', 80),
    ('suffering', 81),
    ('hurt', 82),
    ('anguish', 83),
    ('depression', 84),
    ('despair', 85),
    ('hopelessness', 86),
    ('gloom', 87),
    ('glumness', 88),
    ('sadness', 89),
    ('unhappiness', 90),
    ('grief', 91),
    ('sorrow', 92),
    ('woe', 93),
    ('misery', 94),
    ('melancholy', 95),
    ('dismay', 96),
    ('disappointment', 97),
    ('displeasure', 98),
    ('guilt', 99),
    ('shame', 100),
    ('regret', 101),
    ('remorse', 102),
    ('alienation', 103),
    ('isolation', 104),
    ('neglect', 105),
    ('loneliness', 106),
    ('rejection', 107),
    ('homesickness', 108),
    ('defeat', 109),
    ('dejection', 110),
    ('insecurity', 111),
    ('embarrassment', 112),
    ('humiliation', 113),
    ('insult', 114),
    ('pity', 115),
    ('sympathy', 116),
    ('alarm', 117),
    ('shock', 118),
    ('fear', 119),
    ('fright', 120),
    ('horror', 121),
    ('terror', 122),
    ('panic', 123),
    ('hysteria', 124),
    ('mortification', 125),
    ('anxiety', 126),
    ('nervousness', 127),
    ('tenseness', 128),
    ('uneasiness', 129),
    ('apprehension', 130),
    ('worry', 131),
    ('distress', 132),
    ('dread', 133)
) AS stock (name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM crm.emotion_options existing
  WHERE lower(existing.name) = lower(stock.name)
)
ORDER BY stock.sort_order;

INSERT INTO crm.pet_categories (name, is_common, sort_order)
VALUES
    ('reptile', false, 1),
    ('bird', false, 2),
    ('cat', true, 3),
    ('dog', true, 4),
    ('fish', true, 5),
    ('hamster', false, 6),
    ('horse', false, 7),
    ('rabbit', false, 8),
    ('rat', false, 9),
    ('small_animal', false, 10),
    ('other', false, 11)
ON CONFLICT ((lower(name))) DO NOTHING;
