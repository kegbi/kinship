-- Schema v13 -> v14: the database backstops workspace isolation (ADR 0008).
-- Runs as the schema owner (kinship_migrator, which bypasses row-level
-- security) inside the runner's one transaction, after the deployment's
-- bootstrap step has created the roles below. A link row that already
-- bridges two workspaces fails its composite key here, and the whole
-- upgrade rolls back; see personal_crm_schema_v14_changes.md for recovery.
SET search_path = crm, public;

-- 1. Denormalized workspace_id on link tables, backfilled from the parent.
ALTER TABLE activity_participants ADD COLUMN workspace_id uuid;
UPDATE activity_participants child SET workspace_id = parent.workspace_id FROM activities parent WHERE parent.id = child.activity_id;
ALTER TABLE activity_participants ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN activity_participants.workspace_id IS 'Workspace of the activities row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE gift_file_links ADD COLUMN workspace_id uuid;
UPDATE gift_file_links child SET workspace_id = parent.workspace_id FROM gifts parent WHERE parent.id = child.gift_id;
ALTER TABLE gift_file_links ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN gift_file_links.workspace_id IS 'Workspace of the gifts row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE messages ADD COLUMN workspace_id uuid;
UPDATE messages child SET workspace_id = parent.workspace_id FROM conversation_threads parent WHERE parent.id = child.conversation_id;
ALTER TABLE messages ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN messages.workspace_id IS 'Workspace of the conversation threads row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_addresses ADD COLUMN workspace_id uuid;
UPDATE person_addresses child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_addresses ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_addresses.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_avatars ADD COLUMN workspace_id uuid;
UPDATE person_avatars child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_avatars ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_avatars.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_contact_methods ADD COLUMN workspace_id uuid;
UPDATE person_contact_methods child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_contact_methods ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_contact_methods.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_dates ADD COLUMN workspace_id uuid;
UPDATE person_dates child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_dates ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_dates.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_file_links ADD COLUMN workspace_id uuid;
UPDATE person_file_links child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_file_links ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_file_links.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_first_meetings ADD COLUMN workspace_id uuid;
UPDATE person_first_meetings child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_first_meetings ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_first_meetings.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_occupations ADD COLUMN workspace_id uuid;
UPDATE person_occupations child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_occupations ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_occupations.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_tags ADD COLUMN workspace_id uuid;
UPDATE person_tags child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE person_tags ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_tags.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE reminder_occurrences ADD COLUMN workspace_id uuid;
UPDATE reminder_occurrences child SET workspace_id = parent.workspace_id FROM reminders parent WHERE parent.id = child.reminder_id;
ALTER TABLE reminder_occurrences ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN reminder_occurrences.workspace_id IS 'Workspace of the reminders row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE stay_in_touch_cadences ADD COLUMN workspace_id uuid;
UPDATE stay_in_touch_cadences child SET workspace_id = parent.workspace_id FROM people parent WHERE parent.id = child.person_id;
ALTER TABLE stay_in_touch_cadences ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN stay_in_touch_cadences.workspace_id IS 'Workspace of the people row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_address_labels ADD COLUMN workspace_id uuid;
UPDATE person_address_labels child SET workspace_id = parent.workspace_id FROM person_addresses parent WHERE parent.id = child.address_id;
ALTER TABLE person_address_labels ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_address_labels.workspace_id IS 'Workspace of the person addresses row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';
ALTER TABLE person_contact_method_labels ADD COLUMN workspace_id uuid;
UPDATE person_contact_method_labels child SET workspace_id = parent.workspace_id FROM person_contact_methods parent WHERE parent.id = child.contact_method_id;
ALTER TABLE person_contact_method_labels ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN workspace_id SET DEFAULT (nullif(current_setting('app.workspace_id', true), ''))::uuid;
COMMENT ON COLUMN person_contact_method_labels.workspace_id IS 'Workspace of the person contact methods row this belongs to, denormalized so every reference from this row is workspace-bound (ADR 0008); defaults to the transaction''s app.workspace_id.';

-- 2. Every referenced tenant parent is unique by (workspace_id, id).
ALTER TABLE activities ADD CONSTRAINT activities_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE activity_type_categories ADD CONSTRAINT activity_type_categories_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE activity_types ADD CONSTRAINT activity_types_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE contact_labels ADD CONSTRAINT contact_labels_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE contact_method_types ADD CONSTRAINT contact_method_types_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE conversation_threads ADD CONSTRAINT conversation_threads_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE dav_address_book_subscriptions ADD CONSTRAINT dav_address_book_subscriptions_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE dav_address_books ADD CONSTRAINT dav_address_books_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE gender_options ADD CONSTRAINT gender_options_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE gifts ADD CONSTRAINT gifts_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE journal_day_ratings ADD CONSTRAINT journal_day_ratings_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE journal_posts ADD CONSTRAINT journal_posts_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE life_event_categories ADD CONSTRAINT life_event_categories_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE life_event_types ADD CONSTRAINT life_event_types_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE life_events ADD CONSTRAINT life_events_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE locations ADD CONSTRAINT locations_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE organizations ADD CONSTRAINT organizations_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE person_addresses ADD CONSTRAINT person_addresses_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE person_contact_methods ADD CONSTRAINT person_contact_methods_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE person_dates ADD CONSTRAINT person_dates_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE relationship_type_groups ADD CONSTRAINT relationship_type_groups_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE relationship_types ADD CONSTRAINT relationship_types_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE reminders ADD CONSTRAINT reminders_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE stay_in_touch_cadences ADD CONSTRAINT stay_in_touch_cadences_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE tags ADD CONSTRAINT tags_workspace_id_id_key UNIQUE (workspace_id, id);
ALTER TABLE tasks ADD CONSTRAINT tasks_workspace_id_id_key UNIQUE (workspace_id, id);

