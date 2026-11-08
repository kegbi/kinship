/**
 * The durable mail budget (SECA-03, AUD-M3), kept where the sign-in throttle
 * is: `crm.api_request_logs`.
 *
 * Schema v13 gives that table no scope column, so a budget is told apart the
 * way the throttle tells its two scopes apart (AUD-A3): by `path`. Each
 * admitted reservation is one row, `method = 'POST'`, `status_code = 202`,
 * with a `path` no HTTP route has —
 *
 * - `mail-budget/registration`: registration mail to one address, keyed by
 *   the address's keyed digest in `authentication_subject_digest`;
 * - `mail-budget/invitation`: one invitation, keyed both by the recipient's
 *   digest and by the sending `workspace_id` (with the inviter's `user_id`
 *   and `member_id`), so the per-recipient cap and the per-workspace quota
 *   count the same rows.
 *
 * The address is never stored, only its versioned HMAC under the throttle
 * keyset with its own `kinship.authentication.mail.v1` label, and every
 * retained key's digest is counted so a key rotation does not reset a budget.
 * A refused reservation writes nothing, so asking again never extends the
 * wait. Every key a reservation counts is locked first, in one sorted order,
 * so two concurrent reservations cannot both take the last place.
 */

import { type Kysely, sql, type Transaction } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  MailBudgetReservation,
  OutboundMailBudget,
} from "../../../workspaces/public.ts";
import type { AuthenticationSubjectDigester } from "../../application/authentication_subject.ts";

const PATHS = {
  invitation: "mail-budget/invitation",
  registration: "mail-budget/registration",
} as const;

/**
 * A `LIKE` pattern matching every budget's rows, which the retention job keeps
 * for longer than the budget window (AUD-A2).
 */
export const MAIL_BUDGET_PATH_PATTERN = "mail-budget/%";

export class PostgresOutboundMailBudget implements OutboundMailBudget {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly digester: AuthenticationSubjectDigester,
  ) {}

  async reserve(
    reservation: MailBudgetReservation,
  ): Promise<"admitted" | "exhausted"> {
    const path = PATHS[reservation.scope];
    const digests = await this.digester.digestCandidates(
      "mail",
      reservation.recipient,
    );
    const activeDigest = digests[0];
    if (!activeDigest) throw new Error("Mail budget digest missing.");
    const since = new Date(
      reservation.occurredAt.getTime() - reservation.windowMilliseconds,
    );
    const sender = reservation.sender;
    return await this.database.transaction().execute(async (transaction) => {
      const keys = [
        ...digests.map((digest) => `${path}\n${digest}`),
        ...(sender ? [`${path}\nworkspace:${sender.workspaceId}`] : []),
      ].sort();
      for (const key of keys) {
        await sql`
          select pg_advisory_xact_lock(hashtextextended(${key}, 0))
        `.execute(transaction);
      }
      // The per-recipient cap counts across every workspace on purpose, and
      // the budget rows mostly belong to none: both are read through the
      // budget functions (ADR 0008).
      const recipientCount = await this.#count(
        transaction,
        sql`(select count(*)::int from crm.request_budget_attempts(
          ${path}, ${[...digests]}::text[], ${since}
        ))`,
      );
      if (recipientCount >= reservation.recipientCeiling) return "exhausted";
      if (sender) {
        const workspaceCount = await this.#count(
          transaction,
          sql`crm.request_budget_workspace_count(
            ${path}, ${sender.workspaceId}::uuid, ${since}
          )`,
        );
        if (workspaceCount >= sender.ceiling) return "exhausted";
      }
      await sql`
        select crm.record_request_budget(
          ${path}, ${activeDigest}, null, 202, ${reservation.occurredAt},
          ${sender?.workspaceId ?? null}::uuid, ${sender?.userId ?? null}::uuid,
          ${sender?.memberId ?? null}::uuid
        )
      `.execute(transaction);
      return "admitted";
    });
  }

  async #count(
    transaction: Transaction<ApplicationDatabase>,
    count: ReturnType<typeof sql>,
  ): Promise<number> {
    const result = await sql<{ readonly count: number }>`
      select ${count} as count
    `.execute(transaction);
    return result.rows[0]?.count ?? 0;
  }
}
