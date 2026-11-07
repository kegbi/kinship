/**
 * How much mail the product may send on somebody's say-so (SECA-03, AUD-M3).
 *
 * Inviting a member and registering both mail an address the caller chose, so
 * both reserve here before they write or send anything. A reservation either
 * counts against its budgets and is admitted, or counts against nothing and
 * is refused: a refused request never extends the wait. The budget is durable
 * — api-access keeps it in the attempt-budget table, as it does the sign-in
 * throttle — so a restart or a second replica does not reset it.
 *
 * The limits are this module's policy and arrive with each reservation
 * (`domain/invitation_rules.ts`, `domain/registration_rules.ts`); the adapter
 * only counts. A reservation is keyed by the address it would mail and, for an
 * invitation, the workspace sending it — never by whether the address has an
 * account, so a refusal cannot reveal one.
 */

export interface MailBudgetReservation {
  readonly occurredAt: Date;
  /** The address the mail would go to, as the caller named it. */
  readonly recipient: string;
  /** Reservations one address may hold within the window. */
  readonly recipientCeiling: number;
  readonly scope: "invitation" | "registration";
  /** Invitations only: the workspace sending, and its own ceiling. */
  readonly sender?: {
    readonly ceiling: number;
    readonly memberId: string;
    readonly userId: string;
    readonly workspaceId: string;
  };
  readonly windowMilliseconds: number;
}

export interface OutboundMailBudget {
  reserve(
    reservation: MailBudgetReservation,
  ): Promise<"admitted" | "exhausted">;
}
