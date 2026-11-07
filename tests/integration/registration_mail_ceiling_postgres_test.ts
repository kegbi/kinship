/**
 * SECA-03 (AUD-M3): registration and reset mail have per-address daily
 * ceilings, and reaching one is no account oracle (SECA-02).
 *
 * Registration mail — a verification link or the "you already have an
 * account" notice — is counted per address over a rolling day in the
 * attempt-budget table, one reservation per request whatever the address
 * turns out to be. Past the ceiling a fresh, a pending, and a registered
 * address get the same answer and no provider call. Reset requests are
 * counted in identity's own request table, which is written for every
 * request, account or not.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { PostgresPasswordRecoveryRepository } from "../../packages/backend/modules/identity/adapters/postgres/password_recovery.ts";
import { PostgresRegistrationTransaction } from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import { apiSupport, ORIGIN, originHeaders, PASSWORD } from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 3, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);
const connection = connectDatabase(databaseUrl);

/** The documented ceilings (`configuration-and-secrets.md`). */
const REGISTRATION_MAIL_DAILY_CEILING = 10;
const RESET_DAILY_CEILING = 10;

function post(path: string, body: unknown): Promise<Response> {
  return Promise.resolve(configured.app.request(`${ORIGIN}${path}`, {
    body: JSON.stringify(body),
    headers: originHeaders,
    method: "POST",
  }));
}

function registration(email: string): Promise<Response> {
  return post("/api/v1/registrations", {
    email,
    firstName: "Some",
    lastName: "One",
    password: PASSWORD,
    workspaceName: "Whatever",
  });
}

/** Every provider call an address has had, of any registration kind. */
function provided(email: string): number {
  return mail.tokens(email).length + mail.accountExistsTokens(email).length;
}

Deno.test({
  name:
    "[AUD-M3] past an address's daily registration-mail ceiling a fresh and a registered address answer alike with no provider call",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const fresh = "ceiling-fresh@example.test";
    const registered = "ceiling-registered@example.test";
    // The registered address's own registration spent one of its ten.
    await api.register(registered, "Registered circle");
    for (
      let attempt = 1;
      attempt < REGISTRATION_MAIL_DAILY_CEILING;
      attempt += 1
    ) {
      const told = await registration(registered);
      assert(told.status === 202, "the registered owner is told");
      await told.body?.cancel();
    }
    for (
      let attempt = 0;
      attempt < REGISTRATION_MAIL_DAILY_CEILING - 1;
      attempt += 1
    ) {
      const pending = await registration(fresh);
      assert(pending.status === 202, "a fresh address registers");
      await pending.body?.cancel();
    }
    const retried = await post("/api/v1/email-verification-deliveries", {
      email: fresh,
    });
    assert(retried.status === 202, "a retry spends the same ceiling");
    await retried.body?.cancel();
    // The pending address's retry is mailed after the answer (SECA-02).
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(
      provided(registered) === REGISTRATION_MAIL_DAILY_CEILING &&
        provided(fresh) === REGISTRATION_MAIL_DAILY_CEILING,
      `every registration under the ceiling is mailed (${
        provided(registered)
      }, ${provided(fresh)})`,
    );
    const [pendingBefore] = await sql<{ readonly tokens: number }[]>`
      select count(*)::int tokens from crm.email_verification_tokens t
      join crm.users u on u.id = t.user_id where u.email = ${fresh}
    `;

    const before = {
      fresh: provided(fresh),
      registered: provided(registered),
    };
    const answers: string[] = [];
    for (const address of [fresh, registered, fresh, registered]) {
      const response = await registration(address);
      const cookies = response.headers.getSetCookie().map((cookie) =>
        cookie.split("=")[0]
      ).join(",");
      answers.push(`${response.status} ${cookies} ${await response.text()}`);
    }
    assert(
      new Set(answers).size === 1 &&
        answers[0] ===
          `202 kinship_registrant ${
            JSON.stringify({ status: "verification-required" })
          }`,
      `a fresh and a registered address answer alike past the ceiling: ${
        JSON.stringify(answers)
      }`,
    );
    const quietRetry = await post("/api/v1/email-verification-deliveries", {
      email: fresh,
    });
    assert(quietRetry.status === 202, "a retry past the ceiling still answers");
    await quietRetry.body?.cancel();
    assert(
      provided(fresh) === before.fresh &&
        provided(registered) === before.registered,
      "past the ceiling no provider is called for either address",
    );
    const [pendingAfter] = await sql<{ readonly tokens: number }[]>`
      select count(*)::int tokens from crm.email_verification_tokens t
      join crm.users u on u.id = t.user_id where u.email = ${fresh}
    `;
    assert(
      pendingAfter?.tokens === pendingBefore?.tokens,
      "past the ceiling the pending registration is neither replaced nor reissued",
    );

    const [stored] = await sql<
      {
        readonly digests: number;
        readonly raw: number;
        readonly rows: number;
      }[]
    >`
      select count(*)::int rows,
        count(*) filter (where authentication_subject_digest
          ~ '^hmac-sha256:v[1-9][0-9]*:[0-9a-f]{64}$')::int digests,
        count(*) filter (where concat_ws(' ', path, client_ip::text,
          user_agent, authentication_subject_digest) ilike '%example.test%')::int raw
      from crm.api_request_logs where path = 'mail-budget/registration'
    `;
    assert(
      stored?.rows === 2 * REGISTRATION_MAIL_DAILY_CEILING &&
        stored.digests === stored.rows && stored.raw === 0,
      `only admitted requests are kept, keyed by digest alone: ${
        JSON.stringify(stored)
      }`,
    );

    // A rolling day later the address may be mailed again.
    await sql`
      update crm.api_request_logs
      set occurred_at = occurred_at - interval '25 hours'
      where path = 'mail-budget/registration'
    `;
    const nextDay = await registration(fresh);
    assert(nextDay.status === 202, "the next day's registration answers");
    await nextDay.body?.cancel();
    assert(
      provided(fresh) === before.fresh + 1,
      "and is mailed once more",
    );
  },
});

