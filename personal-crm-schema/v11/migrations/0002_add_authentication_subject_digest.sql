-- Repository schema v1 -> v2.
-- Transaction expectation: the runner executes this complete file in one
-- PostgreSQL transaction. Recovery is transaction rollback or a forward fix;
-- no destructive down migration is required for this additive change.

ALTER TABLE crm.api_request_logs
  ADD COLUMN authentication_subject_digest text;

COMMENT ON COLUMN crm.api_request_logs.authentication_subject_digest IS
  'Versioned keyed digest of a normalized authentication subject for privacy-preserving throttling; never a raw email or challenge token.';

ALTER TABLE crm.api_request_logs
  ADD CONSTRAINT api_request_logs_auth_subject_digest_ck CHECK (
    authentication_subject_digest IS NULL OR
    authentication_subject_digest ~ '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$'
  );

CREATE INDEX api_request_logs_auth_subject_idx ON crm.api_request_logs (
  path, client_ip, authentication_subject_digest, occurred_at DESC
) WHERE authentication_subject_digest IS NOT NULL
  AND method = 'POST' AND status_code = 401;
