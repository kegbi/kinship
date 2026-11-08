import { sql as kyselySql } from "kysely";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { invitationAuditFrom } from "../../packages/backend/modules/workspaces/public.ts";
import {
  createWorkspaceInvitationCoordinator,
  type InvitationAudit,
  type WorkspaceInvitationRepository,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { databaseFromSession } from "../../packages/backend/platform/postgres/session.ts";
import {
  PostgresActiveWorkspaceResolver,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  AesGcmMfaSecretBox,
} from "../../packages/backend/modules/identity/adapters/crypto/totp.ts";
import {
  PostgresEmailVerification,
} from "../../packages/backend/modules/identity/adapters/postgres/email_verification.ts";
import {
  PostgresIdentityAuthentication,
} from "../../packages/backend/modules/identity/adapters/postgres/authentication.ts";
import {
  PostgresInvitationIdentity,
} from "../../packages/backend/modules/identity/adapters/postgres/invitation_identity.ts";
import {
  SecureTokenService,
  WebCryptoRandomSource,
} from "../../packages/backend/modules/identity/adapters/crypto/secure_tokens.ts";
import {
  PostgresAuditEventRecorder,
} from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresRegistrationTransaction,
  PostgresWorkspaceRegistration,
} from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import {
  PostgresWorkspaceInvitations,
} from "../../packages/backend/modules/workspaces/adapters/postgres/workspace_invitations.ts";
import {
  revokeInvitationsOfInviters,
} from "../../packages/backend/modules/workspaces/adapters/postgres/invitation_authority.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";
import {
  apiSupport,
  originHeaders,
  PASSWORD as password,
} from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 3, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

/**
 * Registers, verifies, and signs in, then dates the verification a day back:
 * only an address verified for a day may invite (SECA-03, AUD-M3).
 */
async function registerVerifySignIn(email: string, workspaceName: string) {
  const registered = await api.register(email, workspaceName);
  await sql`
    update crm.users set email_verified_at = now() - interval '25 hours'
    where email = ${email}
  `;
  return registered;
}

