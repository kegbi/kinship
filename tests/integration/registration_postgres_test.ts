import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  PostgresIdentityRegistration,
} from "../../packages/backend/modules/identity/public.ts";
import { PostgresRegistrationAudit } from "../../packages/backend/modules/governance/public.ts";
import {
  PostgresRegistrationTransaction,
  PostgresWorkspaceRegistration,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { applyCanonicalBaseline } from "../../tools/migrations/baseline.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const sql = postgres(databaseUrl, {
  max: 2,
  onnotice: () => undefined,
  prepare: false,
});
const capturedMail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  capturedMail,
  browserSecurityPolicy("test", "http://localhost"),
);
const postconditionConnection = connectDatabase(databaseUrl);

async function reset(): Promise<void> {
  await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
}

async function register(email: string): Promise<Response> {
  return await configured.app.request("http://localhost/api/v1/registrations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      firstName: "Ada",
      lastName: "Lovelace",
      password: "correct horse battery staple",
      workspaceName: "Ada's circle",
    }),
  });
}

Deno.test({
  name:
    "real PostgreSQL registration, verification, replay, duplicate race, and legacy non-activation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await reset();
    const response = await register("Owner@Example.test");
    assert(
      response.status === 202,
      `expected registration 202, got ${response.status}`,
    );
    const registrationBody = await response.text();
    assert(
      !registrationBody.includes("token"),
      "registration response must not expose token material",
    );

    const [shape] = await sql<{
      audits: number;
      members: number;
      preferences: number;
      settings: number;
      tokens: number;
      users: number;
      workspaces: number;
    }[]>`
      select
        (select count(*)::int from crm.users) users,
        (select count(*)::int from crm.workspaces) workspaces,
        (select count(*)::int from crm.workspace_members where role = 'owner' and status = 'active') members,
        (select count(*)::int from crm.member_preferences) preferences,
        (select count(*)::int from crm.workspace_settings) settings,
        (select count(*)::int from crm.audit_events where action = 'workspace.created') audits,
        (select count(*)::int from crm.email_verification_tokens where used_at is null) tokens
    `;
    assert(
      shape?.users === 1 && shape.workspaces === 1 && shape.members === 1,
      "one pending owner workspace must exist",
    );
    assert(
      shape.preferences === 1 && shape.settings === 1 && shape.audits === 1 &&
        shape.tokens === 1,
      "required defaults, audit, and token must be atomic",
    );

    const token = capturedMail.latestToken("owner@example.test");
    assert(token, "injected mail fake must receive verification");
    const stored = await sql<
      { token_hash: string }[]
    >`select token_hash from crm.email_verification_tokens`;
    assert(
      stored[0]?.token_hash !== token,
      "only the token hash may be persisted",
    );
    const oldTokenHash = stored[0]?.token_hash;
    assert(oldTokenHash, "stored token hash exists");

    const retry = await configured.app.request(
      "http://localhost/api/v1/email-verification-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "OWNER@example.test" }),
      },
    );
    assert(retry.status === 202, "anonymous delivery retry is accepted");
    const retriedToken = capturedMail.latestToken("owner@example.test");
    assert(
      retriedToken && retriedToken !== token,
      "retry must rotate the raw token after its transaction commits",
    );
    const [retryState] = await sql<{ pending: number; old_hashes: number }[]>`
      select
        count(*)::int as pending,
        count(*) filter (where token_hash = ${oldTokenHash})::int as old_hashes
      from crm.email_verification_tokens where used_at is null
    `;
    assert(
      retryState?.pending === 2 && retryState.old_hashes === 1,
      "retry preserves the initial usable token",
    );
    const mailCountBeforeCooldown = capturedMail.tokens("owner@example.test")
      .length;
    await configured.app.request(
      "http://localhost/api/v1/email-verification-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test" }),
      },
    );
    assert(
      capturedMail.tokens("owner@example.test").length ===
        mailCountBeforeCooldown,
      "persisted cooldown bounds repeated provider work",
    );

    const verifyCandidate = (candidate: string) =>
      configured.app.request(
        "http://localhost/api/v1/email-verifications",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: candidate }),
        },
      );
    const [verification, competingVerification] = await Promise.all([
      verifyCandidate(token),
      verifyCandidate(retriedToken),
    ]);
    assert(
      [verification.status, competingVerification.status].sort().join(",") ===
        "200,409",
      "concurrent verification links issue exactly one handoff",
    );
    const successfulVerification = verification.status === 200
      ? verification
      : competingVerification;
    const cookie = successfulVerification.headers.get("set-cookie");
    assert(
      cookie?.includes("HttpOnly") &&
        !JSON.stringify(await successfulVerification.json()).includes(token),
      "verification returns only an HttpOnly handoff",
    );

    const [verified] = await sql<
      { members: number; sessions: number; users: number }[]
    >`
      select
        (select count(*)::int from crm.users where email_verified_at is not null) users,
        (select count(*)::int from crm.workspace_members where role = 'owner' and status = 'active') members,
        (select count(*)::int from crm.user_sessions where revoked_at is null) sessions
    `;
    assert(
      verified?.users === 1 && verified.members === 1 &&
        verified.sessions === 1,
      "verification must yield one verified owner and one narrow handoff",
    );
    const deliveriesAfterVerify = capturedMail.tokens("owner@example.test")
      .length;
    await configured.app.request(
      "http://localhost/api/v1/email-verification-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.test" }),
      },
    );
    assert(
      capturedMail.tokens("owner@example.test").length ===
        deliveriesAfterVerify,
      "already verified identity never triggers another delivery",
    );

    const entry = await configured.app.request(
      "http://localhost/api/v1/application-entry",
      {
        method: "POST",
        headers: { cookie: cookie ?? "", origin: "http://localhost" },
      },
    );
    assert(entry.status === 200, "valid handoff enters the application once");
    const replayEntry = await configured.app.request(
      "http://localhost/api/v1/application-entry",
      {
        method: "POST",
        headers: { cookie: cookie ?? "", origin: "http://localhost" },
      },
    );
    assert(
      replayEntry.status === 409,
      "application-entry handoff must be single use",
    );
    const replayVerification = await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: retriedToken }),
      },
    );
    assert(
      replayVerification.status === 409,
      "verification token must be single use",
    );

    const duplicateResponses = await Promise.all([
      register("owner@example.test"),
      register("OWNER@example.test"),
    ]);
    assert(
      duplicateResponses.every((item) => item.status === 409),
      "duplicate race must conflict safely",
    );
    const [userCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from crm.users`;
    assert(userCount?.count === 1, "duplicate race must not add rows");

    await reset();
    const expiredEmail = "expired@example.test";
    assert(
      (await register(expiredEmail)).status === 202,
      "expired fixture registration must succeed",
    );
    await sql`update crm.email_verification_tokens set expires_at = now() - interval '1 minute'`;
    const expiredToken = capturedMail.latestToken(expiredEmail);
    assert(expiredToken, "injected mail fake must capture expired fixture");
    const expiredResponse = await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: expiredToken }),
      },
    );
    assert(
      expiredResponse.status === 410,
      "expired verification must be rejected",
    );
    const [expiredState] = await sql<{ sessions: number; verified: number }[]>`
      select
        (select count(*)::int from crm.users where email_verified_at is not null) verified,
        (select count(*)::int from crm.user_sessions) sessions
    `;
    assert(
      expiredState?.verified === 0 && expiredState.sessions === 0,
      "expired verification must not activate identity or handoff",
    );

    await reset();
    const legacyId = crypto.randomUUID();
    await sql`
      insert into crm.users (id, email, password_hash, first_name, status, email_verified_at)
      values (${legacyId}::uuid, 'legacy@example.test', '$2y$10$legacy-looking-material', 'Legacy', 'active', null)
    `;
    const legacyResponse = await register("legacy@example.test");
    assert(
      legacyResponse.status === 409,
      "an imported identity cannot be claimed by registration",
    );
    const [legacy] = await sql<
      {
        email_verified_at: Date | null;
        password_hash: string;
        sessions: number;
      }[]
    >`
      select u.password_hash, u.email_verified_at,
        (select count(*)::int from crm.user_sessions where user_id = u.id) sessions
      from crm.users u where u.id = ${legacyId}::uuid
    `;
    assert(
      legacy?.password_hash === "$2y$10$legacy-looking-material",
      "legacy credential material must not be overwritten",
    );
    assert(
      legacy.email_verified_at === null && legacy.sessions === 0,
      "legacy identity must not be verified or issued a handoff",
    );
    const legacyTokensBefore = await sql<
      { count: number }[]
    >`select count(*)::int count from crm.email_verification_tokens where user_id = ${legacyId}::uuid`;
    await configured.app.request(
      "http://localhost/api/v1/email-verification-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "legacy@example.test" }),
      },
    );
    const legacyTokensAfter = await sql<
      { count: number }[]
    >`select count(*)::int count from crm.email_verification_tokens where user_id = ${legacyId}::uuid`;
    assert(
      legacyTokensBefore[0]?.count === 0 && legacyTokensAfter[0]?.count === 0,
      "imported active/unverified identity without app token is untouched",
    );

    await reset();
    const racingEmail = "resend-verify-race@example.test";
    assert((await register(racingEmail)).status === 202, "race fixture exists");
    const racingToken = capturedMail.latestToken(racingEmail);
    assert(racingToken, "race fixture token exists");
    const [raceRetry, raceVerify] = await Promise.all([
      configured.app.request(
        "http://localhost/api/v1/email-verification-deliveries",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: racingEmail }),
        },
      ),
      configured.app.request(
        "http://localhost/api/v1/email-verifications",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: racingToken }),
        },
      ),
    ]);
    const [raceState] = await sql<
      { pending: number; sessions: number; verified: number }[]
    >`
      select
        (select count(*)::int from crm.email_verification_tokens where used_at is null) pending,
        (select count(*)::int from crm.user_sessions where revoked_at is null) sessions,
        (select count(*)::int from crm.users where email_verified_at is not null) verified
    `;
    assert(
      raceRetry.status === 202 && raceVerify.status === 200 &&
        raceState?.pending === 0 && raceState.sessions === 1 &&
        raceState.verified === 1,
      "concurrent resend and verification serialize to one verified handoff",
    );

    await reset();
    const failingMailApp = createConfiguredApiApp(
      databaseUrl,
      { sendVerification: () => Promise.reject(new Error("provider down")) },
      browserSecurityPolicy("test", "http://localhost"),
    );
    try {
      const failedRegistration = await failingMailApp.app.request(
        "http://localhost/api/v1/registrations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "provider-failure@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            password: "correct horse battery staple",
            workspaceName: "Provider failure circle",
          }),
        },
      );
      assert(failedRegistration.status === 503, "provider failure is truthful");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await failingMailApp.app.request(
          "http://localhost/api/v1/email-verification-deliveries",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "provider-failure@example.test" }),
          },
        );
      }
      const [failedDeliveryState] = await sql<
        { pending: number; total: number }[]
      >`
        select count(*) filter (where used_at is null)::int pending,
          count(*)::int total
        from crm.email_verification_tokens
      `;
      assert(
        failedDeliveryState?.pending === 2 && failedDeliveryState.total === 2,
        "provider failures retain both usable links and persisted cooldown caps work",
      );
    } finally {
      await failingMailApp.close();
    }

    await reset();
    assert(
      (await register("postconditions@example.test")).status === 202,
      "postcondition fixture registration succeeds",
    );
    const [links] = await sql<{
      email: string;
      member_id: string;
      token_hash: string;
      token_id: string;
      user_id: string;
      workspace_id: string;
    }[]>`
      select u.id::text user_id, u.email::text email,
        t.id::text token_id, t.token_hash,
        wm.id::text member_id, w.id::text workspace_id
      from crm.users u
      join crm.email_verification_tokens t on t.user_id = u.id
      join crm.workspace_members wm on wm.user_id = u.id
      join crm.workspaces w on w.id = wm.workspace_id
    `;
    assert(links, "postcondition fixture links exist");
    const transaction = new PostgresRegistrationTransaction(
      postconditionConnection.db,
    );
    const identity = new PostgresIdentityRegistration();
    const workspace = new PostgresWorkspaceRegistration();
    const audit = new PostgresRegistrationAudit();
    for (
      const check of [
        () =>
          transaction.run((session) =>
            identity.assertPendingUserPostconditions({
              email: links.email,
              expiresAt: new Date(0),
              firstName: "Ada",
              lastName: "Lovelace",
              passwordHash: "wrong-password-hash",
              tokenHash: "wrong-token-hash",
              transaction: session,
              userId: links.user_id,
              verificationTokenId: links.token_id,
            })
          ),
        () =>
          transaction.run((session) =>
            workspace.assertFirstWorkspacePostconditions({
              joinedAt: new Date(0),
              memberId: links.member_id,
              name: "wrong workspace",
              transaction: session,
              userId: crypto.randomUUID(),
              workspaceId: links.workspace_id,
            })
          ),
        () =>
          transaction.run((session) =>
            audit.assertWorkspaceCreatedPostcondition({
              memberId: crypto.randomUUID(),
              occurredAt: new Date(0),
              transaction: session,
              workspaceId: links.workspace_id,
            })
          ),
      ]
    ) {
      let rejected = false;
      try {
        await check();
      } catch {
        rejected = true;
      }
      assert(rejected, "each module rejects a wrong exact postcondition link");
    }

    const canonicalSql = await Deno.readTextFile(
      "personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
    );
    assert(
      await applyCanonicalBaseline(databaseUrl, canonicalSql) === "verify",
      "unmodified canonical catalog verifies",
    );
    await sql`
      alter table crm.dav_address_book_subscriptions
      rename to dav_address_book_subscriptions_drift
    `;
    try {
      let driftRejected = false;
      try {
        await applyCanonicalBaseline(databaseUrl, canonicalSql);
      } catch {
        driftRejected = true;
      }
      assert(
        driftRejected,
        "renaming a noncritical table while retaining 87 must be rejected",
      );
    } finally {
      await sql`
        alter table crm.dav_address_book_subscriptions_drift
        rename to dav_address_book_subscriptions
      `;
    }
    const expectStructuralDrift = async (
      mutate: () => Promise<unknown>,
      restore: () => Promise<unknown>,
      message: string,
    ): Promise<void> => {
      await mutate();
      try {
        let rejected = false;
        try {
          await applyCanonicalBaseline(databaseUrl, canonicalSql);
        } catch {
          rejected = true;
        }
        assert(rejected, message);
      } finally {
        await restore();
      }
    };
    await expectStructuralDrift(
      () => sql`alter table crm.users alter column first_name drop not null`,
      () => sql`alter table crm.users alter column first_name set not null`,
      "same-table-count altered column must be rejected",
    );
    await expectStructuralDrift(
      () => sql`alter table crm.users drop constraint users_status_check`,
      () =>
        sql`alter table crm.users add constraint users_status_check check (status in ('active', 'disabled', 'deleted'))`,
      "same-table-count altered check must be rejected",
    );
    await expectStructuralDrift(
      () => sql`alter table crm.users drop constraint users_email_key`,
      () =>
        sql`alter table crm.users add constraint users_email_key unique (email)`,
      "same-table-count missing unique must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql`alter table crm.workspaces drop constraint workspaces_created_by_user_id_fkey`,
      () =>
        sql`alter table crm.workspaces add constraint workspaces_created_by_user_id_fkey foreign key (created_by_user_id) references crm.users(id) on delete set null`,
      "same-table-count missing foreign key must be rejected",
    );
    await expectStructuralDrift(
      () => sql`drop index crm.users_status_idx`,
      () => sql`create index users_status_idx on crm.users (status)`,
      "same-table-count missing index must be rejected",
    );
  },
});

globalThis.addEventListener("unload", () => {
  void sql.end({ timeout: 1 });
  void configured.close();
  void postconditionConnection.destroy();
});
