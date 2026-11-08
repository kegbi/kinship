-- Transaction ownership belongs to the canonical migration runner.

CREATE TABLE crm.recurring_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES crm.workspaces(id) ON DELETE CASCADE,
  person_id uuid NOT NULL,
  direction text NOT NULL,
  amount numeric(19,4) NOT NULL,
  currency_code char(3) NOT NULL REFERENCES crm.currencies(code),
  reason text,
  interval_months integer NOT NULL DEFAULT 1,
  day_of_month smallint NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  is_active boolean NOT NULL DEFAULT true,
  next_occurrence_on date,
  created_by_member_id uuid REFERENCES crm.workspace_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_debts_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT recurring_debts_person_fk FOREIGN KEY (workspace_id, person_id) REFERENCES crm.people(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT recurring_debts_direction_ck CHECK (direction IN ('i_owe', 'they_owe')),
  CONSTRAINT recurring_debts_amount_ck CHECK (amount >= 0),
  CONSTRAINT recurring_debts_interval_ck CHECK (interval_months BETWEEN 1 AND 120),
  CONSTRAINT recurring_debts_day_ck CHECK (day_of_month BETWEEN 1 AND 31),
  CONSTRAINT recurring_debts_window_ck CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CONSTRAINT recurring_debts_next_ck CHECK (next_occurrence_on IS NULL OR next_occurrence_on >= starts_on)
);
COMMENT ON TABLE crm.recurring_debts IS 'Rules that charge a person the same debt every N months on a day of the month; each due period becomes its own open debt.';
COMMENT ON COLUMN crm.recurring_debts.id IS 'Stable public primary key used by APIs, exports, imports, and internal references.';
COMMENT ON COLUMN crm.recurring_debts.workspace_id IS 'Workspace that owns this rule and its person.';
COMMENT ON COLUMN crm.recurring_debts.person_id IS 'Person each generated debt is with; same workspace by composite foreign key.';
COMMENT ON COLUMN crm.recurring_debts.direction IS 'Direction of every generated debt: i_owe or they_owe.';
COMMENT ON COLUMN crm.recurring_debts.amount IS 'Amount of every generated debt using decimal currency value.';
COMMENT ON COLUMN crm.recurring_debts.currency_code IS 'Currency of every generated debt.';
COMMENT ON COLUMN crm.recurring_debts.reason IS 'Reason copied onto every generated debt.';
COMMENT ON COLUMN crm.recurring_debts.interval_months IS 'Number of months between charges, 1 through 120.';
COMMENT ON COLUMN crm.recurring_debts.day_of_month IS 'Day of the month a charge falls due, 1 through 31; a shorter month uses its last day.';
COMMENT ON COLUMN crm.recurring_debts.starts_on IS 'First local date a charge may fall due; the first charge is the first matching day on or after it.';
COMMENT ON COLUMN crm.recurring_debts.ends_on IS 'Last local date a charge may fall due; null repeats without end.';
COMMENT ON COLUMN crm.recurring_debts.is_active IS 'False while the member has paused the rule; a paused rule generates nothing.';
COMMENT ON COLUMN crm.recurring_debts.next_occurrence_on IS 'Next due date not yet generated; null once the rule has passed its end date.';
COMMENT ON COLUMN crm.recurring_debts.created_by_member_id IS 'Member who created the rule, when still known.';
COMMENT ON COLUMN crm.recurring_debts.created_at IS 'Creation timestamp in UTC.';
COMMENT ON COLUMN crm.recurring_debts.updated_at IS 'Last update timestamp in UTC; maintained by application or trigger.';
CREATE INDEX recurring_debts_person_idx
  ON crm.recurring_debts (workspace_id, person_id);
CREATE INDEX recurring_debts_due_idx ON crm.recurring_debts (next_occurrence_on)
  WHERE is_active AND next_occurrence_on IS NOT NULL;

-- Every existing debt was recorded by hand, so both new columns start null.
ALTER TABLE crm.debts
  ADD COLUMN recurring_debt_id uuid,
  ADD COLUMN occurrence_on date,
  ADD CONSTRAINT debts_recurring_debt_fk FOREIGN KEY (workspace_id, recurring_debt_id) REFERENCES crm.recurring_debts(workspace_id, id) ON DELETE SET NULL (recurring_debt_id),
  ADD CONSTRAINT debts_recurrence_ck CHECK (recurring_debt_id IS NULL OR occurrence_on IS NOT NULL),
  ADD CONSTRAINT debts_recurring_occurrence_key UNIQUE (recurring_debt_id, occurrence_on);
COMMENT ON COLUMN crm.debts.recurring_debt_id IS 'Recurring rule that generated this debt; null for a debt recorded by hand or once its rule is deleted.';
COMMENT ON COLUMN crm.debts.occurrence_on IS 'Due date of the period a recurring rule generated this debt for; one debt per rule and date.';

DO $$
BEGIN
  IF to_regclass('crm.recurring_debts_due_idx') IS NULL
    OR EXISTS (SELECT 1 FROM crm.recurring_debts)
    OR EXISTS (
      SELECT 1 FROM crm.debts
      WHERE recurring_debt_id IS NOT NULL OR occurrence_on IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'recurring debt postcondition failed';
  END IF;
END
$$;
