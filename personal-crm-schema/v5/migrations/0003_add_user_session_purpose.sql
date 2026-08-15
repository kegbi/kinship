-- Repository schema v2 to v3: exact user-session authority purpose.
-- Transaction is owned by the raw PostgreSQL migration runner.

ALTER TABLE crm.user_sessions ADD COLUMN purpose text;

-- V2 did not persist an exact purpose. Fail closed rather than infer purpose
-- from duration or other incidental data; all pre-v3 authority is revoked.
UPDATE crm.user_sessions
SET purpose = 'legacy', revoked_at = COALESCE(revoked_at, now());

ALTER TABLE crm.user_sessions ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE crm.user_sessions
  ADD CONSTRAINT user_sessions_purpose_check
  CHECK (purpose IN ('authenticated', 'verified-entry', 'legacy'));
ALTER TABLE crm.user_sessions
  ADD CONSTRAINT user_sessions_legacy_revoked_check
  CHECK (purpose <> 'legacy' OR revoked_at IS NOT NULL);

COMMENT ON COLUMN crm.user_sessions.purpose IS
  'Exact authority purpose: authenticated session, verified identity entry, or revoked legacy authority.';
