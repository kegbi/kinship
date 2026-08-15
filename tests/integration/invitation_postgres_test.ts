import postgres from "postgres";
import { sql as kyselySql } from "kysely";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  AesGcmMfaSecretBox,
  PostgresEmailVerification,
  PostgresIdentityAuthentication,
  PostgresInvitationIdentity,
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/public.ts";
import { PostgresInvitationAudit } from "../../packages/backend/modules/governance/public.ts";
import {
  createWorkspaceInvitationCoordinator,
  type InvitationAudit,
  PostgresRegistrationTransaction,
  PostgresWorkspaceInvitations,
  type WorkspaceInvitationRepository,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { databaseFromSession } from "../../packages/backend/platform/postgres/session.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests");
}
const sql = postgres(databaseUrl, {
  max: 3,
  onnotice: () => undefined,
  prepare: false,
});
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const password = "correct horse battery staple";
const originHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
};

async function registerVerifySignIn(
  email: string,
  workspaceName: string,
): Promise<{ readonly cookie: string; readonly workspaceId: string }> {
  const registration = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        firstName: "Test",
        lastName: "Member",
        password,
        workspaceName,
      }),
    },
  );
  assert(registration.status === 202, `registration failed for ${email}`);
  const verificationToken = mail.latestToken(email);
  assert(verificationToken, "verification delivery captured");
  const verification = await configured.app.request(
    "http://localhost/api/v1/email-verifications",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: verificationToken }),
    },
  );
  assert(verification.status === 200, `verification failed for ${email}`);
  const signIn = await configured.app.request(
    "http://localhost/api/v1/sessions",
    {
      method: "POST",
      headers: originHeaders,
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await signIn.json() as { workspace: { id: string } };
  const setCookie = signIn.headers.get("set-cookie");
  assert(signIn.status === 200 && setCookie, `sign-in failed for ${email}`);
  return { cookie: setCookie.split(";")[0]!, workspaceId: body.workspace.id };
}

async function invite(
  cookie: string,
  email: string,
  workspaceId?: string,
): Promise<Response> {
  return await configured.app.request(
    "http://localhost/api/v1/workspace-invitations",
    {
      method: "POST",
      headers: {
        ...originHeaders,
        cookie,
        ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      },
      body: JSON.stringify({ email, role: "member" }),
    },
  );
}

Deno.test({
  name:
    "AUTH-002 real PostgreSQL invitation is tenant-safe, single-use, and atomically audited",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    const ownerEmail = "invite-owner@example.test";
    const inviteeEmail = "invitee@example.test";
    const foreignEmail = "foreign@example.test";
    const owner = await registerVerifySignIn(ownerEmail, "Owner circle");
    const invitee = await registerVerifySignIn(inviteeEmail, "Invitee circle");
    const foreign = await registerVerifySignIn(foreignEmail, "Foreign circle");

    const newInviteeEmail = "new-invitee@example.test";
    assert(
      (await invite(owner.cookie, newInviteeEmail)).status === 201,
      "new identity invitation created",
    );
    const newInvitationToken = mail.latestInvitationToken(newInviteeEmail);
    assert(newInvitationToken, "new identity invitation delivered");
    const invitedRegistration = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/register",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({
          email: newInviteeEmail,
          firstName: "New",
          lastName: "Invitee",
          password,
          token: newInvitationToken,
        }),
      },
    );
    const registrationCookies = invitedRegistration.headers.get("set-cookie") ??
      "";
    const invitationCookie = registrationCookies.match(
      /kinship_invitation=[^;,]+/,
    )?.[0];
    const invitationPendingCookie = registrationCookies.match(
      /kinship_invitation_pending=[^;,]+/,
    )?.[0];
    assert(
      invitedRegistration.status === 202 && invitationCookie &&
        invitationPendingCookie,
      "invitation-specific pending identity registration succeeds",
    );
    const [pendingShape] = await sql<
      { memberships: number; users: number; workspaces: number }[]
    >`
      select
        (select count(*)::int from crm.users where email = ${newInviteeEmail}) users,
        (select count(*)::int from crm.workspaces w join crm.users u
          on u.id = w.created_by_user_id where u.email = ${newInviteeEmail}) workspaces,
        (select count(*)::int from crm.workspace_members wm join crm.users u
          on u.id = wm.user_id where u.email = ${newInviteeEmail}) memberships
    `;
    assert(
      pendingShape?.users === 1 && pendingShape.workspaces === 0 &&
        pendingShape.memberships === 0,
      "pending invited identity creates no unrelated workspace or membership",
    );
    const newVerificationToken = mail.latestToken(newInviteeEmail);
    assert(newVerificationToken, "invited identity verification delivered");
    const verified = await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: invitationPendingCookie,
        },
        body: JSON.stringify({ token: newVerificationToken }),
      },
    );
    const verifiedBody = await verified.json() as { readonly next: string };
    const entryCookie = (verified.headers.get("set-cookie") ?? "").match(
      /kinship_entry=[^;,]+/,
    )?.[0];
    assert(
      verified.status === 200 && entryCookie &&
        verifiedBody.next === "/invite/continue",
      "verification preserves only the scoped invitation continuation",
    );
    const acceptedNewIdentity = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: `${invitationCookie}; ${entryCookie}`,
        },
        body: "{}",
      },
    );
    assert(
      acceptedNewIdentity.status === 200 &&
        (acceptedNewIdentity.headers.get("set-cookie") ?? "").includes(
          "kinship_session=",
        ),
      "verified authority atomically becomes an authenticated invited member",
    );
    const [acceptedShape] = await sql<
      {
        audits: number;
        memberships: number;
        preferences: number;
        sessions: number;
      }[]
    >`
      select
        (select count(*)::int from crm.workspace_members wm join crm.users u
          on u.id = wm.user_id where wm.workspace_id = ${owner.workspaceId}::uuid
          and u.email = ${newInviteeEmail} and wm.status = 'active') memberships,
        (select count(*)::int from crm.member_preferences mp
          join crm.workspace_members wm on wm.id = mp.member_id join crm.users u
          on u.id = wm.user_id where wm.workspace_id = ${owner.workspaceId}::uuid
          and u.email = ${newInviteeEmail}) preferences,
        (select count(*)::int from crm.audit_events ae
          join crm.workspace_members wm on wm.id = ae.subject_id join crm.users u
          on u.id = wm.user_id where ae.workspace_id = ${owner.workspaceId}::uuid
          and ae.action = 'workspace.member-joined'
          and u.email = ${newInviteeEmail}) audits,
        (select count(*)::int from crm.user_sessions s join crm.users u
          on u.id = s.user_id where u.email = ${newInviteeEmail}
          and s.revoked_at is null) sessions
    `;
    assert(
      acceptedShape?.memberships === 1 && acceptedShape.preferences === 1 &&
        acceptedShape.audits === 1 && acceptedShape.sessions === 1,
      "membership, defaults, audit, and authenticated session are exact",
    );
    const newReplay = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: `${invitationCookie}; ${entryCookie}`,
        },
        body: "{}",
      },
    );
    assert(newReplay.status === 410, "new identity handoff cannot replay");

    for (const status of ["suspended", "left"] as const) {
      const existingEmail = `existing-${status}@example.test`;
      await registerVerifySignIn(existingEmail, `Existing ${status}`);
      await sql`
        insert into crm.workspace_members (
          workspace_id, user_id, role, status, joined_at, left_at
        )
        select ${owner.workspaceId}::uuid, id, 'member', ${status}, now(),
          ${status === "left" ? new Date() : null}
        from crm.users where email = ${existingEmail}
      `;
      const rejected = await invite(owner.cookie, existingEmail);
      assert(
        rejected.status === 409,
        `${status} membership blocks a contradictory invitation`,
      );
      const [existingState] = await sql<{ invitations: number }[]>`
        select count(*)::int invitations from crm.workspace_invitations
        where workspace_id = ${owner.workspaceId}::uuid
          and email = ${existingEmail}
      `;
      assert(
        existingState?.invitations === 0,
        `${status} membership rejection does not persist an invitation`,
      );
    }

    for (const status of ["suspended", "left"] as const) {
      const legacyEmail = `legacy-${status}@example.test`;
      const legacy = await registerVerifySignIn(
        legacyEmail,
        `Legacy ${status}`,
      );
      assert(
        (await invite(owner.cookie, legacyEmail)).status === 201,
        `${status} legacy invitation fixture created`,
      );
      const legacyToken = mail.latestInvitationToken(legacyEmail);
      assert(legacyToken, `${status} legacy invitation delivered`);
      await sql`
        insert into crm.workspace_members (
          workspace_id, user_id, role, status, joined_at, left_at
        )
        select ${owner.workspaceId}::uuid, id, 'member', ${status}, now(),
          ${status === "left" ? new Date() : null}
        from crm.users where email = ${legacyEmail}
      `;
      const defended = await configured.app.request(
        "http://localhost/api/v1/workspace-invitations/accept",
        {
          method: "POST",
          headers: { ...originHeaders, cookie: legacy.cookie },
          body: JSON.stringify({ token: legacyToken }),
        },
      );
      assert(
        defended.status === 409,
        `${status} legacy/racy membership is not silently reactivated`,
      );
      const [legacyState] = await sql<
        { audits: number; invitations: number; memberships: number }[]
      >`
        select
          (select count(*)::int from crm.workspace_invitations
            where workspace_id = ${owner.workspaceId}::uuid
              and email = ${legacyEmail} and status = 'pending'
              and accepted_at is null) invitations,
          (select count(*)::int from crm.workspace_members wm
            join crm.users u on u.id = wm.user_id
            where wm.workspace_id = ${owner.workspaceId}::uuid
              and u.email = ${legacyEmail} and wm.status = ${status}) memberships,
          (select count(*)::int from crm.audit_events ae
            join crm.workspace_members wm on wm.id = ae.subject_id
            join crm.users u on u.id = wm.user_id
            where ae.workspace_id = ${owner.workspaceId}::uuid
              and ae.action = 'workspace.member-joined'
              and u.email = ${legacyEmail}) audits
      `;
      assert(
        legacyState?.invitations === 1 && legacyState.memberships === 1 &&
          legacyState.audits === 0,
        `${status} legacy/racy defense preserves invitation and membership state`,
      );
    }

    const crossed = await invite(
      owner.cookie,
      "crossed@example.test",
      foreign.workspaceId,
    );
    assert(
      crossed.status === 401,
      "foreign workspace header cannot authorize creation",
    );
    const created = await invite(owner.cookie, inviteeEmail);
    const createdBody = await created.text();
    assert(
      created.status === 201 && !createdBody.includes("token"),
      "owner creates narrow invitation response",
    );
    const token = mail.latestInvitationToken(inviteeEmail);
    assert(token, "raw invitation token is delivered only to mail");
    const [stored] = await sql<{ token_hash: string }[]>`
      select token_hash from crm.workspace_invitations
      where workspace_id = ${owner.workspaceId}::uuid and email = ${inviteeEmail}
    `;
    assert(
      stored?.token_hash && stored.token_hash !== token,
      "database stores only token hash",
    );

    const pending = await configured.app.request(
      "http://localhost/api/v1/workspace-members",
      {
        headers: { cookie: owner.cookie, "X-Workspace-Id": owner.workspaceId },
      },
    );
    const pendingBody = await pending.json() as {
      readonly invitations: readonly {
        readonly createdAt: string;
        readonly email: string;
        readonly expiresAt: string;
      }[];
    };
    assert(
      pending.status === 200 &&
        pendingBody.invitations.some((entry) => entry.email === inviteeEmail),
      "pending list is visible in intended workspace",
    );
    const pendingInvitation = pendingBody.invitations.find((entry) =>
      entry.email === inviteeEmail
    );
    const strictDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert(
      pendingInvitation && strictDateTime.test(pendingInvitation.createdAt) &&
        strictDateTime.test(pendingInvitation.expiresAt),
      "invitation timestamps are strict ISO/RFC3339 date-time values",
    );
    const isolatedList = await configured.app.request(
      "http://localhost/api/v1/workspace-members",
      {
        headers: {
          cookie: foreign.cookie,
          "X-Workspace-Id": foreign.workspaceId,
        },
      },
    );
    assert(
      !(await isolatedList.text()).includes(inviteeEmail),
      "another workspace cannot list the invitation",
    );

    const wrong = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: { ...originHeaders, cookie: owner.cookie },
        body: JSON.stringify({ token }),
      },
    );
    assert(
      wrong.status === 403,
      "wrong authenticated user is denied without consumption",
    );

    const acceptRequest = () =>
      configured.app.request(
        "http://localhost/api/v1/workspace-invitations/accept",
        {
          method: "POST",
          headers: { ...originHeaders, cookie: invitee.cookie },
          body: JSON.stringify({ token }),
        },
      );
    const concurrent = await Promise.all([acceptRequest(), acceptRequest()]);
    assert(
      concurrent.map((response) => response.status).sort().join(",") ===
        "200,410",
      "race creates one membership and consumes once",
    );
    const [shape] = await sql<
      {
        audits: number;
        invitations: number;
        members: number;
        preferences: number;
      }[]
    >`
      select
        (select count(*)::int from crm.workspace_members wm join crm.users u on u.id = wm.user_id where wm.workspace_id = ${owner.workspaceId}::uuid and u.email = ${inviteeEmail} and wm.status = 'active') members,
        (select count(*)::int from crm.workspace_invitations where workspace_id = ${owner.workspaceId}::uuid and email = ${inviteeEmail} and status = 'accepted' and accepted_at is not null) invitations,
        (select count(*)::int from crm.member_preferences mp join crm.workspace_members wm on wm.id = mp.member_id join crm.users u on u.id = wm.user_id where wm.workspace_id = ${owner.workspaceId}::uuid and u.email = ${inviteeEmail}) preferences,
        (select count(*)::int from crm.audit_events ae
          join crm.workspace_members wm on wm.id = ae.subject_id
          join crm.users u on u.id = wm.user_id
          where ae.workspace_id = ${owner.workspaceId}::uuid
            and ae.action = 'workspace.member-joined'
            and u.email = ${inviteeEmail}) audits
    `;
    assert(
      shape?.members === 1 && shape.invitations === 1 &&
        shape.preferences === 1 && shape.audits === 1,
      "membership, consumption, defaults, and truthful audit are atomic",
    );
    const replay = await acceptRequest();
    assert(replay.status === 410, "replay remains safely rejected");
    const duplicate = await invite(owner.cookie, inviteeEmail);
    assert(duplicate.status === 409, "already-member creation is rejected");
    const memberInvite = await invite(
      invitee.cookie,
      "denied@example.test",
      owner.workspaceId,
    );
    assert(
      memberInvite.status === 403,
      "active member cannot invite in joined workspace",
    );

    const expiringEmail = "expired@example.test";
    assert(
      (await invite(owner.cookie, expiringEmail)).status === 201,
      "expiry fixture created",
    );
    const expiredToken = mail.latestInvitationToken(expiringEmail);
    assert(expiredToken, "expiry fixture delivered");
    await sql`update crm.workspace_invitations set expires_at = now() - interval '1 second' where email = ${expiringEmail}`;
    const expired = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/inspect",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ token: expiredToken }),
      },
    );
    assert(
      expired.status === 410 &&
        (await expired.text()).includes("invitation_expired"),
      "expired token is terminal",
    );

    const revokedEmail = "revoked@example.test";
    assert(
      (await invite(owner.cookie, revokedEmail)).status === 201,
      "revocation fixture created",
    );
    const revokedToken = mail.latestInvitationToken(revokedEmail);
    assert(revokedToken, "revocation fixture delivered");
    await sql`update crm.workspace_invitations set status = 'revoked' where email = ${revokedEmail}`;
    const revoked = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/inspect",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ token: revokedToken }),
      },
    );
    assert(
      revoked.status === 410 &&
        (await revoked.text()).includes("invitation_revoked"),
      "revoked token is terminal",
    );

    const postconditionConnection = connectDatabase(databaseUrl);
    try {
      for (
        const perturbation of [
          "membership",
          "preferences",
          "invitation",
          "audit",
        ] as const
      ) {
        const email = `postcondition-${perturbation}@example.test`;
        await registerVerifySignIn(email, `Postcondition ${perturbation}`);
        assert(
          (await invite(owner.cookie, email)).status === 201,
          `${perturbation} postcondition fixture created`,
        );
        const acceptanceToken = mail.latestInvitationToken(email);
        assert(acceptanceToken, `${perturbation} fixture token delivered`);
        const [identity] = await sql<{ userId: string }[]>`
          select id::text as "userId" from crm.users where email = ${email}
        `;
        assert(identity?.userId, `${perturbation} fixture identity exists`);
        const baseRepository = new PostgresWorkspaceInvitations();
        const repository: WorkspaceInvitationRepository = {
          create: (command) => baseRepository.create(command),
          list: (command) => baseRepository.list(command),
          inspect: (command) => baseRepository.inspect(command),
          async accept(command) {
            const result = await baseRepository.accept(command);
            if (result.status !== "accepted" || perturbation === "audit") {
              return result;
            }
            const database = databaseFromSession(command.transaction);
            if (perturbation === "membership") {
              await kyselySql`
                update crm.workspace_members set status = 'suspended'
                where id = ${result.memberId}::uuid
              `.execute(database);
            } else if (perturbation === "preferences") {
              await kyselySql`
                update crm.member_preferences set locale = 'fr'
                where member_id = ${result.memberId}::uuid
              `.execute(database);
            } else {
              await kyselySql`
                update crm.workspace_invitations
                set status = 'revoked', accepted_at = null
                where id = ${result.invitationId}::uuid
              `.execute(database);
            }
            return result;
          },
          assertAcceptancePostcondition: (command) =>
            baseRepository.assertAcceptancePostcondition(command),
        };
        const baseAudit = new PostgresInvitationAudit();
        const audit: InvitationAudit = {
          async recordMemberJoined(command) {
            await baseAudit.recordMemberJoined(command);
            if (perturbation === "audit") {
              await kyselySql`
                update crm.audit_events set action = 'perturbed'
                where workspace_id = ${command.workspaceId}::uuid
                  and subject_id = ${command.memberId}::uuid
              `.execute(databaseFromSession(command.transaction));
            }
          },
          assertMemberJoinedPostcondition: (command) =>
            baseAudit.assertMemberJoinedPostcondition(command),
        };
        const coordinator = createWorkspaceInvitationCoordinator({
          audit,
          clock: { now: () => new Date() },
          ids: { create: () => crypto.randomUUID() },
          identity: {
            assertPendingUserPostconditions: () => Promise.resolve(),
            assertSessionPostcondition: () => Promise.resolve(),
            consumeVerifiedIdentityEntry: () => Promise.resolve(undefined),
            createPendingUser: () =>
              Promise.reject(new Error("not used by acceptance fixture")),
            createRetryVerificationToken: () => Promise.resolve(undefined),
            findIdentityIdByEmail: (command) =>
              new PostgresInvitationIdentity().findIdentityIdByEmail(command),
            isVerifiedInvitationIdentity: (command) =>
              new PostgresInvitationIdentity()
                .isVerifiedInvitationIdentity(command),
            issueSession: () =>
              Promise.reject(new Error("not used by acceptance fixture")),
            listIdentityDisplaySummaries: (command) =>
              new PostgresInvitationIdentity()
                .listIdentityDisplaySummaries(command),
          },
          mail: {
            sendInvitation: () => Promise.resolve(),
            sendVerification: () => Promise.resolve(),
          },
          repository,
          tokens: new SecureTokenService(new WebCryptoRandomSource()),
          transaction: new PostgresRegistrationTransaction(
            postconditionConnection.db,
          ),
        });
        let rolledBack = false;
        try {
          await coordinator.accept({
            token: acceptanceToken,
            userId: identity.userId,
          });
        } catch {
          rolledBack = true;
        }
        assert(
          rolledBack,
          `${perturbation} postcondition perturbation rejects acceptance`,
        );
        const [rolledBackState] = await sql<
          {
            audits: number;
            invitations: number;
            members: number;
            preferences: number;
          }[]
        >`
          select
            (select count(*)::int from crm.workspace_members
              where workspace_id = ${owner.workspaceId}::uuid
                and user_id = ${identity.userId}::uuid) members,
            (select count(*)::int from crm.member_preferences mp
              join crm.workspace_members wm on wm.id = mp.member_id
              where wm.workspace_id = ${owner.workspaceId}::uuid
                and wm.user_id = ${identity.userId}::uuid) preferences,
            (select count(*)::int from crm.workspace_invitations
              where workspace_id = ${owner.workspaceId}::uuid
                and email = ${email} and status = 'pending'
                and accepted_at is null) invitations,
            (select count(*)::int from crm.audit_events ae
              join crm.workspace_members wm on wm.id = ae.subject_id
              where ae.workspace_id = ${owner.workspaceId}::uuid
                and wm.user_id = ${identity.userId}::uuid
                and ae.action in ('workspace.member-joined', 'perturbed')) audits
        `;
        assert(
          rolledBackState?.members === 0 &&
            rolledBackState.preferences === 0 &&
            rolledBackState.invitations === 1 &&
            rolledBackState.audits === 0,
          `${perturbation} failure rolls back every required effect`,
        );
      }
    } finally {
      await postconditionConnection.destroy();
    }
  },
});

