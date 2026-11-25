import { databaseValue, sqlLiteral } from "./database.ts";

/** How far ahead a spec schedules a reminder it will bring due itself. */
const AHEAD_MS = 3 * 60_000;

/** A send time, to the minute, the worker cannot reach before the spec acts. */
export function upcomingSendTime(): Date {
  return new Date(Math.floor((Date.now() + AHEAD_MS) / 60_000) * 60_000);
}

/** Moves the one pending occurrence `where` matches to `age` before now. */
function moveOccurrence(
  email: string,
  title: string,
  age: string,
  where = "true",
): void {
  const moved = databaseValue(
    `with moved as (
      update crm.reminder_occurrences occurrence
      set deliver_at = now() - ${sqlLiteral(age)}::interval
      from crm.reminders reminder
      join crm.workspaces workspace on workspace.id = reminder.workspace_id
      join crm.users owner on owner.id = workspace.created_by_user_id
      where occurrence.reminder_id = reminder.id
        and occurrence.status = 'pending'
        and reminder.title = ${sqlLiteral(title)}
        and owner.email = ${sqlLiteral(email)}
        and ${where}
      returning occurrence.id
    ) select count(*)::text from moved`,
  );
  if (moved !== "1") {
    throw new Error(`${moved} pending occurrences of "${title}" came due`);
  }
}

/**
 * Brings the occurrence of `title`, owned by the member registered as `email`,
 * due as if its send time had come, once it is proved scheduled for exactly
 * `sendTime`. The worker then claims it on its next tick, so a spec proves a
 * real delivery without waiting out the minute a send time is precise to.
 */
export function bringReminderDue(
  email: string,
  title: string,
  sendTime: Date,
): void {
  moveOccurrence(
    email,
    title,
    "1 second",
    `occurrence.deliver_at = ${
      sqlLiteral(sendTime.toISOString())
    }::timestamptz`,
  );
}

/** Ages a reminder already brought due, as if it had waited for an hour. */
export function ageDueReminder(email: string, title: string): void {
  moveOccurrence(email, title, "1 hour");
}