/** Admits every invitation, for the fixtures that compose their own. */
const unboundedMail = {
  reserve: () => Promise.resolve("admitted" as const),
};

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
    await resetDatabase(sql);
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
    const registrantCookie = registrationCookies.match(
      /kinship_registrant=[^;,]+/,
    )?.[0];
    assert(
      invitedRegistration.status === 202 && invitationCookie &&
        invitationPendingCookie && registrantCookie,
      "invitation-specific pending identity registration succeeds",
    );
    const [pendingShape] = await sql<
      {
        memberships: number;
        named: number;
        users: number;
        workspaces: number;
      }[]
    >`
      select
        (select count(*)::int from crm.users where email = ${newInviteeEmail}) users,
        (select count(*)::int from crm.users where email = ${newInviteeEmail}
          and pending_workspace_name is not null) named,
        (select count(*)::int from crm.workspaces w join crm.users u
          on u.id = w.created_by_user_id where u.email = ${newInviteeEmail}) workspaces,
        (select count(*)::int from crm.workspace_members wm join crm.users u
          on u.id = wm.user_id where u.email = ${newInviteeEmail}) memberships
    `;
    assert(
      pendingShape?.users === 1 && pendingShape.workspaces === 0 &&
        pendingShape.memberships === 0 && pendingShape.named === 0,
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
          cookie: `${invitationPendingCookie}; ${registrantCookie}`,
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
          revoke: (command) => baseRepository.revoke(command),
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
        const baseAudit = invitationAuditFrom(new PostgresAuditEventRecorder());
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
            claimRegistrationAddress: () =>
              Promise.reject(new Error("not used by acceptance fixture")),
            consumeVerifiedIdentityEntry: () => Promise.resolve(undefined),
            createExistingAccountRecovery: () => Promise.resolve(undefined),
            discardPendingUser: () =>
              Promise.reject(new Error("not used by acceptance fixture")),
            createPendingUser: () =>
              Promise.reject(new Error("not used by acceptance fixture")),
            createRetryVerificationToken: () => Promise.resolve(undefined),
            findIdentityIdByEmail: (command) =>
              new PostgresInvitationIdentity().findIdentityIdByEmail(command),
            isAddressVerifiedBy: () => Promise.resolve(true),
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
          mailBudget: unboundedMail,
          pendingWorkspaces: new PostgresWorkspaceRegistration(),
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
    await resetDatabase(sql);
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
        new PostgresActiveWorkspaceResolver(),
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
    await resetDatabase(sql);
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
    const baseAudit = invitationAuditFrom(new PostgresAuditEventRecorder());
    const invitationIdentity = new PostgresInvitationIdentity();
    const tokens = new SecureTokenService(new WebCryptoRandomSource());
    const identityDependencies = {
      assertPendingUserPostconditions: () => Promise.resolve(),
      assertSessionPostcondition: () => Promise.resolve(),
      claimRegistrationAddress: () =>
        Promise.reject(new Error("not used by create/accept race")),
      consumeVerifiedIdentityEntry: () => Promise.resolve(undefined),
      createExistingAccountRecovery: () => Promise.resolve(undefined),
      discardPendingUser: () =>
        Promise.reject(new Error("not used by create/accept race")),
      createPendingUser: () =>
        Promise.reject(new Error("not used by create/accept race")),
      createRetryVerificationToken: () => Promise.resolve(undefined),
      findIdentityIdByEmail: (
        command: Parameters<
          PostgresInvitationIdentity["findIdentityIdByEmail"]
        >[0],
      ) => invitationIdentity.findIdentityIdByEmail(command),
      isAddressVerifiedBy: (
        command: Parameters<
          PostgresInvitationIdentity["isAddressVerifiedBy"]
        >[0],
      ) => invitationIdentity.isAddressVerifiedBy(command),
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
      mailBudget: unboundedMail,
      pendingWorkspaces: new PostgresWorkspaceRegistration(),
      repository: baseRepository,
      tokens,
      transaction: new PostgresRegistrationTransaction(acceptConnection.db),
    });
    const creationRepository: WorkspaceInvitationRepository = {
      accept: (command) => baseRepository.accept(command),
      revoke: (command) => baseRepository.revoke(command),
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
      mailBudget: unboundedMail,
      pendingWorkspaces: new PostgresWorkspaceRegistration(),
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
    await resetDatabase(sql);
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
    await resetDatabase(sql);
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
        headers: {
          ...originHeaders,
          cookie: `${pendingCookie}; ${
            (registration.headers.get("set-cookie") ?? "").match(
              /kinship_registrant=[^;,]+/,
            )?.[0]
          }`,
        },
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
        new PostgresActiveWorkspaceResolver(),
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

/** Accepts `token` as the signed-in, verified identity behind `cookie`. */
async function acceptAs(cookie: string, token: string): Promise<Response> {
  return await configured.app.request(
    "http://localhost/api/v1/workspace-invitations/accept",
    {
      method: "POST",
      headers: { ...originHeaders, cookie },
      body: JSON.stringify({ token }),
    },
  );
}

/** Invites `email` as an admin of `workspaceId` and returns the mailed token. */
async function inviteAdmin(
  cookie: string,
  workspaceId: string,
  email: string,
): Promise<string> {
  const response = await configured.app.request(
    "http://localhost/api/v1/workspace-invitations",
    {
      method: "POST",
      headers: { ...originHeaders, cookie, "X-Workspace-Id": workspaceId },
      body: JSON.stringify({ email, role: "admin" }),
    },
  );
  assert(response.status === 201, `${email} invited as admin`);
  const token = mail.latestInvitationToken(email);
  assert(token, `${email} invitation delivered`);
  return token;
}

const invitationStatus = async (workspaceId: string, email: string) =>
  (await sql<{ status: string }[]>`
    select status from crm.workspace_invitations
    where workspace_id = ${workspaceId}::uuid and email = ${email}
    order by created_at desc limit 1
  `)[0]?.status;

const membershipsIn = async (workspaceId: string, email: string) =>
  (await sql<{ count: number }[]>`
    select count(*)::int count from crm.workspace_members wm
    join crm.users u on u.id = wm.user_id
    where wm.workspace_id = ${workspaceId}::uuid and u.email = ${email}
  `)[0]?.count;

Deno.test({
  name:
    "SECT-04 an invitation from an admin the owner suspended cannot be accepted",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await registerVerifySignIn(
      "sect04-owner@example.test",
      "Authority circle",
    );
    const admin = await registerVerifySignIn(
      "sect04-admin@example.test",
      "Admin home",
    );
    const adminMemberId = await addMembership(
      sql,
      admin.userId,
      owner.workspaceId,
      "admin",
    );
    const inviteeEmail = "sect04-invitee@example.test";
    const invitee = await registerVerifySignIn(inviteeEmail, "Invitee home");
    const token = await inviteAdmin(
      admin.cookie,
      owner.workspaceId,
      inviteeEmail,
    );
    const suspended = await api.request(
      owner,
      `/api/v1/settings/members/${adminMemberId}`,
      "PATCH",
      { role: "admin", status: "suspended" },
    );
    assert(suspended.status === 200, "owner suspends the admin");
    assert(
      await invitationStatus(owner.workspaceId, inviteeEmail) === "revoked",
      "the suspension revoked the admin's pending invitation with it",
    );
    const accepted = await acceptAs(invitee.cookie, token);
    assert(
      accepted.status === 410,
      `acceptance after the inviter's suspension is refused: ${accepted.status}`,
    );
    assert(
      await membershipsIn(owner.workspaceId, inviteeEmail) === 0,
      "no seat is created for the invitee",
    );
  },
});