-- 3. Every tenant-to-tenant reference carries its workspace.
ALTER TABLE activities DROP CONSTRAINT activities_activity_type_id_fkey,
  ADD CONSTRAINT activities_activity_type_id_fkey FOREIGN KEY (workspace_id, activity_type_id) REFERENCES activity_types (workspace_id, id) ON DELETE SET NULL (activity_type_id);
ALTER TABLE activities DROP CONSTRAINT activities_created_by_member_id_fkey,
  ADD CONSTRAINT activities_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE activity_participants DROP CONSTRAINT activity_participants_activity_id_fkey,
  ADD CONSTRAINT activity_participants_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE activity_participants DROP CONSTRAINT activity_participants_person_id_fkey,
  ADD CONSTRAINT activity_participants_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE activity_types DROP CONSTRAINT activity_types_category_id_fkey,
  ADD CONSTRAINT activity_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES activity_type_categories (workspace_id, id) ON DELETE SET NULL (category_id);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_actor_member_id_fkey,
  ADD CONSTRAINT audit_events_actor_member_id_fkey FOREIGN KEY (workspace_id, actor_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (actor_member_id);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_person_id_fkey,
  ADD CONSTRAINT audit_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id);
ALTER TABLE calls DROP CONSTRAINT calls_created_by_member_id_fkey,
  ADD CONSTRAINT calls_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE calls DROP CONSTRAINT calls_person_id_fkey,
  ADD CONSTRAINT calls_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE conversation_threads DROP CONSTRAINT conversation_threads_channel_type_id_fkey,
  ADD CONSTRAINT conversation_threads_channel_type_id_fkey FOREIGN KEY (workspace_id, channel_type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE SET NULL (channel_type_id);
ALTER TABLE conversation_threads DROP CONSTRAINT conversation_threads_contact_method_id_fkey,
  ADD CONSTRAINT conversation_threads_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE SET NULL (contact_method_id);
ALTER TABLE conversation_threads DROP CONSTRAINT conversation_threads_person_id_fkey,
  ADD CONSTRAINT conversation_threads_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE data_exports DROP CONSTRAINT data_exports_file_id_fkey,
  ADD CONSTRAINT data_exports_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id);
ALTER TABLE data_exports DROP CONSTRAINT data_exports_requested_by_member_id_fkey,
  ADD CONSTRAINT data_exports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id);
