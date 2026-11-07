import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { registrationAuditFrom } from "../../packages/backend/modules/workspaces/public.ts";
import {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { applyCanonicalSchema } from "../../tools/migrations/baseline.ts";
import {
  PostgresIdentityRegistration,
} from "../../packages/backend/modules/identity/adapters/postgres/identity_repository.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresRegistrationTransaction,
  PostgresWorkspaceRegistration,
} from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import { apiSupport, originHeaders } from "../support/api.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { prepare: false });
const capturedMail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  capturedMail,
  browserSecurityPolicy("test", "http://localhost"),
);
const postconditionConnection = connectDatabase(databaseUrl);

const api = apiSupport(configured.app, capturedMail, sql);

/** The registering browser's verifier cookie, as a request `cookie` value. */
function registrantOf(response: Response): string {
  const pair = response.headers.getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .find((value) => value.startsWith("kinship_registrant="));
  assert(pair, "registration sets the registrant verifier cookie");
  return pair;
}

function register(email: string): Promise<Response> {
  return api.submitRegistration(email, "Ada's circle", {
    firstName: "Ada",
    lastName: "Lovelace",
  });
}

Deno.test({
  name:
    "real PostgreSQL registration, verification, replay, duplicate race, and legacy non-activation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const response = await register("Owner@Example.test");
    assert(
      response.status === 202,
      `expected registration 202, got ${response.status}`,
    );
    const registrant = registrantOf(response);
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
      relationship_types: number;
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
        (select count(*)::int from crm.relationship_types) relationship_types,
        (select count(*)::int from crm.audit_events where action = 'workspace.created') audits,
        (select count(*)::int from crm.email_verification_tokens where used_at is null and token_hash not like 'registrant:%') tokens
    `;
    assert(
      shape?.users === 1 && shape.workspaces === 1 && shape.members === 1,
      "one pending owner workspace must exist",
    );
    assert(
      shape.preferences === 1 && shape.settings === 1 && shape.audits === 1 &&
        shape.tokens === 1 && shape.relationship_types ===
          DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length,
      "required defaults, audit, and token must be atomic",
    );
    const provisioned = await sql<{
      can_delete: boolean;
      forward_label: string;
      is_archived: boolean;
      is_system: boolean;
      reverse_label: string;
      sort_order: number;
    }[]>`
      select forward_label, reverse_label, sort_order, is_system, can_delete,
        is_archived
      from crm.relationship_types order by sort_order, id
    `;
    assert(
      provisioned.every((actual, index) => {
        const expected = DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types[index];
        return expected && actual.forward_label === expected.forwardLabel &&
          actual.reverse_label === expected.reverseLabel &&
          actual.sort_order === expected.sortOrder && actual.is_system &&
          !actual.can_delete && !actual.is_archived;
      }),
      "fresh workspace receives the exact versioned relationship vocabulary",
    );
    const [ownerWorkspace] = await sql<{
      user_id: string;
      workspace_id: string;
    }[]>`
      select created_by_user_id::text user_id, id::text workspace_id
      from crm.workspaces
    `;
    assert(ownerWorkspace, "registered workspace link exists");
    const registrationTransaction = new PostgresRegistrationTransaction(
      postconditionConnection.db,
    );
    const registrationWorkspace = new PostgresWorkspaceRegistration();
    await registrationTransaction.run(async (transaction) => {
      await registrationWorkspace.provisionDefaultRelationshipTypes({
        transaction,
        types: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
        version: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.version,
        workspaceId: ownerWorkspace.workspace_id,
      });
      await registrationWorkspace.provisionDefaultRelationshipTypes({
        transaction,
        types: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
        version: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.version,
        workspaceId: ownerWorkspace.workspace_id,
      });
    });
    const [replayedDefaults] = await sql<{ count: number }[]>`
      select count(*)::int count from crm.relationship_types
      where workspace_id = ${ownerWorkspace.workspace_id}::uuid
    `;
    assert(
      replayedDefaults?.count ===
        DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length,
      "default vocabulary replay is idempotent",
    );
    for (const failure of ["settings", "types", "postcondition"] as const) {
      const failedWorkspaceId = crypto.randomUUID();
      let rejected = false;
      try {
        await registrationTransaction.run(async (transaction) => {
          await registrationWorkspace.createWorkspace({
            createdByUserId: ownerWorkspace.user_id,
            name: `Rollback ${failure}`,
            transaction,
            workspaceId: failedWorkspaceId,
          });
          if (failure === "settings") {
            await registrationWorkspace.createWorkspaceSettings({
              transaction,
              workspaceId: failedWorkspaceId,
            });
            await registrationWorkspace.createWorkspaceSettings({
              transaction,
              workspaceId: failedWorkspaceId,
            });
          } else {
            await registrationWorkspace.provisionDefaultRelationshipTypes({
              transaction,
              types: failure === "types"
                ? [{
                  forwardLabel: null as unknown as string,
                  reverseLabel: "invalid",
                  sortOrder: 0,
                }]
                : DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
              version: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.version,
              workspaceId: failedWorkspaceId,
            });
            if (failure === "postcondition") {
              await registrationWorkspace.assertFirstWorkspacePostconditions({
                joinedAt: new Date(0),
                memberId: crypto.randomUUID(),
                name: "wrong",
                relationshipTypes: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
                transaction,
                userId: ownerWorkspace.user_id,
                workspaceId: failedWorkspaceId,
              });
            }
          }
        });
      } catch {
        rejected = true;
      }
      const [partial] = await sql<{ count: number }[]>`
        select
          (select count(*)::int from crm.workspaces where id = ${failedWorkspaceId}::uuid) +
          (select count(*)::int from crm.workspace_settings where workspace_id = ${failedWorkspaceId}::uuid) +
          (select count(*)::int from crm.relationship_types where workspace_id = ${failedWorkspaceId}::uuid) count
      `;
      assert(
        rejected && partial?.count === 0,
        `${failure} failure rolls back workspace and all defaults`,
      );
    }

    const token = capturedMail.latestToken("owner@example.test");
    assert(token, "injected mail fake must receive verification");
    const stored = await sql<
      { token_hash: string }[]
    >`select token_hash from crm.email_verification_tokens where token_hash not like 'registrant:%'`;
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
        headers: originHeaders,
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
        and token_hash not like 'registrant:%'
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
        headers: originHeaders,
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
          headers: { ...originHeaders, cookie: registrant },
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
        headers: originHeaders,
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
        headers: originHeaders,
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
      duplicateResponses.every((item) => item.status === 202),
      "a registered address answers like a fresh one (SECA-02)",
    );
    assert(
      capturedMail.accountExistsTokens("owner@example.test").length === 2,
      "each attempt tells the owner instead of the caller",
    );
    const [userCount] = await sql<
      { count: number }[]
    >`select count(*)::int as count from crm.users`;
    assert(userCount?.count === 1, "duplicate race must not add rows");

    assert(
      (await register("second-tenant@example.test")).status === 202,
      "second tenant registration succeeds",
    );
    const tenantDefaults = await sql<{
      count: number;
      workspace_id: string;
    }[]>`
      select workspace_id::text, count(*)::int count
      from crm.relationship_types group by workspace_id order by workspace_id
    `;
    assert(
      tenantDefaults.length === 2 &&
        tenantDefaults.every((row) =>
          row.count === DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types.length
        ),
      "each workspace owns one isolated copy of the exact defaults",
    );

    await resetDatabase(sql);
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
        headers: originHeaders,
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

    await resetDatabase(sql);
    const legacyId = crypto.randomUUID();
    await sql`
      insert into crm.users (id, email, password_hash, first_name, status, email_verified_at)
      values (${legacyId}::uuid, 'legacy@example.test', '$2y$10$legacy-looking-material', 'Legacy', 'active', null)
    `;
    const legacyResponse = await register("legacy@example.test");
    assert(
      legacyResponse.status === 202,
      "an imported identity answers like any address but is not claimed",
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
        headers: originHeaders,
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

    await resetDatabase(sql);
    const racingEmail = "resend-verify-race@example.test";
    const racingRegistration = await register(racingEmail);
    assert(racingRegistration.status === 202, "race fixture exists");
    const racingRegistrant = registrantOf(racingRegistration);
    const racingToken = capturedMail.latestToken(racingEmail);
    assert(racingToken, "race fixture token exists");
    const [raceRetry, raceVerify] = await Promise.all([
      configured.app.request(
        "http://localhost/api/v1/email-verification-deliveries",
        {
          method: "POST",
          headers: originHeaders,
          body: JSON.stringify({ email: racingEmail }),
        },
      ),
      configured.app.request(
        "http://localhost/api/v1/email-verifications",
        {
          method: "POST",
          headers: { ...originHeaders, cookie: racingRegistrant },
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

    await resetDatabase(sql);
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
          headers: originHeaders,
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
            headers: originHeaders,
            body: JSON.stringify({ email: "provider-failure@example.test" }),
          },
        );
      }
      const [failedDeliveryState] = await sql<
        { pending: number; total: number }[]
      >`
        select count(*) filter (where used_at is null)::int pending,
          count(*)::int total
        from crm.email_verification_tokens where token_hash not like 'registrant:%'
      `;
      assert(
        failedDeliveryState?.pending === 2 && failedDeliveryState.total === 2,
        "provider failures retain both usable links and persisted cooldown caps work",
      );
    } finally {
      await failingMailApp.close();
    }

    await resetDatabase(sql);
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
        and t.token_hash not like 'registrant:%'
      join crm.workspace_members wm on wm.user_id = u.id
      join crm.workspaces w on w.id = wm.workspace_id
    `;
    assert(links, "postcondition fixture links exist");
    const transaction = new PostgresRegistrationTransaction(
      postconditionConnection.db,
    );
    const identity = new PostgresIdentityRegistration(
      new SecureTokenService(new WebCryptoRandomSource()),
    );
    const workspace = new PostgresWorkspaceRegistration();
    const audit = registrationAuditFrom(new PostgresAuditEventRecorder());
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
              relationshipTypes: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
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

    const v1Sql = await Deno.readTextFile(
      "personal-crm-schema/v1/personal_crm_rewrite_schema_v3.sql",
    );
    const v2Sql = await Deno.readTextFile(
      "personal-crm-schema/v2/personal_crm_schema_v2.sql",
    );
    const migrationV1ToV2 = await Deno.readTextFile(
      "personal-crm-schema/v2/migrations/0002_add_authentication_subject_digest.sql",
    );
    const v3Sql = await Deno.readTextFile(
      "personal-crm-schema/v3/personal_crm_schema_v3.sql",
    );
    const migrationV2ToV3 = await Deno.readTextFile(
      "personal-crm-schema/v3/migrations/0003_add_user_session_purpose.sql",
    );
    const v4Sql = await Deno.readTextFile(
      "personal-crm-schema/v4/personal_crm_schema_v4.sql",
    );
    const migrationV3ToV4 = await Deno.readTextFile(
      "personal-crm-schema/v4/migrations/0004_seed_iso_4217_currencies.sql",
    );
    const v5Sql = await Deno.readTextFile(
      "personal-crm-schema/v5/personal_crm_schema_v5.sql",
    );
    const migrationV4ToV5 = await Deno.readTextFile(
      "personal-crm-schema/v5/migrations/0005_add_person_date_year_approximation.sql",
    );
    const v6Sql = await Deno.readTextFile(
      "personal-crm-schema/v6/personal_crm_schema_v6.sql",
    );
    const migrationV5ToV6 = await Deno.readTextFile(
      "personal-crm-schema/v6/migrations/0006_add_durable_reminder_delivery.sql",
    );
    const v7Sql = await Deno.readTextFile(
      "personal-crm-schema/v7/personal_crm_schema_v7.sql",
    );
    const migrationV6ToV7 = await Deno.readTextFile(
      "personal-crm-schema/v7/migrations/0007_add_workspace_deletion_records.sql",
    );
    const v8Sql = await Deno.readTextFile(
      "personal-crm-schema/v8/personal_crm_schema_v8.sql",
    );
    const migrationV7ToV8 = await Deno.readTextFile(
      "personal-crm-schema/v8/migrations/0008_add_member_reminder_delivery.sql",
    );
    const v9Sql = await Deno.readTextFile(
      "personal-crm-schema/v9/personal_crm_schema_v9.sql",
    );
    const migrationV8ToV9 = await Deno.readTextFile(
      "personal-crm-schema/v9/migrations/0009_add_search_indexes_and_duplicate_dismissals.sql",
    );
    const v10Sql = await Deno.readTextFile(
      "personal-crm-schema/v10/personal_crm_schema_v10.sql",
    );
    const migrationV9ToV10 = await Deno.readTextFile(
      "personal-crm-schema/v10/migrations/0010_add_recurring_debts.sql",
    );
    const artifacts = {
      v12Sql: await Deno.readTextFile(
        "personal-crm-schema/v12/personal_crm_schema_v12.sql",
      ),
      migrationV11ToV12: await Deno.readTextFile(
        "personal-crm-schema/v12/migrations/0012_reword_member_reminder_delivery_comment.sql",
      ),
      v11Sql: await Deno.readTextFile(
        "personal-crm-schema/v11/personal_crm_schema_v11.sql",
      ),
      migrationV10ToV11: await Deno.readTextFile(
        "personal-crm-schema/v11/migrations/0011_add_debt_settlements.sql",
      ),
      migrationV1ToV2,
      migrationV2ToV3,
      migrationV3ToV4,
      migrationV4ToV5,
      migrationV5ToV6,
      migrationV6ToV7,
      migrationV7ToV8,
      migrationV8ToV9,
      migrationV9ToV10,
      v1Sql,
      v2Sql,
      v3Sql,
      v4Sql,
      v5Sql,
      v6Sql,
      v7Sql,
      v8Sql,
      v9Sql,
      v10Sql,
    };
    assert(
      await applyCanonicalSchema(databaseUrl, artifacts) === "verify-v12",
      "unmodified canonical catalog verifies",
    );
    await sql`
      alter table crm.dav_address_book_subscriptions
      rename to dav_address_book_subscriptions_drift
    `;
    try {
      let driftRejected = false;
      try {
        await applyCanonicalSchema(databaseUrl, artifacts);
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
          await applyCanonicalSchema(databaseUrl, artifacts);
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
      () => sql`comment on schema crm is 'drifted namespace comment'`,
      () => sql`comment on schema crm is null`,
      "same-table-count namespace comment drift must be rejected",
    );
    await expectStructuralDrift(
      () => sql`comment on table crm.users is 'drifted table comment'`,
      () =>
        sql`comment on table crm.users is 'Global login identity. A user can belong to one or more workspaces through workspace_members.'`,
      "same-table-count table comment drift must be rejected",
    );
    await expectStructuralDrift(
      () => sql`comment on column crm.users.email is 'drifted column comment'`,
      () =>
        sql`comment on column crm.users.email is 'Primary login email address.'`,
      "same-table-count column comment drift must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create view crm.drift_view as select id from crm.users`,
      () => sql`drop view crm.drift_view`,
      "same-table-count added view must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql`create materialized view crm.drift_materialized as select count(*) total from crm.users`,
      () => sql`drop materialized view crm.drift_materialized`,
      "same-table-count added materialized view must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create sequence crm.drift_sequence`,
      () => sql`drop sequence crm.drift_sequence`,
      "same-table-count added sequence must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql.unsafe(`
          create foreign data wrapper kinship_drift_fdw;
          create server kinship_drift_server
            foreign data wrapper kinship_drift_fdw;
          create foreign table crm.drift_foreign (id integer)
            server kinship_drift_server;
        `),
      () =>
        sql.unsafe(`
          drop foreign table crm.drift_foreign;
          drop server kinship_drift_server;
          drop foreign data wrapper kinship_drift_fdw;
        `),
      "same-table-count added foreign table must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql`create table crm.drift_partitioned (id integer) partition by range (id)`,
      () => sql`drop table crm.drift_partitioned`,
      "added partitioned relation must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql.unsafe(
          "create function crm.drift_routine(integer) returns integer language sql immutable as 'select $1'",
        ),
      () => sql`drop function crm.drift_routine(integer)`,
      "same-table-count added routine must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create type crm.drift_enum as enum ('one', 'two')`,
      () => sql`drop type crm.drift_enum`,
      "same-table-count added enum must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create domain crm.drift_domain as text check (value <> '')`,
      () => sql`drop domain crm.drift_domain`,
      "same-table-count added domain must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create type crm.drift_range as range (subtype = integer)`,
      () => sql`drop type crm.drift_range`,
      "same-table-count added range must be rejected",
    );
    await expectStructuralDrift(
      () =>
        sql.unsafe(`
          create function public.kinship_drift_trigger()
            returns trigger language plpgsql
            as 'begin return new; end';
          create trigger kinship_drift_trigger
            before update on crm.users for each row
            execute function public.kinship_drift_trigger();
        `),
      () =>
        sql.unsafe(`
          drop trigger kinship_drift_trigger on crm.users;
          drop function public.kinship_drift_trigger();
        `),
      "same-table-count added noninternal trigger must be rejected",
    );
    await expectStructuralDrift(
      () => sql`create policy kinship_drift_policy on crm.users using (true)`,
      () => sql`drop policy kinship_drift_policy on crm.users`,
      "same-table-count added row-security policy must be rejected",
    );

    await sql`drop schema crm cascade`;
    await sql.unsafe(v1Sql);
    await sql`
      insert into crm.api_request_logs (method, path, client_ip, status_code)
      values ('GET', '/upgrade-fixture', '127.0.0.1'::inet, 200)
    `;
    assert(
      await applyCanonicalSchema(databaseUrl, artifacts) ===
        "upgrade-v1-to-v12",
      "exact repository v1 upgrades transactionally to v12",
    );
    const [upgraded] = await sql<{
      readonly digest_column: boolean;
      readonly fixture_count: number;
    }[]>`
      select
        exists(select 1 from information_schema.columns
          where table_schema = 'crm' and table_name = 'api_request_logs'
            and column_name = 'authentication_subject_digest') digest_column,
        (select count(*)::int from crm.api_request_logs
          where path = '/upgrade-fixture') fixture_count
    `;
    assert(
      upgraded?.digest_column === true && upgraded.fixture_count === 1,
      "v1 upgrade preserves rows and adds the v2 field",
    );
    assert(
      await applyCanonicalSchema(databaseUrl, artifacts) === "verify-v12",
      "upgraded repository v12 verifies idempotently",
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

Deno.test({
  name: "registration PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([
      sql.end({ timeout: 1 }),
      configured.close(),
      postconditionConnection.destroy(),
    ]);
  },
});