Deno.test({
  name:
    "SECT-04 demotion, leaving, and account deletion revoke only the inviter's pending invitations",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await registerVerifySignIn(
      "sect04-cascade-owner@example.test",
      "Cascade circle",
    );
    const ownerInvitee = "sect04-owner-invitee@example.test";
    await inviteAdmin(owner.cookie, owner.workspaceId, ownerInvitee);
    const admins = [];
    for (const name of ["demoted", "leaver", "deleted"] as const) {
      const admin = await registerVerifySignIn(
        `sect04-${name}@example.test`,
        `${name} home`,
      );
      const memberId = await addMembership(
        sql,
        admin.userId,
        owner.workspaceId,
        "admin",
      );
      const email = `sect04-${name}-invitee@example.test`;
      await inviteAdmin(admin.cookie, owner.workspaceId, email);
      admins.push({ ...admin, email, memberId });
    }
    const [demoted, leaver, deleted] = admins;
    assert(demoted && leaver && deleted, "three admins invited somebody");

    const promoted = await api.request(
      owner,
      `/api/v1/settings/members/${demoted.memberId}`,
      "PATCH",
      { role: "owner", status: "active" },
    );
    assert(promoted.status === 200, "promotion to owner succeeds");
    assert(
      await invitationStatus(owner.workspaceId, demoted.email) === "pending",
      "a change that keeps authority keeps the invitation",
    );
    const demotion = await api.request(
      owner,
      `/api/v1/settings/members/${demoted.memberId}`,
      "PATCH",
      { role: "member", status: "active" },
    );
    assert(demotion.status === 200, "owner demotes the admin to member");
    assert(
      await invitationStatus(owner.workspaceId, demoted.email) === "revoked",
      "demotion revokes the demoted inviter's invitation",
    );

    const left = await configured.app.request(
      "http://localhost/api/v1/settings/personal-lifecycle/leave",
      {
        method: "POST",
        headers: {
          ...originHeaders,
          cookie: leaver.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
        body: JSON.stringify({
          confirmation: "LEAVE Cascade circle",
          password,
        }),
      },
    );
    assert(left.status === 200, `the admin leaves: ${left.status}`);
    assert(
      await invitationStatus(owner.workspaceId, leaver.email) === "revoked",
      "leaving revokes the leaver's invitation",
    );

    // The deleting admin's home needs another owner, or deletion is refused.
    await addMembership(sql, owner.userId, deleted.workspaceId, "owner");
    const deletion = await configured.app.request(
      "http://localhost/api/v1/settings/personal-lifecycle",
      {
        method: "DELETE",
        headers: {
          ...originHeaders,
          cookie: deleted.cookie,
          "X-Workspace-Id": owner.workspaceId,
        },
        body: JSON.stringify({
          confirmation: "DELETE sect04-deleted@example.test",
          password,
        }),
      },
    );
    assert(deletion.status === 200, `the admin deletes: ${deletion.status}`);
    assert(
      await invitationStatus(owner.workspaceId, deleted.email) === "revoked",
      "account deletion revokes the deleted inviter's invitation",
    );

    assert(
      await invitationStatus(owner.workspaceId, ownerInvitee) === "pending",
      "the owner's own invitation is untouched by every other change",
    );
  },
});

