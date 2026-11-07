/**
 * What the notifications feed reads (GAP-053, `TODAY-002`).
 *
 * The feed is addressed to one member of one workspace. The repository
 * decides what reaches them — their own delivered in-app reminders, their own
 * email reminders that could not be delivered, their own finished data jobs,
 * and the invitations they sent that were accepted — and the application
 * decides the link each opens and which are unread.
 */

export interface NotificationsActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * What a notification is about:
 *
 * - `reminder`: one of the member's in-app reminders was delivered;
 * - `reminder-email-failed`: one of their email reminders could not be
 *   delivered (`planning.reminder-failed` on the email channel);
 * - `export-ready`: an export they requested is ready (`export.completed`);
 * - `import-finished`: an import they ran was committed (`import.committed`);
 * - `invitation-accepted`: somebody accepted an invitation they sent
 *   (`workspace.member-joined` for a member they invited).
 */
export type NotificationKind =
  | "export-ready"
  | "import-finished"
  | "invitation-accepted"
  | "reminder"
  | "reminder-email-failed";

export interface NotificationPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

/** One feed item as the repository reads it. */
export interface NotificationRecord {
  /** The occurrence id for a reminder, the audit event id otherwise. */
  readonly id: string;
  readonly kind: NotificationKind;
  /** When it happened, in UTC at millisecond precision. */
  readonly occurredAt: string;
  readonly person?: NotificationPerson;
  /** What the event was about, such as the data import's id. */
  readonly subjectId?: string;
  /** The reminder's title, for the two reminder kinds. */
  readonly title?: string;
}

/** Where the previous page ended. */
export interface NotificationPosition {
  readonly at: string;
  readonly id: string;
}

export interface NotificationsRepository {
  /** The member's items, newest first, after `after`; at most `limit`. */
  list(
    command: NotificationsActor & {
      readonly after?: NotificationPosition;
      readonly limit: number;
    },
  ): Promise<readonly NotificationRecord[]>;
  /**
   * How many of the member's items are after the read-through watermark the
   * member's interface state holds (all of them without a valid one),
   * counting no further than `cap`, and that watermark as the column holds
   * it. Both come from one statement, so the count waits on no earlier read
   * of the watermark and runs beside the page (BEQ-04).
   */
  countUnread(
    command: NotificationsActor & { readonly cap: number },
  ): Promise<{ readonly count: number; readonly readThrough?: unknown }>;
}
