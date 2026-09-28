-- Transaction ownership belongs to the canonical migration runner.

ALTER TABLE crm.reminder_occurrences
  ALTER COLUMN channel SET DEFAULT 'in_app',
  DROP CONSTRAINT reminder_occurrences_status_check,
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_attempt_at timestamptz,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN provider_idempotency_key text,
  ADD COLUMN provider_receipt text,
  ADD COLUMN provider_result_state text NOT NULL DEFAULT 'unattempted',
  ADD COLUMN provider_effect_at timestamptz,
  ADD COLUMN visible_at timestamptz;

ALTER TABLE crm.stay_in_touch_cadences
  ADD COLUMN last_request_id uuid,
  ADD COLUMN last_request_fingerprint text;

UPDATE crm.reminder_occurrences
SET sent_at = CASE WHEN status = 'sent' THEN coalesce(sent_at, updated_at, created_at, now()) ELSE sent_at END,
    status = CASE WHEN channel <> 'in_app' AND status = 'pending' THEN 'manual_attention' ELSE status END,
    provider_idempotency_key = 'reminder-occurrence:' || id::text,
    provider_result_state = CASE
      WHEN status = 'sent' THEN 'confirmed'
      WHEN channel <> 'in_app' AND status IN ('pending', 'failed') THEN 'rejected'
      ELSE 'unattempted'
    END,
    provider_receipt = CASE WHEN status = 'sent' THEN 'legacy:' || id::text ELSE NULL END,
    provider_effect_at = CASE WHEN status = 'sent' THEN coalesce(sent_at, updated_at, created_at, now()) ELSE NULL END,
    visible_at = CASE WHEN status = 'sent' THEN coalesce(sent_at, updated_at, created_at, now()) ELSE NULL END,
    error = CASE WHEN channel <> 'in_app' AND status = 'pending' THEN 'unsupported-legacy-channel' ELSE error END;

