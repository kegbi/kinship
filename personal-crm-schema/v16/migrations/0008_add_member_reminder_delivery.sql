-- Transaction ownership belongs to the canonical migration runner.

ALTER TABLE crm.member_preferences
  ADD COLUMN reminder_delivery text NOT NULL DEFAULT 'in_app',
  ADD COLUMN digest_time time;

ALTER TABLE crm.member_preferences
  ADD CONSTRAINT member_preferences_reminder_delivery_ck
  CHECK (reminder_delivery IN ('in_app', 'email', 'both'));

COMMENT ON COLUMN crm.member_preferences.reminder_delivery IS
  'Channels for reminder occurrences generated from now on: in_app, email, or both; email requires a verified address.';
COMMENT ON COLUMN crm.member_preferences.digest_time IS
  'Local time of the daily email reminder digest in the member timezone, or UTC when none; null sends each email reminder when due.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.member_preferences
    WHERE reminder_delivery <> 'in_app' OR digest_time IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'crm'
      AND table_name = 'member_preferences'
      AND column_name = 'reminder_delivery'
      AND is_nullable = 'NO'
      AND column_default = '''in_app''::text'
  ) THEN
    RAISE EXCEPTION 'member reminder-delivery postcondition failed';
  END IF;
END
$$;