Deno.test({
  name:
    "SECT-04 owners and admins see who invited whom and revoke a pending invitation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await registerVerifySignIn(
      "sect04-list-owner@example.test",
      "Listing circle",
    );
    const admin = await registerVerifySignIn(
      "sect04-list-admin@example.test",
      "Listing admin home",
    );
    await addMembership(sql, admin.userId, owner.workspaceId, "admin");
    const member = await registerVerifySignIn(
      "sect04-list-member@example.test",
      "Listing member home",
    );
    await addMembership(sql, member.userId, owner.workspaceId, "member");
    const foreign = await registerVerifySignIn(
      "sect04-list-foreign@example.test",
      "Foreign listing",
    );
    const inviteeEmail = "sect04-list-invitee@example.test";
    const invitee = await registerVerifySignIn(inviteeEmail, "Invitee home");
    const token = await inviteAdmin(
      admin.cookie,
      owner.workspaceId,
      inviteeEmail,
    );
    const foreignEmail = "sect04-foreign-invitee@example.test";
    await inviteAdmin(foreign.cookie, foreign.workspaceId, foreignEmail);

    const listed = await api.request(owner, "/api/v1/workspace-members");
    const body = await listed.json() as {
      readonly invitations: readonly {
        readonly email: string;
        readonly id: string;
        readonly invitedBy: { readonly id: string; readonly name: string };
        readonly role: string;
      }[];
      readonly members: readonly {
        readonly email: string;
        readonly id: string;
      }[];
    };
    const pending = body.invitations.find((item) =>
      item.email === inviteeEmail
    );
    const adminMember = body.members.find((item) =>
      item.email === "sect04-list-admin@example.test"
    );
    assert(
      listed.status === 200 && pending && adminMember &&
        pending.role === "admin" && pending.invitedBy.id === adminMember.id &&
        pending.invitedBy.name === "Test Member",
      `the list names the inviting admin and the role: ${
        JSON.stringify(pending)
      }`,
    );
    const [foreignInvitation] = await sql<{ id: string }[]>`
      select id::text from crm.workspace_invitations where email = ${foreignEmail}
    `;
    assert(foreignInvitation, "a foreign workspace has its own invitation");

    const revoke = (session: { readonly cookie: string }, id: string) =>
      api.request(
        { cookie: session.cookie, workspaceId: owner.workspaceId },
        `/api/v1/workspace-invitations/${id}`,
        "DELETE",
      );
    const byMember = await revoke(member, pending.id);
    assert(
      byMember.status === 403,
      `a member cannot revoke: ${byMember.status}`,
    );
    const crossed = await revoke(owner, foreignInvitation.id);
    assert(
      crossed.status === 404,
      `another workspace's invitation is not found: ${crossed.status}`,
    );
    const unknown = await revoke(owner, crypto.randomUUID());
    assert(unknown.status === 404, "an unknown invitation is not found");
    const foreignHeader = await api.request(
      { cookie: owner.cookie, workspaceId: foreign.workspaceId },
      `/api/v1/workspace-invitations/${foreignInvitation.id}`,
      "DELETE",
    );
    assert(
      foreignHeader.status === 401,
      "naming a foreign workspace is not authorization",
    );
    assert(
      await invitationStatus(foreign.workspaceId, foreignEmail) === "pending",
      "no refusal touched the foreign invitation",
    );

    const revoked = await revoke(owner, pending.id);
    assert(
      revoked.status === 200 &&
        (await revoked.json() as { status: string }).status === "revoked",
      "the owner revokes the admin's invitation",
    );
    const again = await revoke(admin, pending.id);
    assert(again.status === 404, "a revoked invitation is no longer pending");
    const relisted = await api.request(owner, "/api/v1/workspace-members");
    const relistedBody = await relisted.json() as {
      readonly invitations: readonly { readonly id: string }[];
    };
    assert(
      !relistedBody.invitations.some((item) => item.id === pending.id),
      "a revoked invitation leaves the pending list",
    );
    const accepted = await acceptAs(invitee.cookie, token);
    assert(accepted.status === 410, "a revoked link cannot be accepted");
    assert(
      await membershipsIn(owner.workspaceId, inviteeEmail) === 0,
      "revocation creates no seat",
    );

    const adminRevokes = "sect04-admin-revokes@example.test";
    await inviteAdmin(owner.cookie, owner.workspaceId, adminRevokes);
    const [ownerInvitation] = await sql<{ id: string }[]>`
      select id::text from crm.workspace_invitations
      where email = ${adminRevokes} and status = 'pending'
    `;
    assert(ownerInvitation, "the owner invited somebody else");
    assert(
      (await revoke(admin, ownerInvitation.id)).status === 200,
      "an admin may revoke any pending invitation of the workspace",
    );
  },
});

