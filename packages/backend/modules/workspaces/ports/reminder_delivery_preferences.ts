/**
 * What members chose about reminder delivery (PLANNING-003), as the planning
 * module reads it. `workspaces` owns `member_preferences`, so planning asks
 * this boundary instead of reading the table: which channels a member's new
 * reminders use, the local time of their daily email digest, and the zone
 * that time is read in.
 */

export interface ReminderDeliveryPreferencesTransaction {
  readonly opaque: unknown;
}

/** One member's delivery choice. */
export interface MemberReminderDelivery {
  /** The local `HH:MM` of the daily email digest, absent when there is none. */
  readonly digestTime?: string;
  readonly memberId: string;
  readonly reminderDelivery: "both" | "email" | "in_app";
  /** The member's own IANA zone, absent when they chose none. */
  readonly timezone?: string;
}

export interface ReminderDeliveryPreferences {
  /** The choices of those of `memberIds` that have a preferences row. */
  listDeliveryPreferences(command: {
    readonly memberIds: readonly string[];
    readonly transaction: ReminderDeliveryPreferencesTransaction;
  }): Promise<readonly MemberReminderDelivery[]>;
}
