-- Transaction ownership belongs to the canonical migration runner.

COMMENT ON COLUMN crm.member_preferences.reminder_delivery IS
  'Channels for every reminder occurrence not yet sent, including those already scheduled: in_app, email, or both; email requires a verified address.';