Deno.test({
  name:
    "SECT-04 acceptance re-checks the inviter's authority when nothing revoked the invitation",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const owner = await registerVerifySignIn(
      "sect04-backstop-owner@example.test",
      "Backstop circle",
    );
    const admin = await registerVerifySignIn(
      "sect04-backstop-admin@example.test",
      "Backstop admin home",
    );
    const adminMemberId = await addMembership(
      sql,
      admin.userId,
      owner.workspaceId,
      "admin",
    );
    const inviteeEmail = "sect04-backstop-invitee@example.test";
    await registerVerifySignIn(inviteeEmail, "Invitee home");
    const token = await inviteAdmin(
      admin.cookie,
      owner.workspaceId,
      inviteeEmail,
    );
    // An invitation that predates the cascade: its inviter lost authority
    // without its pending invitations being touched.
    await sql`
      update crm.workspace_members set role = 'member'
      where id = ${adminMemberId}::uuid
    `;
    assert(
      await invitationStatus(owner.workspaceId, inviteeEmail) === "pending",
      "the fixture left the invitation pending",
    );
    const inspected = await configured.app.request(
      "http://localhost/api/v1/workspace-invitations/inspect",
      {
        method: "POST",
        headers: originHeaders,
        body: JSON.stringify({ token }),
      },
    );
    assert(inspected.status === 410, "inspection reports it revoked");
    assert(
      await invitationStatus(owner.workspaceId, inviteeEmail) === "revoked",
      "inspection spends the unauthorised invitation",
    );

    const secondEmail = "sect04-backstop-second@example.test";
    const second = await registerVerifySignIn(secondEmail, "Second home");
    await sql`
      update crm.workspace_members set role = 'admin'
      where id = ${adminMemberId}::uuid
    `;
    const secondToken = await inviteAdmin(
      admin.cookie,
      owner.workspaceId,
      secondEmail,
    );
    await sql`
      update crm.workspace_members set status = 'suspended'
      where id = ${adminMemberId}::uuid
    `;
    // The repository's own acceptance refuses too, not only the inspection
    // every coordinator path runs before it.
    const connection = connectDatabase(databaseUrl);
    try {
      const tokenHash = await new SecureTokenService(
        new WebCryptoRandomSource(),
      ).hash(secondToken);
      const direct = await new PostgresRegistrationTransaction(connection.db)
        .run((transaction) =>
          new PostgresWorkspaceInvitations().accept({
            memberId: crypto.randomUUID(),
            now: new Date(),
            tokenHash,
            transaction,
            userId: second.userId,
          })
        );
      assert(
        direct.status === "revoked",
        `the repository refuses: ${direct.status}`,
      );
    } finally {
      await connection.destroy();
    }
    const accepted = await acceptAs(second.cookie, secondToken);
    assert(
      accepted.status === 410,
      `acceptance refuses a suspended inviter: ${accepted.status}`,
    );
    assert(
      await membershipsIn(owner.workspaceId, secondEmail) === 0 &&
        await membershipsIn(owner.workspaceId, inviteeEmail) === 0,
      "neither invitee gets a seat",
    );
  },
});

