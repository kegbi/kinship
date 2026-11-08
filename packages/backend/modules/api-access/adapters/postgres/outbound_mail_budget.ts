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
      const recipientCount = await this.#count(
        transaction,
        sql`log.path = ${path} and log.authentication_subject_digest in (${
          sql.join(digests.map((digest) => sql`${digest}`))
        })`,
        since,
      );
      if (recipientCount >= reservation.recipientCeiling) return "exhausted";
      if (sender) {
        const workspaceCount = await this.#count(
          transaction,
          sql`log.path = ${path} and log.workspace_id = ${sender.workspaceId}::uuid`,
          since,
        );
        if (workspaceCount >= sender.ceiling) return "exhausted";
      }
      await sql`
        insert into crm.api_request_logs (
          workspace_id, user_id, member_id, method, path,
          authentication_subject_digest, status_code, occurred_at, created_at
        ) values (
          ${sender?.workspaceId ?? null}::uuid, ${sender?.userId ?? null}::uuid,
          ${sender?.memberId ?? null}::uuid, 'POST', ${path}, ${activeDigest},
          202, ${reservation.occurredAt}, ${reservation.occurredAt}
        )
      `.execute(transaction);
      return "admitted";
    });
  }

  async #count(
    transaction: Transaction<ApplicationDatabase>,
    key: ReturnType<typeof sql>,
    since: Date,
  ): Promise<number> {
    const result = await sql<{ readonly count: number }>`
      select count(*)::int count from crm.api_request_logs log
      where log.method = 'POST' and ${key} and log.occurred_at > ${since}
    `.execute(transaction);
    return result.rows[0]?.count ?? 0;
  }
}