Deno.test({
  name:
    "AUTH-002 exact credential version rejects a same-millisecond reset before entry issuance",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    const email = "entry-reset-race@example.test";
    await registerVerifySignIn(email, "Entry reset race");
    await sql`
      update crm.users set
        password_changed_at = '2026-08-15 12:00:00.123001+00'::timestamptz,
        updated_at = now()
      where email = ${email}
    `;
    const connection = connectDatabase(databaseUrl);
    const random = new WebCryptoRandomSource();
    const tokens = new SecureTokenService(random);
    const clock = { now: () => new Date("2026-08-15T12:01:00.000Z") };
    const ids = { create: () => crypto.randomUUID() };
    try {
      const authentication = new PostgresIdentityAuthentication(
        connection.db,
        {
          hash: () => Promise.resolve("unused"),
          needsUpgrade: () => false,
          verify: () => Promise.resolve(true),
        },
        tokens,
        new AesGcmMfaSecretBox({
          activeKeyId: "test",
          keys: new Map([["test", new Uint8Array(32).fill(0x4b)]]),
        }, random),
        clock,
        ids,
      );
      const primary = await authentication.authenticatePassword({
        email,
        ipAddress: "127.0.0.88",
        password,
      });
      assert(primary.status === "verified", "password challenge succeeds");
      await sql`
        update crm.users set
          password_hash = 'reset-hash',
          password_changed_at = '2026-08-15 12:00:00.123999+00'::timestamptz,
          updated_at = now()
        where email = ${email}
      `;
      const verification = new PostgresEmailVerification(
        connection.db,
        tokens,
        clock,
        ids,
      );
      let rejected = false;
      try {
        await new PostgresRegistrationTransaction(connection.db).run(
          (transaction) =>
            verification.issueVerifiedIdentityEntry({
              credentialVersion: primary.entryCredentialVersion,
              expectedEmail: email,
              transaction,
              userId: primary.userId,
            }),
        );
      } catch {
        rejected = true;
      }
      assert(
        rejected,
        "same-millisecond password reset invalidates pre-reset entry authority",
      );
      const [entries] = await sql<{ count: number }[]>`
        select count(*)::int count from crm.user_sessions s
        join crm.users u on u.id = s.user_id
        where u.email = ${email} and s.revoked_at is null
          and s.expires_at = ${new Date("2026-08-15T12:11:00.000Z")}
      `;
      assert(entries?.count === 0, "rejected race leaves no entry row");
    } finally {
      await connection.destroy();
    }
  },
});

