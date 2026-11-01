# Repository schema v11 to v12

A member's reminder-delivery choice now applies to every reminder occurrence
that has not been sent. Each worker replenishment moves every waiting occurrence
(pending, never attempted, not yet due) onto the member's current channels: a
waiting date gains a copy on each chosen channel it lacks, then loses its copies
on channels no longer chosen, never its last one. One-off reminders are
included. Occurrences already attempted, sent, or due keep their channel.

The v11 comment on `member_preferences.reminder_delivery` still described
channels for occurrences generated from now on, which no longer matches the
behavior. V12 rewords only that column comment to: "Channels for every reminder
occurrence not yet sent, including those already scheduled: in_app, email, or
both; email requires a verified address."

`0012_reword_member_reminder_delivery_comment.sql` is a single transactional
`COMMENT ON COLUMN` statement. It adds, removes, or alters no table, column,
constraint, index, default, or row, so no data is read or rewritten and the
statement takes only a brief catalog lock. Older application versions are
unaffected. Rollback is compatible: restoring the previous application needs no
schema change, and the v11 comment can be reinstated by a manual reviewed
`COMMENT ON COLUMN`, though the exact-catalog check would then classify the
database as v11 again.

The field catalog marks the row `added in v8; comment reworded in v12`. The
Monica mappings are unchanged. Validation covers immutable hashes, clean apply,
exact v1–v11 upgrade, idempotent verification, drift rejection, transactional
rollback of the comment migration, and preservation of existing rows.