ALTER TABLE data_imports DROP CONSTRAINT data_imports_artifact_file_id_fkey,
  ADD CONSTRAINT data_imports_artifact_file_id_fkey FOREIGN KEY (workspace_id, artifact_file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (artifact_file_id);
ALTER TABLE data_imports DROP CONSTRAINT data_imports_requested_by_member_id_fkey,
  ADD CONSTRAINT data_imports_requested_by_member_id_fkey FOREIGN KEY (workspace_id, requested_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (requested_by_member_id);
ALTER TABLE dav_address_book_subscriptions DROP CONSTRAINT dav_address_book_subscriptions_local_address_book_id_fkey,
  ADD CONSTRAINT dav_address_book_subscriptions_local_address_book_id_fkey FOREIGN KEY (workspace_id, local_address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE SET NULL (local_address_book_id);
ALTER TABLE dav_address_book_subscriptions DROP CONSTRAINT dav_address_book_subscriptions_owner_member_id_fkey,
  ADD CONSTRAINT dav_address_book_subscriptions_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE dav_address_books DROP CONSTRAINT dav_address_books_owner_member_id_fkey,
  ADD CONSTRAINT dav_address_books_owner_member_id_fkey FOREIGN KEY (workspace_id, owner_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE dav_objects DROP CONSTRAINT dav_objects_address_book_id_fkey,
  ADD CONSTRAINT dav_objects_address_book_id_fkey FOREIGN KEY (workspace_id, address_book_id) REFERENCES dav_address_books (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE dav_objects DROP CONSTRAINT dav_objects_person_id_fkey,
  ADD CONSTRAINT dav_objects_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE dav_objects DROP CONSTRAINT dav_objects_subscription_id_fkey,
  ADD CONSTRAINT dav_objects_subscription_id_fkey FOREIGN KEY (workspace_id, subscription_id) REFERENCES dav_address_book_subscriptions (workspace_id, id) ON DELETE SET NULL (subscription_id);
ALTER TABLE dav_objects DROP CONSTRAINT dav_objects_task_id_fkey,
  ADD CONSTRAINT dav_objects_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE dav_sync_tokens DROP CONSTRAINT dav_sync_tokens_member_id_fkey,
  ADD CONSTRAINT dav_sync_tokens_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE debts DROP CONSTRAINT debts_person_id_fkey,
  ADD CONSTRAINT debts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE files DROP CONSTRAINT files_uploaded_by_member_id_fkey,
  ADD CONSTRAINT files_uploaded_by_member_id_fkey FOREIGN KEY (workspace_id, uploaded_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (uploaded_by_member_id);
ALTER TABLE gift_file_links DROP CONSTRAINT gift_file_links_file_id_fkey,
  ADD CONSTRAINT gift_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE gift_file_links DROP CONSTRAINT gift_file_links_gift_id_fkey,
  ADD CONSTRAINT gift_file_links_gift_id_fkey FOREIGN KEY (workspace_id, gift_id) REFERENCES gifts (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE gifts DROP CONSTRAINT gifts_person_id_fkey,
  ADD CONSTRAINT gifts_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE gifts DROP CONSTRAINT gifts_recipient_person_id_fkey,
  ADD CONSTRAINT gifts_recipient_person_id_fkey FOREIGN KEY (workspace_id, recipient_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (recipient_person_id);
ALTER TABLE journal_day_ratings DROP CONSTRAINT journal_day_ratings_created_by_member_id_fkey,
  ADD CONSTRAINT journal_day_ratings_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE journal_items DROP CONSTRAINT journal_items_activity_id_fkey,
  ADD CONSTRAINT journal_items_activity_id_fkey FOREIGN KEY (workspace_id, activity_id) REFERENCES activities (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE journal_items DROP CONSTRAINT journal_items_created_by_member_id_fkey,
  ADD CONSTRAINT journal_items_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE journal_items DROP CONSTRAINT journal_items_day_rating_id_fkey,
  ADD CONSTRAINT journal_items_day_rating_id_fkey FOREIGN KEY (workspace_id, day_rating_id) REFERENCES journal_day_ratings (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE journal_items DROP CONSTRAINT journal_items_journal_post_id_fkey,
  ADD CONSTRAINT journal_items_journal_post_id_fkey FOREIGN KEY (workspace_id, journal_post_id) REFERENCES journal_posts (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE journal_posts DROP CONSTRAINT journal_posts_created_by_member_id_fkey,
  ADD CONSTRAINT journal_posts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE life_event_types DROP CONSTRAINT life_event_types_category_id_fkey,
  ADD CONSTRAINT life_event_types_category_id_fkey FOREIGN KEY (workspace_id, category_id) REFERENCES life_event_categories (workspace_id, id) ON DELETE SET NULL (category_id);
ALTER TABLE life_events DROP CONSTRAINT life_events_life_event_type_id_fkey,
  ADD CONSTRAINT life_events_life_event_type_id_fkey FOREIGN KEY (workspace_id, life_event_type_id) REFERENCES life_event_types (workspace_id, id) ON DELETE SET NULL (life_event_type_id);
ALTER TABLE life_events DROP CONSTRAINT life_events_person_id_fkey,
  ADD CONSTRAINT life_events_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE messages DROP CONSTRAINT messages_author_member_id_fkey,
  ADD CONSTRAINT messages_author_member_id_fkey FOREIGN KEY (workspace_id, author_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (author_member_id);
ALTER TABLE messages DROP CONSTRAINT messages_conversation_id_fkey,
  ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (workspace_id, conversation_id) REFERENCES conversation_threads (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE notes DROP CONSTRAINT notes_created_by_member_id_fkey,
  ADD CONSTRAINT notes_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE notes DROP CONSTRAINT notes_person_id_fkey,
  ADD CONSTRAINT notes_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE people DROP CONSTRAINT people_created_by_member_id_fkey,
  ADD CONSTRAINT people_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE people DROP CONSTRAINT people_gender_option_id_fkey,
  ADD CONSTRAINT people_gender_option_id_fkey FOREIGN KEY (workspace_id, gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (gender_option_id);
ALTER TABLE person_address_labels DROP CONSTRAINT person_address_labels_address_id_fkey,
  ADD CONSTRAINT person_address_labels_address_id_fkey FOREIGN KEY (workspace_id, address_id) REFERENCES person_addresses (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_address_labels DROP CONSTRAINT person_address_labels_label_id_fkey,
  ADD CONSTRAINT person_address_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_addresses DROP CONSTRAINT person_addresses_location_id_fkey,
  ADD CONSTRAINT person_addresses_location_id_fkey FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL (location_id);
ALTER TABLE person_addresses DROP CONSTRAINT person_addresses_person_id_fkey,
  ADD CONSTRAINT person_addresses_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_avatars DROP CONSTRAINT person_avatars_file_id_fkey,
  ADD CONSTRAINT person_avatars_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE SET NULL (file_id);
ALTER TABLE person_avatars DROP CONSTRAINT person_avatars_person_id_fkey,
  ADD CONSTRAINT person_avatars_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_contact_method_labels DROP CONSTRAINT person_contact_method_labels_contact_method_id_fkey,
  ADD CONSTRAINT person_contact_method_labels_contact_method_id_fkey FOREIGN KEY (workspace_id, contact_method_id) REFERENCES person_contact_methods (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_contact_method_labels DROP CONSTRAINT person_contact_method_labels_label_id_fkey,
  ADD CONSTRAINT person_contact_method_labels_label_id_fkey FOREIGN KEY (workspace_id, label_id) REFERENCES contact_labels (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_contact_methods DROP CONSTRAINT person_contact_methods_person_id_fkey,
  ADD CONSTRAINT person_contact_methods_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_contact_methods DROP CONSTRAINT person_contact_methods_type_id_fkey,
  ADD CONSTRAINT person_contact_methods_type_id_fkey FOREIGN KEY (workspace_id, type_id) REFERENCES contact_method_types (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE person_dates DROP CONSTRAINT person_dates_person_id_fkey,
  ADD CONSTRAINT person_dates_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_duplicate_dismissals DROP CONSTRAINT person_duplicate_dismissals_dismissed_by_member_id_fkey,
  ADD CONSTRAINT person_duplicate_dismissals_dismissed_by_member_id_fkey FOREIGN KEY (workspace_id, dismissed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (dismissed_by_member_id);
ALTER TABLE person_file_links DROP CONSTRAINT person_file_links_file_id_fkey,
  ADD CONSTRAINT person_file_links_file_id_fkey FOREIGN KEY (workspace_id, file_id) REFERENCES files (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_file_links DROP CONSTRAINT person_file_links_person_id_fkey,
  ADD CONSTRAINT person_file_links_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_first_meetings DROP CONSTRAINT person_first_meetings_introduced_by_person_id_fkey,
  ADD CONSTRAINT person_first_meetings_introduced_by_person_id_fkey FOREIGN KEY (workspace_id, introduced_by_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (introduced_by_person_id);
ALTER TABLE person_first_meetings DROP CONSTRAINT person_first_meetings_location_fk,
  ADD CONSTRAINT person_first_meetings_location_fk FOREIGN KEY (workspace_id, location_id) REFERENCES locations (workspace_id, id) ON DELETE SET NULL (location_id);
ALTER TABLE person_first_meetings DROP CONSTRAINT person_first_meetings_person_id_fkey,
  ADD CONSTRAINT person_first_meetings_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_occupations DROP CONSTRAINT person_occupations_organization_id_fkey,
  ADD CONSTRAINT person_occupations_organization_id_fkey FOREIGN KEY (workspace_id, organization_id) REFERENCES organizations (workspace_id, id) ON DELETE SET NULL (organization_id);
ALTER TABLE person_occupations DROP CONSTRAINT person_occupations_person_id_fkey,
  ADD CONSTRAINT person_occupations_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_tags DROP CONSTRAINT person_tags_person_id_fkey,
  ADD CONSTRAINT person_tags_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE person_tags DROP CONSTRAINT person_tags_tag_id_fkey,
  ADD CONSTRAINT person_tags_tag_id_fkey FOREIGN KEY (workspace_id, tag_id) REFERENCES tags (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE recurring_debts DROP CONSTRAINT recurring_debts_created_by_member_id_fkey,
  ADD CONSTRAINT recurring_debts_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE relationship_types DROP CONSTRAINT relationship_types_group_id_fkey,
  ADD CONSTRAINT relationship_types_group_id_fkey FOREIGN KEY (workspace_id, group_id) REFERENCES relationship_type_groups (workspace_id, id) ON DELETE SET NULL (group_id);
ALTER TABLE relationships DROP CONSTRAINT relationships_from_person_id_fkey,
  ADD CONSTRAINT relationships_from_person_id_fkey FOREIGN KEY (workspace_id, from_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE relationships DROP CONSTRAINT relationships_relationship_type_id_fkey,
  ADD CONSTRAINT relationships_relationship_type_id_fkey FOREIGN KEY (workspace_id, relationship_type_id) REFERENCES relationship_types (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE relationships DROP CONSTRAINT relationships_to_person_id_fkey,
  ADD CONSTRAINT relationships_to_person_id_fkey FOREIGN KEY (workspace_id, to_person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminder_occurrences DROP CONSTRAINT reminder_occurrences_member_id_fkey,
  ADD CONSTRAINT reminder_occurrences_member_id_fkey FOREIGN KEY (workspace_id, member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminder_occurrences DROP CONSTRAINT reminder_occurrences_reminder_id_fkey,
  ADD CONSTRAINT reminder_occurrences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminders DROP CONSTRAINT reminders_created_by_member_id_fkey,
  ADD CONSTRAINT reminders_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE reminders DROP CONSTRAINT reminders_life_event_id_fkey,
  ADD CONSTRAINT reminders_life_event_id_fkey FOREIGN KEY (workspace_id, life_event_id) REFERENCES life_events (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminders DROP CONSTRAINT reminders_person_date_id_fkey,
  ADD CONSTRAINT reminders_person_date_id_fkey FOREIGN KEY (workspace_id, person_date_id) REFERENCES person_dates (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminders DROP CONSTRAINT reminders_person_id_fkey,
  ADD CONSTRAINT reminders_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE reminders DROP CONSTRAINT reminders_task_id_fkey,
  ADD CONSTRAINT reminders_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES tasks (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE stay_in_touch_cadence_requests DROP CONSTRAINT stay_in_touch_cadence_requests_cadence_id_fkey,
  ADD CONSTRAINT stay_in_touch_cadence_requests_cadence_id_fkey FOREIGN KEY (workspace_id, cadence_id) REFERENCES stay_in_touch_cadences (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE stay_in_touch_cadences DROP CONSTRAINT stay_in_touch_cadences_person_id_fkey,
  ADD CONSTRAINT stay_in_touch_cadences_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE CASCADE;
ALTER TABLE stay_in_touch_cadences DROP CONSTRAINT stay_in_touch_cadences_reminder_id_fkey,
  ADD CONSTRAINT stay_in_touch_cadences_reminder_id_fkey FOREIGN KEY (workspace_id, reminder_id) REFERENCES reminders (workspace_id, id) ON DELETE SET NULL (reminder_id);
ALTER TABLE tasks DROP CONSTRAINT tasks_completed_by_member_id_fkey,
  ADD CONSTRAINT tasks_completed_by_member_id_fkey FOREIGN KEY (workspace_id, completed_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (completed_by_member_id);
ALTER TABLE tasks DROP CONSTRAINT tasks_created_by_member_id_fkey,
  ADD CONSTRAINT tasks_created_by_member_id_fkey FOREIGN KEY (workspace_id, created_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (created_by_member_id);
ALTER TABLE tasks DROP CONSTRAINT tasks_person_id_fkey,
  ADD CONSTRAINT tasks_person_id_fkey FOREIGN KEY (workspace_id, person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (person_id);
ALTER TABLE workspace_invitations DROP CONSTRAINT workspace_invitations_invited_by_member_id_fkey,
  ADD CONSTRAINT workspace_invitations_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id);
ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_invited_by_member_id_fkey,
  ADD CONSTRAINT workspace_members_invited_by_member_id_fkey FOREIGN KEY (workspace_id, invited_by_member_id) REFERENCES workspace_members (workspace_id, id) ON DELETE SET NULL (invited_by_member_id);
ALTER TABLE workspace_members DROP CONSTRAINT workspace_members_self_person_fk,
  ADD CONSTRAINT workspace_members_self_person_fk FOREIGN KEY (workspace_id, self_person_id) REFERENCES people (workspace_id, id) ON DELETE SET NULL (self_person_id);
ALTER TABLE workspace_settings DROP CONSTRAINT workspace_settings_default_gender_option_id_fkey,
  ADD CONSTRAINT workspace_settings_default_gender_option_id_fkey FOREIGN KEY (workspace_id, default_gender_option_id) REFERENCES gender_options (workspace_id, id) ON DELETE SET NULL (default_gender_option_id);

-- 4. The directory order and the duplicate check compare stored keys, which
--    row-level security lets an index condition use (lower() is not
--    leakproof, so an expression index on it cannot be sought under RLS).
ALTER TABLE people
  ADD COLUMN sort_given_name text GENERATED ALWAYS AS (lower(COALESCE(NULLIF(btrim(given_name), ''), NULLIF(btrim(nickname), ''), NULLIF(btrim(family_name), ''), ''))) STORED,
  ADD COLUMN sort_family_name text GENERATED ALWAYS AS (lower(COALESCE(family_name, ''))) STORED,
  ADD COLUMN duplicate_given_name text GENERATED ALWAYS AS (lower(btrim(given_name))) STORED,
  ADD COLUMN duplicate_family_name text GENERATED ALWAYS AS (lower(btrim(COALESCE(family_name, '')))) STORED,
  ADD COLUMN duplicate_nickname text GENERATED ALWAYS AS (lower(btrim(COALESCE(nickname, '')))) STORED;
COMMENT ON COLUMN people.sort_given_name IS 'Directory given-name sort key: the first non-blank of given name, nickname, and family name, lowercased; a stored column so the directory seeks its index under row-level security (v14).';
COMMENT ON COLUMN people.sort_family_name IS 'Directory given-name sort tie-breaker: the family name, lowercased (v14).';
COMMENT ON COLUMN people.duplicate_given_name IS 'Duplicate-name check key: the trimmed, lowercased given name (v14).';
COMMENT ON COLUMN people.duplicate_family_name IS 'Duplicate-name check key: the trimmed, lowercased family name, empty when there is none (v14).';
COMMENT ON COLUMN people.duplicate_nickname IS 'Duplicate-name check key: the trimmed, lowercased nickname, empty when there is none (v14).';
DROP INDEX people_active_given_name_idx;
DROP INDEX people_active_duplicate_name_idx;
CREATE INDEX people_active_given_name_idx ON people (workspace_id, sort_given_name, sort_family_name, id) WHERE archived_at IS NULL AND deleted_at IS NULL;
CREATE INDEX people_active_duplicate_name_idx ON people (workspace_id, duplicate_given_name, duplicate_family_name, duplicate_nickname) WHERE archived_at IS NULL AND deleted_at IS NULL;

-- 5. The member cascade of a workspace delete finds request logs by index.
CREATE INDEX api_request_logs_member_idx ON api_request_logs (member_id) WHERE member_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Workspace isolation (v14, ADR 0008)
-- -----------------------------------------------------------------------------
-- The database backstops the application's workspace predicates in three
-- layers: least-privilege roles, workspace-bound composite keys (above), and
-- forced row-level security on every tenant table (below). The deployment's
-- bootstrap step creates the roles this section names before the migrator runs
-- (docs/architecture/configuration-and-secrets.md); the schema never creates a
-- role or holds a password.
DO $roles$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.name, ', ' ORDER BY required.name) INTO missing
  FROM unnest(ARRAY[
    'kinship_app', 'kinship_worker', 'kinship_session_resolver',
    'kinship_token_resolver', 'kinship_invitation_resolver',
    'kinship_registration', 'kinship_account_lifecycle',
    'kinship_workspace_lifecycle', 'kinship_request_budget',
    'kinship_planning_maintenance'
  ]) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = required.name);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Schema v14 requires the bootstrap roles: %', missing;
  END IF;
END
$roles$;

-- The schema is reachable to the service roles and to the owners of the
-- narrow cross-workspace functions; current_schema() keeps the statement
-- correct when the canonical DDL is applied into a scratch schema.
DO $usage$
BEGIN
  EXECUTE format(
    'GRANT USAGE ON SCHEMA %I TO kinship_app, kinship_worker, kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance',
    current_schema()
  );
END
$usage$;

-- Every tenant table admits only the rows of the workspace the transaction
-- set with SET LOCAL app.workspace_id (or set_config(..., true)). An unset or
-- emptied setting matches no row, and nullif keeps the cast from failing on a
-- pooled connection whose previous transaction set it.
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activities
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_participants
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_type_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_type_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_type_categories
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON activity_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE api_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON api_request_logs
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON api_tokens
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON audit_events
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON billing_customers
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON calls
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE contact_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON contact_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE contact_method_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_method_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON contact_method_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_threads FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON conversation_threads
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_exports
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON data_imports
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_address_book_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_address_book_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_address_book_subscriptions
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_address_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_address_books FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_address_books
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_objects
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE dav_sync_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE dav_sync_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON dav_sync_tokens
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE debt_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE debt_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON debt_settlements
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE debts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON debts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON files
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gender_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE gender_options FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gender_options
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gift_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_file_links FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gift_file_links
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE gifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gifts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON gifts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_day_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_day_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_day_ratings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_items FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_items
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE journal_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_posts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON journal_posts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON legal_acceptances
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_event_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_event_categories
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_event_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_event_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_event_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE life_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_events FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON life_events
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON locations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON messages
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON notes
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON organizations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE people FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON people
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_address_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_address_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_address_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_addresses
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_avatars ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_avatars FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_avatars
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_contact_method_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact_method_labels FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_contact_method_labels
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contact_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_contact_methods
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_dates FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_dates
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_duplicate_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_duplicate_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_duplicate_dismissals
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_file_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_file_links FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_file_links
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_first_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_first_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_first_meetings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_occupations ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_occupations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_occupations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE person_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON person_tags
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE recurring_debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_debts FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON recurring_debts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationship_type_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_type_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationship_type_groups
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationship_types
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON relationships
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminder_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminder_occurrences
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminder_rules
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON reminders
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE statistics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE statistics_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON statistics_snapshots
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE stay_in_touch_cadence_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_in_touch_cadence_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON stay_in_touch_cadence_requests
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE stay_in_touch_cadences ENABLE ROW LEVEL SECURITY;
ALTER TABLE stay_in_touch_cadences FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON stay_in_touch_cadences
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tags
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON tasks
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_invitations
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_lifecycle_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_lifecycle_records FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_lifecycle_records
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_members
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_profile_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_profile_modules FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_profile_modules
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
ALTER TABLE workspace_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON workspace_settings
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- Narrow cross-workspace paths (ADR 0008, amended 2026-11-08)
-- -----------------------------------------------------------------------------
-- A few paths legitimately span workspaces or run before one is known. Each
-- has exactly one means: a SECURITY DEFINER function owned by a non-login role
-- that is not a superuser and does not bypass row-level security, whose own
-- policy admits only what that function reads; or, for the worker alone,
-- kinship_worker policies on just the tables its scans read. The functions
-- schema-qualify every name and pin search_path. A function named enter_*
-- scopes the calling transaction to the workspace a secret names, and refuses
-- to move a transaction that is already scoped to another workspace.

-- Session resolution and the workspace switcher: a verified user's active
-- memberships, before any workspace is chosen.
GRANT SELECT ON users, workspaces, workspace_members TO kinship_session_resolver;
CREATE POLICY session_resolution ON workspace_members FOR SELECT
  TO kinship_session_resolver USING (true);

CREATE FUNCTION session_workspace_contexts(p_user_id uuid)
RETURNS TABLE (member_id uuid, role text, user_id uuid, workspace_id uuid, workspace_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.role, u.id, w.id, w.name
  FROM crm.users u
  JOIN crm.workspace_members wm ON wm.user_id = u.id
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE u.id = p_user_id AND u.status = 'active' AND u.deleted_at IS NULL
    AND u.email_verified_at IS NOT NULL
    AND wm.status = 'active' AND wm.left_at IS NULL
    AND w.status = 'active' AND w.deleted_at IS NULL
  ORDER BY wm.joined_at ASC NULLS LAST, wm.id ASC;
END
$function$;
COMMENT ON FUNCTION session_workspace_contexts(uuid) IS 'Session resolution and the workspace switcher (ADR 0008): the active memberships a verified, active user may enter, first joined first.';

CREATE FUNCTION session_audit_context(p_user_id uuid)
RETURNS TABLE (member_id uuid, role text, user_id uuid, workspace_id uuid, workspace_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.role, u.id, w.id, w.name
  FROM crm.users u
  JOIN crm.workspace_members wm ON wm.user_id = u.id
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE u.id = p_user_id
  ORDER BY (wm.status = 'active' AND wm.left_at IS NULL) DESC,
    wm.joined_at ASC NULLS LAST, wm.id ASC
  LIMIT 1;
END
$function$;
COMMENT ON FUNCTION session_audit_context(uuid) IS 'Session resolution (ADR 0008): the one membership an account-level security event is recorded under, active memberships first.';

-- Bearer-token login and the calendar feed: the workspace a token row names,
-- found by the token id the presented secret carries.
GRANT SELECT (id, workspace_id) ON api_tokens TO kinship_token_resolver;
CREATE POLICY token_resolution ON api_tokens FOR SELECT
  TO kinship_token_resolver USING (true);

CREATE FUNCTION enter_api_token_workspace(p_token_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  found_workspace uuid;
  scoped text := nullif(current_setting('app.workspace_id', true), '');
BEGIN
  SELECT t.workspace_id INTO found_workspace
  FROM crm.api_tokens t WHERE t.id = p_token_id;
  IF found_workspace IS NULL THEN RETURN NULL; END IF;
  IF scoped IS NOT NULL AND scoped <> found_workspace::text THEN
    RAISE EXCEPTION 'transaction is already scoped to another workspace';
  END IF;
  PERFORM set_config('app.workspace_id', found_workspace::text, true);
  RETURN found_workspace;
END
$function$;
COMMENT ON FUNCTION enter_api_token_workspace(uuid) IS 'Bearer-token login and the calendar feed (ADR 0008): scopes the calling transaction to the workspace of the token row with this id and returns it, or null when there is none. The caller still verifies the secret.';

-- Invitation acceptance (registration): the workspace an invitation's token
-- hash names, before the invitee is a member of it.
GRANT SELECT (token_hash, workspace_id) ON workspace_invitations TO kinship_invitation_resolver;
CREATE POLICY invitation_resolution ON workspace_invitations FOR SELECT
  TO kinship_invitation_resolver USING (true);

CREATE FUNCTION enter_invitation_workspace(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  found_workspace uuid;
  scoped text := nullif(current_setting('app.workspace_id', true), '');
BEGIN
  SELECT i.workspace_id INTO found_workspace
  FROM crm.workspace_invitations i WHERE i.token_hash = p_token_hash;
  IF found_workspace IS NULL THEN RETURN NULL; END IF;
  IF scoped IS NOT NULL AND scoped <> found_workspace::text THEN
    RAISE EXCEPTION 'transaction is already scoped to another workspace';
  END IF;
  PERFORM set_config('app.workspace_id', found_workspace::text, true);
  RETURN found_workspace;
END
$function$;
COMMENT ON FUNCTION enter_invitation_workspace(text) IS 'Invitation acceptance (ADR 0008, registration): scopes the calling transaction to the workspace of the invitation with this token hash and returns it, or null when there is none.';

-- Registration: the workspaces a never-verified registration created that
-- nobody else belongs to, which discarding it removes.
GRANT SELECT ON workspaces, workspace_members TO kinship_registration;
CREATE POLICY registration_cleanup ON workspace_members FOR SELECT
  TO kinship_registration USING (true);

CREATE FUNCTION unshared_registration_workspaces(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT w.id FROM crm.workspaces w
  WHERE w.created_by_user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM crm.workspace_members m
      WHERE m.workspace_id = w.id AND m.user_id <> p_user_id
    )
  ORDER BY w.id;
END
$function$;
COMMENT ON FUNCTION unshared_registration_workspaces(uuid) IS 'Registration (ADR 0008): the workspaces this user created that no other account belongs to.';

-- Personal account lifecycle: leaving every workspace or deleting the account
-- reads the account's memberships, and each workspace's active owners.
GRANT SELECT ON workspaces, workspace_members TO kinship_account_lifecycle;
CREATE POLICY account_lifecycle ON workspace_members FOR SELECT
  TO kinship_account_lifecycle USING (true);

CREATE FUNCTION account_lifecycle_memberships(p_user_id uuid)
RETURNS TABLE (member_id uuid, workspace_id uuid, workspace_name text, role text, status text, active_owner_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT wm.id, wm.workspace_id, w.name, wm.role, wm.status,
    (SELECT count(*)::integer FROM crm.workspace_members owners
      WHERE owners.workspace_id = wm.workspace_id
        AND owners.role = 'owner' AND owners.status = 'active'
        AND owners.left_at IS NULL)
  FROM crm.workspace_members wm
  JOIN crm.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = p_user_id
    AND wm.status <> 'left' AND wm.left_at IS NULL
    AND w.status = 'active' AND w.deleted_at IS NULL
  ORDER BY lower(w.name), wm.workspace_id;
END
$function$;
COMMENT ON FUNCTION account_lifecycle_memberships(uuid) IS 'Personal account lifecycle (ADR 0008): the memberships of this account that have not ended, in active workspaces, with each workspace''s active owner count.';

-- Workspace lifecycle: which of a workspace's members have no other active
-- workspace, so that deleting or resetting it signs out only them (SECT-05).
GRANT SELECT ON workspaces, workspace_members TO kinship_workspace_lifecycle;
CREATE POLICY workspace_lifecycle ON workspace_members FOR SELECT
  TO kinship_workspace_lifecycle USING (true);

CREATE FUNCTION workspace_sole_member_user_ids(p_workspace_id uuid)
RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT member.user_id FROM crm.workspace_members member
  WHERE member.workspace_id = p_workspace_id
    AND member.status = 'active' AND member.left_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM crm.workspace_members other
      JOIN crm.workspaces elsewhere ON elsewhere.id = other.workspace_id
      WHERE other.user_id = member.user_id
        AND other.workspace_id <> member.workspace_id
        AND other.status = 'active' AND other.left_at IS NULL
        AND elsewhere.status = 'active' AND elsewhere.deleted_at IS NULL
    );
END
$function$;
COMMENT ON FUNCTION workspace_sole_member_user_ids(uuid) IS 'Workspace lifecycle (ADR 0008): the users whose only active membership is this workspace.';

-- Durable throttles and mail budgets: request-log rows keyed by a subject
-- digest, most written before any workspace exists, and the per-recipient
-- mail cap that deliberately counts across workspaces. The budget role reads
-- and writes only rows that carry a digest.
GRANT SELECT, INSERT, UPDATE ON api_request_logs TO kinship_request_budget;
CREATE POLICY request_budget_read ON api_request_logs FOR SELECT
  TO kinship_request_budget USING (authentication_subject_digest IS NOT NULL);
CREATE POLICY request_budget_record ON api_request_logs FOR INSERT
  TO kinship_request_budget
  WITH CHECK (method = 'POST' AND authentication_subject_digest IS NOT NULL);
CREATE POLICY request_budget_settle ON api_request_logs FOR UPDATE
  TO kinship_request_budget USING (authentication_subject_digest IS NOT NULL)
  WITH CHECK (authentication_subject_digest IS NOT NULL);

CREATE FUNCTION request_budget_attempts(p_path text, p_digests text[], p_since timestamptz)
RETURNS TABLE (client_ip inet, status_code integer, occurred_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN QUERY
  SELECT log.client_ip, log.status_code, log.occurred_at
  FROM crm.api_request_logs log
  WHERE log.method = 'POST' AND log.path = p_path
    AND log.authentication_subject_digest = ANY (p_digests)
    AND log.occurred_at > p_since;
END
$function$;
COMMENT ON FUNCTION request_budget_attempts(text, text[], timestamptz) IS 'Durable throttles and mail budgets (ADR 0008): the budget rows of one path for these subject digests since a time, in any workspace or none.';

CREATE FUNCTION request_budget_workspace_count(p_path text, p_workspace_id uuid, p_since timestamptz)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  RETURN (
    SELECT count(*)::integer FROM crm.api_request_logs log
    WHERE log.method = 'POST' AND log.path = p_path
      AND log.workspace_id = p_workspace_id AND log.occurred_at > p_since
      AND log.authentication_subject_digest IS NOT NULL
  );
END
$function$;
COMMENT ON FUNCTION request_budget_workspace_count(text, uuid, timestamptz) IS 'Mail budgets (ADR 0008): how many budget rows of one path a sending workspace recorded since a time.';

CREATE FUNCTION record_request_budget(
  p_path text, p_digest text, p_client_ip inet, p_status_code integer,
  p_occurred_at timestamptz, p_workspace_id uuid, p_user_id uuid, p_member_id uuid
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  recorded uuid;
BEGIN
  INSERT INTO crm.api_request_logs (
    workspace_id, user_id, member_id, method, path, client_ip,
    authentication_subject_digest, status_code, occurred_at, created_at
  ) VALUES (
    p_workspace_id, p_user_id, p_member_id, 'POST', p_path, p_client_ip,
    p_digest, p_status_code, p_occurred_at, p_occurred_at
  )
  RETURNING id INTO recorded;
  RETURN recorded;
END
$function$;
COMMENT ON FUNCTION record_request_budget(text, text, inet, integer, timestamptz, uuid, uuid, uuid) IS 'Durable throttles and mail budgets (ADR 0008): records one budget row and returns its id.';

CREATE FUNCTION finalize_request_budget(p_id uuid, p_status_code integer, p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  finalized uuid;
BEGIN
  UPDATE crm.api_request_logs SET status_code = p_status_code, user_id = p_user_id
  WHERE id = p_id AND status_code IS NULL
  RETURNING id INTO finalized;
  RETURN finalized;
END
$function$;
COMMENT ON FUNCTION finalize_request_budget(uuid, integer, uuid) IS 'Durable throttles (ADR 0008): settles one outstanding reservation with its outcome, or answers null when it was not outstanding.';

-- Planner statistics after a bulk load (REL-116): no service role may ANALYZE
-- a table it does not own, and neither receives MAINTAIN. This function, owned
-- by a role that holds MAINTAIN on exactly these tables, analyzes them.
GRANT MAINTAIN ON people, reminders, reminder_occurrences TO kinship_planning_maintenance;

CREATE FUNCTION analyze_planning_tables()
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  ANALYZE crm.people, crm.reminders, crm.reminder_occurrences;
END
$function$;
COMMENT ON FUNCTION analyze_planning_tables() IS 'Refreshes planner statistics for the bulk-loaded planning tables (REL-116) without granting MAINTAIN to a service role.';

-- The worker's due-work scans: the worker role alone reads, across every
-- workspace, just the tables its scans read, and settles the rows it claims,
-- withdraws, or purges. Everything it inserts still names its workspace.
CREATE POLICY worker_scan ON people FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON reminders FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON reminder_rules FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_members FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_settings FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON recurring_debts FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_scan ON workspace_lifecycle_records FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_settle ON workspace_lifecycle_records FOR UPDATE TO kinship_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_scan ON reminder_occurrences FOR SELECT TO kinship_worker USING (true);
CREATE POLICY worker_settle ON reminder_occurrences FOR UPDATE TO kinship_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_withdraw ON reminder_occurrences FOR DELETE TO kinship_worker USING (true);
-- The retention purge (AUD-A2) reaches only the rows it deletes: the sign-in
-- and MFA throttle rows and the mail-budget reservations, all POST rows, with
-- or without the subject digest older rows lack; no other request log.
CREATE POLICY worker_purge_scan ON api_request_logs FOR SELECT TO kinship_worker
  USING (method = 'POST' AND (path IN ('/api/v1/sessions', '/api/v1/mfa-challenges') OR path LIKE 'mail-budget/%'));
CREATE POLICY worker_purge ON api_request_logs FOR DELETE TO kinship_worker
  USING (method = 'POST' AND (path IN ('/api/v1/sessions', '/api/v1/mfa-challenges') OR path LIKE 'mail-budget/%'));
-- It keeps a stale registration whose address a pending invitation still
-- names, in any workspace.
CREATE POLICY worker_scan ON workspace_invitations FOR SELECT TO kinship_worker USING (true);

-- The worker's jobs: reminder delivery and replenishment, recurring debts,
-- the workspace cleanup reconciler, and the retention purge (AUD-A2).
GRANT SELECT ON currencies, users, workspaces, workspace_members,
  member_preferences, workspace_settings, people, person_dates, reminder_rules,
  recurring_debts, workspace_lifecycle_records, user_sessions
  TO kinship_worker;
GRANT SELECT, UPDATE ON reminders TO kinship_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON reminder_occurrences TO kinship_worker;
GRANT UPDATE ON recurring_debts, workspace_lifecycle_records TO kinship_worker;
-- Delivery holds a workspace's settings and its members' preferences FOR SHARE
-- while it schedules under them; a row lock needs an UPDATE privilege, and one
-- column is enough.
GRANT UPDATE (updated_at) ON member_preferences, workspace_settings TO kinship_worker;
GRANT SELECT, INSERT ON debts TO kinship_worker;
GRANT SELECT, INSERT ON audit_events TO kinship_worker;
GRANT SELECT, DELETE ON api_request_logs, user_sessions, password_reset_requests,
  email_verification_tokens TO kinship_worker;
GRANT DELETE ON users TO kinship_worker;
-- The stale-registration purge locks the users it considers FOR UPDATE, which
-- needs an UPDATE privilege; one column is enough, and it writes none.
GRANT UPDATE (updated_at) ON users TO kinship_worker;
-- A stale registration made before AUD-A2 may still hold the workspace it was
-- provisioned with; the purge deletes it, and its rows cascade.
GRANT SELECT ON workspace_invitations TO kinship_worker;
GRANT DELETE ON workspaces TO kinship_worker;

-- Privileges. The API's role has DML on every table and no DDL. The worker's
-- role has only what its jobs need. Each function owner has only what its
-- function reads, and the functions are executable only by the service roles.
-- Ownership moves to each path's own role, which holds CREATE on the schema
-- only while its owner changes.
DO $privileges$
DECLARE
  routine record;
BEGIN
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO kinship_app', current_schema());
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p WHERE p.pronamespace = current_schema()::regnamespace
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', routine.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO kinship_app', routine.signature);
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.analyze_planning_tables() TO kinship_worker', current_schema());
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.unshared_registration_workspaces(uuid) TO kinship_worker', current_schema());
  EXECUTE format('GRANT CREATE ON SCHEMA %I TO kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance', current_schema());
  ALTER FUNCTION session_workspace_contexts(uuid) OWNER TO kinship_session_resolver;
  ALTER FUNCTION session_audit_context(uuid) OWNER TO kinship_session_resolver;
  ALTER FUNCTION enter_api_token_workspace(uuid) OWNER TO kinship_token_resolver;
  ALTER FUNCTION enter_invitation_workspace(text) OWNER TO kinship_invitation_resolver;
  ALTER FUNCTION unshared_registration_workspaces(uuid) OWNER TO kinship_registration;
  ALTER FUNCTION account_lifecycle_memberships(uuid) OWNER TO kinship_account_lifecycle;
  ALTER FUNCTION workspace_sole_member_user_ids(uuid) OWNER TO kinship_workspace_lifecycle;
  ALTER FUNCTION request_budget_attempts(text, text[], timestamptz) OWNER TO kinship_request_budget;
  ALTER FUNCTION request_budget_workspace_count(text, uuid, timestamptz) OWNER TO kinship_request_budget;
  ALTER FUNCTION record_request_budget(text, text, inet, integer, timestamptz, uuid, uuid, uuid) OWNER TO kinship_request_budget;
  ALTER FUNCTION finalize_request_budget(uuid, integer, uuid) OWNER TO kinship_request_budget;
  ALTER FUNCTION analyze_planning_tables() OWNER TO kinship_planning_maintenance;
  EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM kinship_session_resolver, kinship_token_resolver, kinship_invitation_resolver, kinship_registration, kinship_account_lifecycle, kinship_workspace_lifecycle, kinship_request_budget, kinship_planning_maintenance', current_schema());
END
$privileges$;