Deno.test({
  name:
    "AUTH-002 create waiting on acceptance cannot restore pending invitation authority",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    const owner = await registerVerifySignIn(
      "race-owner@example.test",
      "Race owner",
    );
    const email = "race-invitee@example.test";
    await registerVerifySignIn(email, "Race invitee");
    assert(
      (await invite(owner.cookie, email)).status === 201,
      "race invitation fixture created",
    );
    const invitationToken = mail.latestInvitationToken(email);
    assert(invitationToken, "race invitation token delivered");
    const [identity] = await sql<{ userId: string }[]>`
      select id::text as "userId" from crm.users where email = ${email}
    `;
    assert(identity?.userId, "race invitee identity exists");
    const [ownerActor] = await sql<
      { memberId: string; userId: string }[]
    >`
      select wm.id::text as "memberId", wm.user_id::text as "userId"
      from crm.workspace_members wm
      join crm.users u on u.id = wm.user_id
      where wm.workspace_id = ${owner.workspaceId}::uuid
        and u.email = 'race-owner@example.test'
    `;
    assert(ownerActor, "race owner actor exists");

    const acceptConnection = connectDatabase(databaseUrl);
    const createConnection = connectDatabase(databaseUrl);
    const baseRepository = new PostgresWorkspaceInvitations();
    const baseAudit = new PostgresInvitationAudit();
    const invitationIdentity = new PostgresInvitationIdentity();
    const tokens = new SecureTokenService(new WebCryptoRandomSource());
    const identityDependencies = {
      assertPendingUserPostconditions: () => Promise.resolve(),
      assertSessionPostcondition: () => Promise.resolve(),
      consumeVerifiedIdentityEntry: () => Promise.resolve(undefined),
      createPendingUser: () =>
        Promise.reject(new Error("not used by create/accept race")),
      createRetryVerificationToken: () => Promise.resolve(undefined),
      findIdentityIdByEmail: (
        command: Parameters<
          PostgresInvitationIdentity["findIdentityIdByEmail"]
        >[0],
      ) => invitationIdentity.findIdentityIdByEmail(command),
      isVerifiedInvitationIdentity: (
        command: Parameters<
          PostgresInvitationIdentity["isVerifiedInvitationIdentity"]
        >[0],
      ) => invitationIdentity.isVerifiedInvitationIdentity(command),
      issueSession: () =>
        Promise.reject(new Error("not used by create/accept race")),
      listIdentityDisplaySummaries: (
        command: Parameters<
          PostgresInvitationIdentity["listIdentityDisplaySummaries"]
        >[0],
      ) => invitationIdentity.listIdentityDisplaySummaries(command),
    };
    let pauseAcceptance!: () => void;
    const acceptancePaused = new Promise<void>((resolve) => {
      pauseAcceptance = resolve;
    });
    let releaseAcceptance!: () => void;
    const acceptanceRelease = new Promise<void>((resolve) => {
      releaseAcceptance = resolve;
    });
    let invitationDeliveries = 0;
    const acceptance = createWorkspaceInvitationCoordinator({
      audit: {
        async recordMemberJoined(command) {
          await baseAudit.recordMemberJoined(command);
          pauseAcceptance();
          await acceptanceRelease;
        },
        assertMemberJoinedPostcondition: (command) =>
          baseAudit.assertMemberJoinedPostcondition(command),
      },
      clock: { now: () => new Date() },
      ids: { create: () => crypto.randomUUID() },
      identity: identityDependencies,
      mail: {
        sendInvitation: () => Promise.resolve(),
        sendVerification: () => Promise.resolve(),
      },
      repository: baseRepository,
      tokens,
      transaction: new PostgresRegistrationTransaction(acceptConnection.db),
    });
    const creationRepository: WorkspaceInvitationRepository = {
      accept: (command) => baseRepository.accept(command),
      assertAcceptancePostcondition: (command) =>
        baseRepository.assertAcceptancePostcondition(command),
      async create(command) {
        await kyselySql`
          select set_config(
            'application_name',
            'auth002-create-accept-race',
            true
          )
        `.execute(databaseFromSession(command.transaction));
        return await baseRepository.create(command);
      },
      inspect: (command) => baseRepository.inspect(command),
      list: (command) => baseRepository.list(command),
    };
    const creation = createWorkspaceInvitationCoordinator({
      audit: baseAudit,
      clock: { now: () => new Date() },
      ids: { create: () => crypto.randomUUID() },
      identity: identityDependencies,
      mail: {
        sendInvitation: () => {
          invitationDeliveries += 1;
          return Promise.resolve();
        },
        sendVerification: () => Promise.resolve(),
      },
      repository: creationRepository,
      tokens,
      transaction: new PostgresRegistrationTransaction(createConnection.db),
    });
    let acceptancePromise: Promise<unknown> | undefined;
    let creationPromise: Promise<unknown> | undefined;
    try {
      acceptancePromise = acceptance.accept({
        token: invitationToken,
        userId: identity.userId,
      });
      await acceptancePaused;
      creationPromise = creation.create({
        actor: {
          memberId: ownerActor.memberId,
          role: "owner",
          userId: ownerActor.userId,
          workspaceId: owner.workspaceId,
        },
        email,
        role: "member",
        workspaceName: "Race owner",
      });
      const deadline = Date.now() + 5_000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        const [activity] = await sql<{ waiting: boolean }[]>`
          select coalesce(wait_event_type = 'Lock', false) as waiting
          from pg_stat_activity
          where application_name = 'auth002-create-accept-race'
        `;
        waiting = activity?.waiting === true;
        if (!waiting) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      assert(waiting, "competing creation waits on the acceptance row lock");
      releaseAcceptance();
      const accepted = await acceptancePromise;
      const created = await creationPromise;
      assert(
        (accepted as { status?: string }).status === "accepted" &&
          created === "already-member",
        "committed acceptance wins over stale invitation replacement",
      );
      const [shape] = await sql<{ members: number; pending: number }[]>`
        select
          (select count(*)::int from crm.workspace_members wm
            join crm.users u on u.id = wm.user_id
            where wm.workspace_id = ${owner.workspaceId}::uuid
              and u.email = ${email} and wm.status = 'active') members,
          (select count(*)::int from crm.workspace_invitations
            where workspace_id = ${owner.workspaceId}::uuid
              and email = ${email} and status = 'pending') pending
      `;
      assert(
        shape?.members === 1 && shape.pending === 0 &&
          invitationDeliveries === 0,
        "race leaves one membership, no pending authority, and no delivery",
      );
    } finally {
      releaseAcceptance();
      await Promise.allSettled(
        [acceptancePromise, creationPromise].filter(
          (promise): promise is Promise<unknown> => promise !== undefined,
        ),
      );
      await acceptConnection.destroy();
      await createConnection.destroy();
    }
  },
});