/**
 * An admin's pending invitation and the two hands that can reach it at once:
 * the invitee accepting it and the owner removing the admin's authority.
 */
async function lockOrderFixture(prefix: string) {
  const owner = await registerVerifySignIn(
    `${prefix}-owner@example.test`,
    `${prefix} circle`,
  );
  const admin = await registerVerifySignIn(
    `${prefix}-admin@example.test`,
    `${prefix} admin home`,
  );
  const adminMemberId = await addMembership(
    sql,
    admin.userId,
    owner.workspaceId,
    "admin",
  );
  const inviteeEmail = `${prefix}-invitee@example.test`;
  const invitee = await registerVerifySignIn(inviteeEmail, "Invitee home");
  const token = await inviteAdmin(
    admin.cookie,
    owner.workspaceId,
    inviteeEmail,
  );
  const tokenHash = await new SecureTokenService(new WebCryptoRandomSource())
    .hash(token);
  return { adminMemberId, inviteeEmail, invitee, owner, tokenHash };
}

/** A latch one transaction opens and another awaits. */
function latch(): {
  readonly open: () => void;
  readonly opened: Promise<void>;
} {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/** Names the transaction so the test can see when it waits on a lock. */
async function nameTransaction(
  transaction: { readonly opaque: unknown },
  name: string,
): Promise<void> {
  await kyselySql`select set_config('application_name', ${name}, true)`
    .execute(databaseFromSession(transaction));
}

async function waitsOnLock(name: string): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [activity] = await sql<{ waiting: boolean }[]>`
      select coalesce(bool_or(wait_event_type = 'Lock'), false) as waiting
      from pg_stat_activity where application_name = ${name}
    `;
    if (activity?.waiting === true) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

/** Fails with the SQLSTATE when either side was chosen as a deadlock victim. */
function settled<Value>(
  outcome: PromiseSettledResult<Value>,
  side: string,
): Value {
  if (outcome.status === "fulfilled") return outcome.value;
  const reason = outcome.reason as { code?: string; message?: string };
  throw new Error(
    `${side} failed (${reason.code ?? "no SQLSTATE"}): ${reason.message}`,
  );
}

/**
 * Accepts as the coordinator does — inspection, then acceptance, in one
 * transaction — optionally holding the transaction open after acceptance.
 */
const acceptInTransaction = (
  connection: ReturnType<typeof connectDatabase>,
  command: {
    readonly name: string;
    readonly tokenHash: string;
    readonly userId: string;
  },
  afterAccept?: () => Promise<void>,
) =>
  new PostgresRegistrationTransaction(connection.db).run(
    async (transaction) => {
      await nameTransaction(transaction, command.name);
      const repository = new PostgresWorkspaceInvitations();
      const now = new Date();
      const inspected = await repository.inspect({
        now,
        tokenHash: command.tokenHash,
        transaction,
      });
      if (inspected.status !== "pending") return inspected;
      const accepted = await repository.accept({
        memberId: crypto.randomUUID(),
        now,
        tokenHash: command.tokenHash,
        transaction,
        userId: command.userId,
      });
      await afterAccept?.();
      return accepted;
    },
  );

/**
 * The statements updateMember runs to suspend a member, then `between`, in a
 * transaction scoped to the member's workspace as the API's is (ADR 0008).
 */
const suspendInviter = (
  connection: ReturnType<typeof connectDatabase>,
  member: { readonly id: string; readonly workspaceId: string },
  between: () => Promise<void>,
  name?: string,
) =>
  new PostgresRegistrationTransaction(connection.db).run(
    async (transaction) => {
      const memberId = member.id;
      if (name) await nameTransaction(transaction, name);
      const database = databaseFromSession(transaction);
      await kyselySql`
        select id from crm.workspace_members
        where id = ${memberId}::uuid for update
      `.execute(database);
      await kyselySql`
        update crm.workspace_members set status = 'suspended',
          updated_at = now()
        where id = ${memberId}::uuid
      `.execute(database);
      await between();
      await revokeInvitationsOfInviters(transaction, { memberId });
    },
    { workspaceId: member.workspaceId },
  );

Deno.test({
  name:
    "SECT-04 acceptance waiting on the inviter's suspension reads the invitation revoked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const fixture = await lockOrderFixture("sect04-suspend-first");
    const suspender = connectDatabase(databaseUrl);
    const acceptor = connectDatabase(databaseUrl);
    const suspendedUncommitted = latch();
    const revokeNow = latch();
    try {
      const suspension = suspendInviter(
        suspender,
        { id: fixture.adminMemberId, workspaceId: fixture.owner.workspaceId },
        async () => {
          suspendedUncommitted.open();
          await revokeNow.opened;
        },
      );
      await suspendedUncommitted.opened;
      const acceptance = acceptInTransaction(acceptor, {
        name: "sect04-accept-waits",
        tokenHash: fixture.tokenHash,
        userId: fixture.invitee.userId,
      });
      const waiting = await waitsOnLock("sect04-accept-waits");
      revokeNow.open();
      const [suspended, accepted] = await Promise.allSettled([
        suspension,
        acceptance,
      ]);
      settled(suspended, "suspension");
      const answer = settled(accepted, "acceptance");
      assert(waiting, "acceptance waits behind the suspension");
      assert(
        answer.status === "revoked",
        `acceptance reads the invitation revoked: ${answer.status}`,
      );
      assert(
        await membershipsIn(fixture.owner.workspaceId, fixture.inviteeEmail) ===
            0 &&
          await invitationStatus(
              fixture.owner.workspaceId,
              fixture.inviteeEmail,
            ) === "revoked",
        "no seat, and the invitation stays revoked",
      );
    } finally {
      revokeNow.open();
      await suspender.destroy();
      await acceptor.destroy();
    }
  },
});

