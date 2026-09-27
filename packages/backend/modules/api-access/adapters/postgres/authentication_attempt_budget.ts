import { type Kysely, sql, type Transaction } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  AuthenticationAttemptBudget,
  AuthenticationRequestStatusCode,
} from "../../../workspaces/public.ts";
import type { AuthenticationSubjectDigester } from "../../application/authentication_subject.ts";

const WINDOW_MILLISECONDS = 5 * 60_000;
const FAILURE_LIMIT = 5;

function route(scope: "mfa" | "password"): string {
  return scope === "password" ? "/api/v1/sessions" : "/api/v1/mfa-challenges";
}

interface BudgetState {
  readonly count: number;
  readonly oldest?: Date;
}

export class PostgresAuthenticationAttemptBudget
  implements AuthenticationAttemptBudget {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly digester: AuthenticationSubjectDigester,
  ) {}

  async reserve(
    command: Parameters<AuthenticationAttemptBudget["reserve"]>[0],
  ): ReturnType<AuthenticationAttemptBudget["reserve"]> {
    const path = route(command.scope);
    const digests = await this.digester.digestCandidates(
      command.scope,
      command.subject,
    );
    const activeDigest = digests[0];
    if (!activeDigest) {
      throw new Error("Authentication subject digest missing.");
    }

    return await this.database.transaction().execute(async (transaction) => {
      // Lock every retained digest in deterministic order. During key rotation,
      // old and new processes still share at least one lock until the retired
      // key leaves the configured verification set.
      for (const digest of [...digests].sort()) {
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`${path}\n${command.clientAddress}\n${digest}`}, 0)
          )
        `.execute(transaction);
      }
      const current = await this.#inspect(
        transaction,
        path,
        command.clientAddress,
        digests,
        command.occurredAt,
      );
      if (current.count >= FAILURE_LIMIT) {
        const reservationId = await this.#record(
          transaction,
          path,
          command.clientAddress,
          activeDigest,
          null,
          command.occurredAt,
        );
        return {
          ...this.#limited(current, command.occurredAt),
          reservationId,
        };
      }
      const reservationId = await this.#record(
        transaction,
        path,
        command.clientAddress,
        activeDigest,
        null,
        command.occurredAt,
      );
      return { reservationId, status: "admitted" as const };
    });
  }

  async finalize(
    command: Parameters<AuthenticationAttemptBudget["finalize"]>[0],
  ): Promise<void> {
    if (command.statusCode === 200 && !command.userId) {
      throw new Error("Authenticated request log requires its user.");
    }
    if (command.statusCode !== 200 && command.userId) {
      throw new Error("Pre-authentication request log cannot identify a user.");
    }
    const finalized = await sql<{ readonly id: string }>`
      update crm.api_request_logs
      set status_code = ${command.statusCode},
        user_id = ${command.statusCode === 200 ? command.userId! : null}::uuid
      where id = ${command.reservationId}::uuid and status_code is null
      returning id::text
    `.execute(
      command.transaction
        ? databaseFromSession(command.transaction)
        : this.database,
    );
    if (
      finalized.rows.length !== 1 ||
      finalized.rows[0]?.id !== command.reservationId
    ) {
      throw new Error("Authentication request reservation was not finalized.");
    }
  }

  async #inspect(
    transaction: Transaction<ApplicationDatabase>,
    path: string,
    clientAddress: string,
    digests: readonly string[],
    occurredAt: Date,
  ): Promise<BudgetState> {
    const windowStart = new Date(occurredAt.getTime() - WINDOW_MILLISECONDS);
    const candidates = sql.join(digests.map((digest) => sql`${digest}`));
    // Only a fully established HTTP 200 authentication resets prior failures.
    // Outstanding reservations always count; 202/403/410/429/503 outcomes are
    // intentionally neutral once their exact reservation is finalized.
    const result = await sql<{
      readonly count: number;
      readonly oldest: Date | null;
    }>`
      with latest_success as (
        select max(occurred_at) succeeded_at
        from crm.api_request_logs
        where method = 'POST' and path = ${path}
          and client_ip = ${clientAddress}::inet
          and authentication_subject_digest in (${candidates})
          and status_code = 200 and occurred_at > ${windowStart}
      )
      select count(*)::int count, min(log.occurred_at) oldest
      from crm.api_request_logs log cross join latest_success success
      where log.method = 'POST' and log.path = ${path}
        and log.client_ip = ${clientAddress}::inet
        and log.authentication_subject_digest in (${candidates})
        and (
          (log.status_code is null and log.occurred_at > ${windowStart})
          or (
            log.status_code = 401 and log.occurred_at > greatest(
              ${windowStart},
              coalesce(success.succeeded_at, ${windowStart})
            )
          )
        )
    `.execute(transaction);
    const state = result.rows[0];
    return {
      count: state?.count ?? 0,
      ...(state?.oldest ? { oldest: state.oldest } : {}),
    };
  }

  #limited(
    state: BudgetState,
    occurredAt: Date,
  ): {
    readonly retryAfterSeconds: number;
    readonly status: "rate-limited";
  } {
    const oldest = state.oldest?.getTime() ?? occurredAt.getTime();
    return {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (oldest + WINDOW_MILLISECONDS - occurredAt.getTime()) / 1_000,
        ),
      ),
      status: "rate-limited",
    };
  }

  async #record(
    database: Transaction<ApplicationDatabase>,
    path: string,
    clientAddress: string,
    digest: string,
    statusCode: AuthenticationRequestStatusCode | null,
    occurredAt: Date,
  ): Promise<string> {
    const inserted = await sql<{ readonly id: string }>`
      insert into crm.api_request_logs (
        user_id, method, path, client_ip, authentication_subject_digest,
        status_code, occurred_at, created_at
      ) values (
        null, 'POST', ${path}, ${clientAddress}::inet,
        ${digest}, ${statusCode}, ${occurredAt}, ${occurredAt}
      )
      returning id::text
    `.execute(database);
    const row = inserted.rows[0];
    if (!row) throw new Error("Authentication request was not recorded.");
    return row.id;
  }
}