Deno.test({
  name:
    "AUTH-002 real PostgreSQL invited registration recovers from post-commit mail failure",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    let failVerification = true;
    const deliveryMail = new CapturedVerificationMail();
    const failingMail = {
      sendInvitation: (
        message: Parameters<CapturedVerificationMail["sendInvitation"]>[0],
      ) => deliveryMail.sendInvitation(message),
      sendPasswordReset: (
        message: Parameters<CapturedVerificationMail["sendPasswordReset"]>[0],
      ) => deliveryMail.sendPasswordReset(message),
      sendVerification: (
        message: Parameters<CapturedVerificationMail["sendVerification"]>[0],
      ) =>
        failVerification
          ? Promise.reject(new Error("provider unavailable"))
          : deliveryMail.sendVerification(message),
    };
    const deliveryApp = createConfiguredApiApp(
      databaseUrl,
      failingMail,
      browserSecurityPolicy("test", "http://localhost"),
    );
    try {
      const owner = await registerVerifySignIn(
        "delivery-owner@example.test",
        "Delivery owner",
      );
      const email = "delivery-invitee@example.test";
      assert(
        (await invite(owner.cookie, email)).status === 201,
        "invitation created",
      );
      const invitationToken = mail.latestInvitationToken(email);
      assert(invitationToken, "invitation delivered");
      const registration = await deliveryApp.app.request(
        "http://localhost/api/v1/workspace-invitations/register",
        {
          method: "POST",
          headers: originHeaders,
          body: JSON.stringify({
            email,
            firstName: "Delivery",
            lastName: "Invitee",
            password,
            token: invitationToken,
          }),
        },
      );
      const cookies = registration.headers.get("set-cookie") ?? "";
      const invitationCookie = cookies.match(/kinship_invitation=[^;,]+/)?.[0];
      assert(
        registration.status === 503 && invitationCookie,
        "post-commit provider failure is truthful and retains scoped continuation",
      );
      const [shape] = await sql<{ memberships: number; users: number }[]>`
        select
          (select count(*)::int from crm.users where email = ${email}) users,
          (select count(*)::int from crm.workspace_members wm join crm.users u
            on u.id = wm.user_id where u.email = ${email}) memberships
      `;
      assert(
        shape?.users === 1 && shape.memberships === 0,
        "identity committed once without membership",
      );
      failVerification = false;
      const retry = await deliveryApp.app.request(
        "http://localhost/api/v1/workspace-invitations/verification-delivery",
        {
          method: "POST",
          headers: { ...originHeaders, cookie: invitationCookie },
          body: "{}",
        },
      );
      assert(
        retry.status === 202 && deliveryMail.latestToken(email),
        "scoped retry rotates and delivers without duplicate identity",
      );
    } finally {
      await deliveryApp.close();
    }
  },
});