ALTER TABLE crm.reminder_occurrences
  ALTER COLUMN provider_idempotency_key SET NOT NULL,
  ALTER COLUMN provider_idempotency_key SET DEFAULT gen_random_uuid()::text,
  ADD CONSTRAINT reminder_occurrences_status_check CHECK (status IN ('pending', 'claimed', 'retry', 'sent', 'skipped', 'failed', 'cancelled', 'manual_attention')),
  ADD CONSTRAINT reminder_occurrences_attempt_count_check CHECK (attempt_count >= 0),
  ADD CONSTRAINT reminder_occurrences_provider_result_state_check CHECK (provider_result_state IN ('unattempted', 'ambiguous', 'confirmed', 'rejected')),
  ADD CONSTRAINT reminder_occurrences_claim_shape_check CHECK ((claim_token IS NULL AND claim_owner IS NULL AND lease_expires_at IS NULL) OR (claim_token IS NOT NULL AND claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  ADD CONSTRAINT reminder_occurrences_claim_status_check CHECK (status = 'claimed' OR (claim_token IS NULL AND claim_owner IS NULL AND lease_expires_at IS NULL)),
  ADD CONSTRAINT reminder_occurrences_claim_required_check CHECK (status <> 'claimed' OR (claim_token IS NOT NULL AND claim_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
  ADD CONSTRAINT reminder_occurrences_retry_time_check CHECK (status <> 'retry' OR next_attempt_at IS NOT NULL),
  ADD CONSTRAINT reminder_occurrences_confirmed_effect_check CHECK (provider_result_state <> 'confirmed' OR (provider_receipt IS NOT NULL AND provider_effect_at IS NOT NULL AND visible_at IS NOT NULL)),
  ADD CONSTRAINT reminder_occurrences_sent_result_check CHECK (status <> 'sent' OR (sent_at IS NOT NULL AND provider_result_state = 'confirmed')),
  ADD CONSTRAINT reminder_occurrences_manual_attention_check CHECK (status <> 'manual_attention' OR provider_result_state IN ('ambiguous', 'rejected'));

ALTER TABLE crm.stay_in_touch_cadences
  ADD CONSTRAINT stay_in_touch_cadences_request_shape_check CHECK ((last_request_id IS NULL) = (last_request_fingerprint IS NULL)),
  ADD CONSTRAINT stay_in_touch_cadences_request_fingerprint_check CHECK (last_request_fingerprint IS NULL OR last_request_fingerprint ~ '^[0-9a-f]{64}$');

DROP INDEX crm.reminder_occurrences_due_idx;
CREATE INDEX reminder_occurrences_due_idx ON crm.reminder_occurrences (status, COALESCE(next_attempt_at, deliver_at)) WHERE status IN ('pending', 'retry');
CREATE INDEX reminder_occurrences_lease_idx ON crm.reminder_occurrences (lease_expires_at) WHERE status = 'claimed';
DROP INDEX crm.reminder_occurrences_unique_delivery;
CREATE UNIQUE INDEX reminder_occurrences_unique_delivery ON crm.reminder_occurrences (reminder_id, member_id, occurs_on, channel, COALESCE(lead_time_days, -1));
CREATE UNIQUE INDEX reminder_occurrences_provider_key_idx ON crm.reminder_occurrences (provider_idempotency_key);
CREATE TABLE crm.stay_in_touch_cadence_requests (
  workspace_id uuid NOT NULL REFERENCES crm.workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  cadence_id uuid NOT NULL REFERENCES crm.stay_in_touch_cadences(id) ON DELETE CASCADE,
  request_fingerprint text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, request_id)
);

INSERT INTO crm.stay_in_touch_cadence_requests (
  workspace_id, request_id, cadence_id, request_fingerprint, accepted_at
)
SELECT person.workspace_id, cadence.last_request_id, cadence.id,
  cadence.last_request_fingerprint, cadence.updated_at
FROM crm.stay_in_touch_cadences cadence
JOIN crm.people person ON person.id = cadence.person_id
WHERE cadence.last_request_id IS NOT NULL
ON CONFLICT (workspace_id, request_id) DO NOTHING;

CREATE INDEX stay_in_touch_cadence_requests_cadence_idx
  ON crm.stay_in_touch_cadence_requests (cadence_id);

COMMENT ON COLUMN crm.reminder_occurrences.claim_token IS 'Opaque ownership token for the current finite worker lease.';
COMMENT ON COLUMN crm.reminder_occurrences.channel IS 'Delivery channel; the first production adapter supports in_app only.';
COMMENT ON COLUMN crm.reminder_occurrences.status IS 'Durable lifecycle: pending, claimed, retry, sent, skipped, failed, cancelled, or manual_attention.';
COMMENT ON COLUMN crm.reminder_occurrences.claim_owner IS 'Non-secret worker instance name that owns the current lease.';
COMMENT ON COLUMN crm.reminder_occurrences.lease_expires_at IS 'When another worker may recover an abandoned claim.';
COMMENT ON COLUMN crm.reminder_occurrences.attempt_count IS 'Persistent number of started delivery attempts.';
COMMENT ON COLUMN crm.reminder_occurrences.last_attempt_at IS 'When the latest delivery attempt started.';
COMMENT ON COLUMN crm.reminder_occurrences.next_attempt_at IS 'Earliest instant at which retry work may be claimed.';
COMMENT ON COLUMN crm.reminder_occurrences.provider_idempotency_key IS 'Stable provider key retained across claims and process restarts.';
COMMENT ON COLUMN crm.reminder_occurrences.provider_receipt IS 'Stable provider receipt after confirmed delivery or reconciliation.';
COMMENT ON COLUMN crm.reminder_occurrences.provider_result_state IS 'Durable provider reconciliation state: unattempted, ambiguous, confirmed, or rejected.';
COMMENT ON COLUMN crm.reminder_occurrences.provider_effect_at IS 'When the idempotent provider effect was durably recorded.';
COMMENT ON COLUMN crm.reminder_occurrences.visible_at IS 'When the in-app notification became user-visible.';
COMMENT ON COLUMN crm.stay_in_touch_cadences.last_request_id IS 'Last accepted idempotent cadence mutation request.';
COMMENT ON COLUMN crm.stay_in_touch_cadences.last_request_fingerprint IS 'SHA-256 fingerprint of the last accepted cadence mutation payload.';
COMMENT ON TABLE crm.stay_in_touch_cadence_requests IS 'Durable workspace-scoped idempotency receipts for accepted stay-in-touch cadence mutations.';
COMMENT ON COLUMN crm.stay_in_touch_cadence_requests.workspace_id IS 'Workspace scope for request identity and tenant isolation.';
COMMENT ON COLUMN crm.stay_in_touch_cadence_requests.request_id IS 'Client mutation request identifier, unique only inside its workspace.';
COMMENT ON COLUMN crm.stay_in_touch_cadence_requests.cadence_id IS 'Cadence state returned for an accepted request replay.';
COMMENT ON COLUMN crm.stay_in_touch_cadence_requests.request_fingerprint IS 'SHA-256 fingerprint of the accepted cadence mutation payload.';
COMMENT ON COLUMN crm.stay_in_touch_cadence_requests.accepted_at IS 'When the request was first accepted.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm.reminder_occurrences WHERE provider_idempotency_key IS NULL)
     OR EXISTS (SELECT 1 FROM crm.reminder_occurrences GROUP BY provider_idempotency_key HAVING count(*) > 1)
  THEN
    RAISE EXCEPTION 'durable reminder delivery postcondition failed';
  END IF;
END
$$;