Deno.test({
  name:
    "SECT-04 a suspension waiting on an acceptance commits after it without a deadlock",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const fixture = await lockOrderFixture("sect04-accept-first");
    const suspender = connectDatabase(databaseUrl);
    const acceptor = connectDatabase(databaseUrl);
    const acceptedUncommitted = latch();
    const commitAcceptance = latch();
    try {
      const acceptance = acceptInTransaction(
        acceptor,
        {
          name: "sect04-accept-first",
          tokenHash: fixture.tokenHash,
          userId: fixture.invitee.userId,
        },
        async () => {
          acceptedUncommitted.open();
          await commitAcceptance.opened;
        },
      );
      await acceptedUncommitted.opened;
      const suspension = suspendInviter(
        suspender,
        { id: fixture.adminMemberId, workspaceId: fixture.owner.workspaceId },
        () => Promise.resolve(),
        "sect04-suspension-waits",
      );
      const waiting = await waitsOnLock("sect04-suspension-waits");
      commitAcceptance.open();
      const [accepted, suspended] = await Promise.allSettled([
        acceptance,
        suspension,
      ]);
      settled(suspended, "suspension");
      const answer = settled(accepted, "acceptance");
      assert(waiting, "the suspension waits behind the acceptance");
      assert(
        answer.status === "accepted",
        `the earlier acceptance commits: ${answer.status}`,
      );
      const [admin] = await sql<{ status: string }[]>`
        select status from crm.workspace_members
        where id = ${fixture.adminMemberId}::uuid
      `;
      assert(
        admin?.status === "suspended" &&
          await membershipsIn(
              fixture.owner.workspaceId,
              fixture.inviteeEmail,
            ) ===
            1 &&
          await invitationStatus(
              fixture.owner.workspaceId,
              fixture.inviteeEmail,
            ) === "accepted",
        "one seat, the accepted invitation untouched, the inviter suspended",
      );
    } finally {
      commitAcceptance.open();
      await suspender.destroy();
      await acceptor.destroy();
    }
  },
});

