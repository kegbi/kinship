import { type Kysely, sql, type Transaction } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  AuthenticationAttemptBudget,
  AuthenticationRequestStatusCode,
} from "../../../workspaces/public.ts";
import type { AuthenticationSubjectDigester } from "../../application/authentication_subject.ts";
import type { SignInDeviceTokens } from "../../application/sign_in_device.ts";

/** Each (client address, subject) pair: five failures per five minutes. */
const WINDOW_MILLISECONDS = 5 * 60_000;
const FAILURE_LIMIT = 5;

/**
 * Each subject across every address (AUD-A3). Once ten attempts since the last
 * success within fifteen minutes have failed or are still outstanding, the next
 * attempt from any address waits 15 s after the latest of them, doubling with
 * each further one and capped at five minutes. A refused attempt is neutral, so
 * the delay is never extended by waiting it out, and the correct password is
 * evaluated, and clears the count, as soon as it elapses.
 *
 * A password attempt that carries a live sign-in device token for its subject
 * (`sign_in_device.ts`) is exempt from this ceiling, though never from the
 * per-address budget, so an attacker holding the account behind the ceiling
 * cannot keep its owner out of a browser they signed in from before.
 */
const ACCOUNT_WINDOW_MILLISECONDS = 15 * 60_000;
const ACCOUNT_CEILING = 10;
const ACCOUNT_BASE_DELAY_MILLISECONDS = 15_000;
const ACCOUNT_MAXIMUM_DELAY_MILLISECONDS = 5 * 60_000;

function route(scope: "mfa" | "password"): string {
  return scope === "password" ? "/api/v1/sessions" : "/api/v1/mfa-challenges";
}

interface BudgetState {
  readonly accountCount: number;
  readonly accountLatest?: Date;
  readonly count: number;
  readonly oldest?: Date;
}

/** Milliseconds until the budget admits another attempt; 0 admits now. */
function budgetWait(
  state: BudgetState,
  occurredAt: Date,
  recognizedDevice: boolean,
): number {
  const now = occurredAt.getTime();
  const addressWait = state.count >= FAILURE_LIMIT
    ? (state.oldest?.getTime() ?? now) + WINDOW_MILLISECONDS - now
    : 0;
  const accountWait = !recognizedDevice && state.accountCount >= ACCOUNT_CEILING
    ? (state.accountLatest?.getTime() ?? now) +
      Math.min(
        ACCOUNT_MAXIMUM_DELAY_MILLISECONDS,
        ACCOUNT_BASE_DELAY_MILLISECONDS *
          2 ** (state.accountCount - ACCOUNT_CEILING),
      ) - now
    : 0;
  return Math.max(0, addressWait, accountWait);
}

export class PostgresAuthenticationAttemptBudget
  implements AuthenticationAttemptBudget {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly digester: AuthenticationSubjectDigester,
    private readonly devices?: SignInDeviceTokens,
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
    const recognizedDevice = command.scope === "password" &&
      this.devices !== undefined &&
      await this.devices.recognizes({
        at: command.occurredAt,
        digests,
        token: command.deviceToken,
      });

    return await this.database.transaction().execute(async (transaction) => {
      // The lock is per subject, not per (address, subject): the account
      // ceiling counts across addresses, so attempts from different addresses
      // must read the count one at a time, and the per-address rule is
      // serialized by the same lock. Lock every retained digest in
      // deterministic order. During key rotation, old and new processes still
      // share at least one lock until the retired key leaves the configured
      // verification set.
      for (const digest of [...digests].sort()) {
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(${`${path}\n${digest}`}, 0)
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
      const reservationId = await this.#record(
        transaction,
        path,
        command.clientAddress,
        activeDigest,
        null,
        command.occurredAt,
      );
      const wait = budgetWait(current, command.occurredAt, recognizedDevice);
      if (wait > 0) {
        return {
          reservationId,
          retryAfterSeconds: Math.max(1, Math.ceil(wait / 1_000)),
          status: "rate-limited" as const,
        };
      }
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
    const accountWindowStart = new Date(
      occurredAt.getTime() - ACCOUNT_WINDOW_MILLISECONDS,
    );
    const candidates = sql.join(digests.map((digest) => sql`${digest}`));
    // Only a fully established HTTP 200 authentication resets prior failures:
    // one from this address resets the address budget, and one from any
    // address resets the account ceiling. Outstanding reservations always
    // count; 202/403/410/429/503 outcomes are intentionally neutral once their
    // exact reservation is finalized.
    const result = await sql<{
      readonly account_count: number;
      readonly account_latest: Date | null;
      readonly count: number;
      readonly oldest: Date | null;
    }>`
      with attempts as (
        select log.client_ip = ${clientAddress}::inet same_address,
          log.status_code, log.occurred_at
        from crm.api_request_logs log
        where log.method = 'POST' and log.path = ${path}
          and log.authentication_subject_digest in (${candidates})
          and log.occurred_at > ${accountWindowStart}
          and (log.status_code is null or log.status_code in (200, 401))
      ), latest_success as (
        select
          max(occurred_at) filter (where same_address) address_succeeded_at,
          max(occurred_at) account_succeeded_at
        from attempts where status_code = 200
      ), counted as (
        select attempt.same_address and (
            (attempt.status_code is null
              and attempt.occurred_at > ${windowStart})
            or (
              attempt.status_code = 401 and attempt.occurred_at > greatest(
                ${windowStart},
                coalesce(success.address_succeeded_at, ${windowStart})
              )
            )
          ) address_counted,
          attempt.status_code is null or (
            attempt.status_code = 401 and attempt.occurred_at > coalesce(
              success.account_succeeded_at, ${accountWindowStart}
            )
          ) account_counted,
          attempt.occurred_at
        from attempts attempt cross join latest_success success
      )
      select count(*) filter (where address_counted)::int count,
        min(occurred_at) filter (where address_counted) oldest,
        count(*) filter (where account_counted)::int account_count,
        max(occurred_at) filter (where account_counted) account_latest
      from counted
    `.execute(transaction);
    const state = result.rows[0];
    return {
      accountCount: state?.account_count ?? 0,
      ...(state?.account_latest ? { accountLatest: state.account_latest } : {}),
      count: state?.count ?? 0,
      ...(state?.oldest ? { oldest: state.oldest } : {}),
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
