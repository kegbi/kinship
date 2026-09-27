import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  MemberReminderDelivery,
  ReminderDeliveryPreferences,
} from "../../ports/reminder_delivery_preferences.ts";

export class PostgresReminderDeliveryPreferences
  implements ReminderDeliveryPreferences {
  async listDeliveryPreferences(
    command: Parameters<
      ReminderDeliveryPreferences["listDeliveryPreferences"]
    >[0],
  ): Promise<readonly MemberReminderDelivery[]> {
    if (command.memberIds.length === 0) return [];
    const result = await sql<{
      readonly digest_time: string | null;
      readonly member_id: string;
      readonly reminder_delivery: MemberReminderDelivery["reminderDelivery"];
      readonly timezone: string | null;
    }>`
      select preference.member_id::text, preference.reminder_delivery,
        to_char(preference.digest_time, 'HH24:MI') as digest_time,
        preference.timezone
      from crm.member_preferences preference
      where preference.member_id = any(${command.memberIds}::uuid[])
      order by preference.member_id
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      ...pickDefined({ digestTime: row.digest_time }),
      memberId: row.member_id,
      reminderDelivery: row.reminder_delivery,
      ...pickDefined({ timezone: row.timezone }),
    }));
  }
}