Deno.test({
  name:
    "SECT-04 acceptance waiting on an inviter leaving the workspace reads the invitation revoked",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
    const fixture = await lockOrderFixture("sect04-leave-first");
    const leaver = connectDatabase(databaseUrl);
    const acceptor = connectDatabase(databaseUrl);
    const workspaceLocked = latch();
    const leaveNow = latch();
    try {
      // Leaving locks the workspace (the personal-lifecycle inspection), then
      // writes the membership, then revokes.
      const leaving = new PostgresRegistrationTransaction(leaver.db).run(
        async (transaction) => {
          const database = databaseFromSession(transaction);
          await kyselySql`
            select id from crm.workspaces
            where id = ${fixture.owner.workspaceId}::uuid for update
          `.execute(database);
          workspaceLocked.open();
          await leaveNow.opened;
          await kyselySql`
            update crm.workspace_members set status = 'left', left_at = now(),
              updated_at = now()
            where id = ${fixture.adminMemberId}::uuid
          `.execute(database);
          await revokeInvitationsOfInviters(transaction, {
            memberId: fixture.adminMemberId,
          });
        },
        { workspaceId: fixture.owner.workspaceId },
      );
      await workspaceLocked.opened;
      const acceptance = acceptInTransaction(acceptor, {
        name: "sect04-accept-waits-leave",
        tokenHash: fixture.tokenHash,
        userId: fixture.invitee.userId,
      });
      const waiting = await waitsOnLock("sect04-accept-waits-leave");
      leaveNow.open();
      const [left, accepted] = await Promise.allSettled([leaving, acceptance]);
      settled(left, "leaving");
      const answer = settled(accepted, "acceptance");
      assert(waiting, "acceptance waits behind the leaving inviter");
      assert(
        answer.status === "revoked",
        `acceptance reads the invitation revoked: ${answer.status}`,
      );
      assert(
        await membershipsIn(fixture.owner.workspaceId, fixture.inviteeEmail) ===
          0,
        "no seat is created",
      );
    } finally {
      leaveNow.open();
      await leaver.destroy();
      await acceptor.destroy();
    }
  },
});

Deno.test({
  name: "AUTH-002 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await Promise.all([
      sql.end({ timeout: 1 }),
      configured.close(),
    ]);
  },
});