Deno.test({
  name:
    "[AUD-M3] a made-up invitation token spends no registration mail and does not reveal an exhausted ceiling",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const victim = "ceiling-victim@example.test";
    for (
      let attempt = 0;
      attempt < REGISTRATION_MAIL_DAILY_CEILING;
      attempt += 1
    ) {
      const response = await registration(victim);
      assert(response.status === 202, "the victim's address is registered");
      await response.body?.cancel();
    }
    const rows = async () => {
      const [row] = await sql<{ readonly count: number }[]>`
        select count(*)::int count from crm.api_request_logs
        where path = 'mail-budget/registration'
      `;
      return row?.count ?? 0;
    };
    const before = await rows();
    assert(
      before === REGISTRATION_MAIL_DAILY_CEILING,
      `the ceiling is spent (${before})`,
    );

    // The same answer, and no row, whether the address has budget left.
    for (const email of [victim, "ceiling-untouched@example.test"]) {
      const probe = await post("/api/v1/workspace-invitations/register", {
        email,
        firstName: "Some",
        lastName: "One",
        password: PASSWORD,
        token: "x".repeat(43),
      });
      const body = await probe.json() as { readonly code?: string };
      assert(
        probe.status === 404 &&
          body.code === "invitation_registration_unavailable",
        `a made-up token is only invalid, got ${probe.status} ${
          JSON.stringify(body)
        }`,
      );
      assert(
        await rows() === before,
        `a made-up token writes no registration-mail row for ${email}`,
      );
    }
  },
});

Deno.test({
  name:
    "[AUD-M3] an address's reset requests stop at ten a rolling day, account or not",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const registered = "reset-ceiling@example.test";
    const unknown = "reset-nobody@example.test";
    await api.register(registered, "Reset circle");
    const repository = new PostgresPasswordRecoveryRepository();
    const transaction = new PostgresRegistrationTransaction(connection.db);
    const start = Date.now();
    const request = (email: string, minutes: number) =>
      transaction.run((session) =>
        repository.createRequest({
          email,
          expiresAt: new Date(start + (minutes + 60) * 60_000),
          id: crypto.randomUUID(),
          now: new Date(start + minutes * 60_000),
          tokenHash: `reset-ceiling-${crypto.randomUUID()}`,
          transaction: session,
        })
      );
    const rows = async (email: string) => {
      const [row] = await sql<{ readonly count: number }[]>`
        select count(*)::int count from crm.password_reset_requests
        where email = ${email}
      `;
      return row?.count ?? 0;
    };

    // Sixteen minutes apart, so the three-in-fifteen-minutes burst limit
    // never applies and only the daily ceiling can.
    for (let index = 0; index < RESET_DAILY_CEILING; index += 1) {
      const delivered = await request(registered, index * 16);
      assert(
        delivered.deliveryEmail === registered,
        `reset request ${index + 1} is delivered`,
      );
      await request(unknown, index * 16);
    }
    const lastMinute = RESET_DAILY_CEILING * 16;
    const refused = await request(registered, lastMinute);
    await request(unknown, lastMinute);
    assert(
      refused.deliveryEmail === undefined,
      "the eleventh request in a day sends nothing",
    );
    assert(
      await rows(registered) === RESET_DAILY_CEILING &&
        await rows(unknown) === RESET_DAILY_CEILING,
      "an address with an account and one without are counted alike",
    );
    const nextDay = await request(registered, 25 * 60);
    assert(
      nextDay.deliveryEmail === registered,
      "a rolling day after the first request the address is mailed again",
    );
  },
});

Deno.test({
  name: "AUD-M3 registration mail ceiling PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([
      sql.end({ timeout: 1 }),
      configured.close(),
      connection.destroy(),
    ]);
  },
});