Deno.test({
  name:
    "AUTH-002 real PostgreSQL replacement invitation re-enters a verified zero-membership identity",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    const owner = await registerVerifySignIn(
      "replacement-owner@example.test",
      "Replacement owner",
    );
    const email = "replacement-invitee@example.test";
    assert(
      (await invite(owner.cookie, email)).status === 201,
      "initial invitation created",
    );
    const originalToken = mail.latestInvitationToken(email);
    assert(originalToken, "initial invitation delivered");
    const registration = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/register",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({
          email,
          firstName: "Replacement",
          lastName: "Invitee",
          password,
          token: originalToken,
        }),
      },
    );
    const pendingCookie = (registration.headers.get("set-cookie") ?? "").match(
      /kinship_invitation_pending=[^;,]+/,
    )?.[0];
    const verificationToken = mail.latestToken(email);
    assert(
      registration.status === 202 && pendingCookie && verificationToken,
      "identity awaits verification",
    );
    const verification = await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: { ...originHeaders, cookie: pendingCookie },
        body: JSON.stringify({ token: verificationToken }),
      },
    );
    assert(
      verification.status === 200,
      "identity verified before invitation replacement",
    );
    assert(
      (await invite(owner.cookie, email)).status === 201,
      "replacement invitation created through owner API",
    );
    const replacementToken = mail.latestInvitationToken(email);
    assert(
      replacementToken && replacementToken !== originalToken,
      "replacement has fresh authority",
    );
    const original = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/inspect",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ token: originalToken }),
      },
    );
    assert(
      original.status === 410,
      "replacement creation revokes original invitation",
    );
    const authenticated = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/authenticate",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ email, password, token: replacementToken }),
      },
    );
    const authCookies = authenticated.headers.get("set-cookie") ?? "";
    const entryCookie = authCookies.match(/kinship_entry=[^;,]+/)?.[0];
    const invitationCookie = authCookies.match(/kinship_invitation=[^;,]+/)
      ?.[0];
    const authenticatedBody = await authenticated.clone().text();
    assert(
      authenticated.status === 200 && entryCookie && invitationCookie,
      `verified credential yields only scoped one-use entry: ${authenticated.status} ${authenticatedBody} ${authCookies}`,
    );
    const entryToken = entryCookie.split("=", 2)[1];
    assert(entryToken, "entry cookie contains bearer authority");
    const tokenService = new SecureTokenService(new WebCryptoRandomSource());
    const [entryStorage] = await sql<{ session_hash: string }[]>`
      select session_hash from crm.user_sessions s
      join crm.users u on u.id = s.user_id
      where u.email = ${email} and s.session_hash = ${await tokenService.hash(
      entryToken,
    )}
    `;
    assert(
      entryStorage?.session_hash === await tokenService.hash(entryToken) &&
        entryStorage.session_hash !== await tokenService.hash(
            `authenticated-session:${entryToken}`,
          ),
      "verified entry uses the direct one-use hash domain, not the authenticated-session domain",
    );
    const normalSignIn = await configured.app.request(
      "http://localhost/api/v1/sessions",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ email, password }),
      },
    );
    assert(
      normalSignIn.status === 403,
      "normal sign-in remains membership protected",
    );

    const wrongEmail = "replacement-wrong@example.test";
    assert(
      (await invite(owner.cookie, wrongEmail)).status === 201,
      "wrong-email invitation created",
    );
    const wrongInvitationToken = mail.latestInvitationToken(wrongEmail);
    assert(wrongInvitationToken, "wrong-email invitation delivered");
    const wrongEmailAttempt = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie:
            `kinship_entry=${entryToken}; kinship_invitation=${wrongInvitationToken}`,
        },
        body: "{}",
      },
    );
    assert(
      wrongEmailAttempt.status === 403,
      "entry is bound to the pending invitation email",
    );

    const normalToken = await tokenService.create();
    const [invitee] = await sql<{ id: string }[]>`
      select id::text from crm.users where email = ${email}
    `;
    assert(invitee, "replacement invitee exists");
    await sql`
      insert into crm.user_sessions (
        id, user_id, session_hash, purpose, created_at, last_seen_at, expires_at
      ) values (
        gen_random_uuid(), ${invitee.id}::uuid,
        ${await tokenService.hash(`authenticated-session:${normalToken.raw}`)},
        'authenticated', now(), now(), now() + interval '10 minutes'
      )
    `;
    const normalTokenAttempt = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie:
            `kinship_entry=${normalToken.raw}; kinship_invitation=${replacementToken}`,
        },
        body: "{}",
      },
    );
    assert(
      normalTokenAttempt.status === 403,
      "normal authenticated-session token cannot be consumed as identity entry",
    );
    const accepted = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: `${entryCookie}; ${invitationCookie}`,
        },
        body: "{}",
      },
    );
    assert(
      accepted.status === 200,
      "replacement invitation accepts exactly once",
    );
    const replay = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/accept",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: `${entryCookie}; ${invitationCookie}`,
        },
        body: "{}",
      },
    );
    assert(
      replay.status === 410,
      "entry and replacement invitation cannot replay",
    );
    const replayConnection = connectDatabase(databaseUrl);
    try {
      const verification = new PostgresEmailVerification(
        replayConnection.db,
        tokenService,
        { now: () => new Date() },
        { create: () => crypto.randomUUID() },
      );
      const replayedEntry = await new PostgresRegistrationTransaction(
        replayConnection.db,
      ).run((transaction) =>
        verification.consumeVerifiedIdentityEntry({
          expectedEmail: email,
          rawToken: entryToken,
          transaction,
        })
      );
      assert(
        replayedEntry === undefined,
        "consumed entry authority cannot replay",
      );
    } finally {
      await replayConnection.destroy();
    }
  },
});

globalThis.addEventListener("unload", () => {
  void sql.end({ timeout: 1 });
  void configured.close();
});
