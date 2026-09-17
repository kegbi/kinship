import {
  createMemberUiStateManagement as createRevocableMemberUiState,
  createRecentPeopleManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createMemberUiStateManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  PostgresMemberUiStateRepository,
  PostgresMemberUiStateRepository as RevocableMemberUiStateRepository,
} from "../../packages/backend/modules/workspaces/adapters/postgres/member_ui_state.ts";
import {
  PostgresRecentPeopleRepository,
} from "../../packages/backend/modules/workspaces/adapters/postgres/recent_people.ts";
import {
  PostgresActorRevalidation,
} from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  PostgresRegistrationTransaction,
} from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";

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

interface IdentityFixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<IdentityFixture> {
  const created = await configured.app.request(
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
  assert(created.status === 202, `registration failed for ${email}`);
  const token = mail.latestToken(email);
  assert(token, "verification mail captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      },
    )).status === 200,
    "identity verifies",
  );
  const signed = await signIn(email);
  const body = await signed.json() as {
    readonly member: { readonly id: string };
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  const [user] = await sql<{ readonly id: string }[]>`
    select id::text from crm.users where email = ${email}
  `;
  assert(signed.status === 200 && cookie && user, "identity signs in");
  return {
    cookie,
    memberId: body.member.id,
    userId: user.id,
    workspaceId: body.workspace.id,
  };
}

async function signIn(email: string, workspaceId?: string): Promise<Response> {
  return await configured.app.request("http://localhost/api/v1/sessions", {
    method: "POST",
    headers: originHeaders,
    body: JSON.stringify({
      email,
      password,
      ...(workspaceId ? { workspaceId } : {}),
    }),
  });
}

async function addMembership(
  identity: IdentityFixture,
  workspaceId: string,
  role: "admin" | "member",
): Promise<string> {
  const memberId = crypto.randomUUID();
  await sql`
    insert into crm.workspace_members (
      id, workspace_id, user_id, role, status, joined_at, created_at, updated_at
    ) values (
      ${memberId}, ${workspaceId}, ${identity.userId}, ${role}, 'active',
      now(), now(), now()
    )
  `;
  await sql`insert into crm.member_preferences (member_id) values (${memberId})`;
  return memberId;
}

async function settingsRequest(
  cookie: string,
  path: string,
  options: {
    readonly body?: unknown;
    readonly method?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<Response> {
  return await configured.app.request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...originHeaders,
      cookie,
      ...(options.workspaceId ? { "X-Workspace-Id": options.workspaceId } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

Deno.test({
  name:
    "AUTH-004 and WORKSPACE-001 real PostgreSQL settings remain atomic, member-owned, and tenant-safe",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql`truncate table crm.users, crm.workspaces, crm.audit_events restart identity cascade`;
    const [euro] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from crm.currencies
      where code = 'EUR' and name = 'Euro' and is_active = true
    `;
    assert(
      euro?.count === 1,
      "fresh production schema includes the supported EUR currency",
    );
    const owner = await register("settings-owner@example.test", "Owner circle");
    const adminIdentity = await register(
      "settings-admin@example.test",
      "Admin home",
    );
    const memberIdentity = await register(
      "settings-member@example.test",
      "Member home",
    );
    const foreign = await register(
      "settings-foreign@example.test",
      "Foreign circle",
    );
    await sql`
      update crm.member_preferences
      set ui_state = '{"dismissedWelcome":true}'::jsonb
      where member_id = ${owner.memberId}::uuid
    `;
    const savedUiState = await settingsRequest(
      owner.cookie,
      "/api/v1/member/ui-state",
      {
        body: { personWorkspaceView: "planning" },
        method: "PATCH",
      },
    );
    const readUiState = await settingsRequest(
      owner.cookie,
      "/api/v1/member/ui-state",
    );
    const readUiStateBody = await readUiState.json() as {
      readonly uiState?: { readonly personWorkspaceView?: string };
    };
    const [preservedUiState] = await sql<{
      readonly dismissedWelcome: boolean;
    }[]>`
      select (ui_state ->> 'dismissedWelcome')::boolean as "dismissedWelcome"
      from crm.member_preferences where member_id = ${owner.memberId}::uuid
    `;
    assert(
      savedUiState.status === 200 && readUiState.status === 200 &&
        readUiStateBody.uiState?.personWorkspaceView === "planning" &&
        preservedUiState?.dismissedWelcome === true,
      "member UI state round-trips without replacing sparse stored state",
    );

    const recentPersonId = crypto.randomUUID();
    await sql`
      insert into crm.people (id, workspace_id, given_name)
      values (${recentPersonId}, ${owner.workspaceId}, 'Recent UI state race')
    `;
    const [recentResponse, uiStateResponse] = await Promise.all([
      configured.app.request(
        `http://localhost/api/v1/people/${recentPersonId}/view`,
        {
          headers: {
            cookie: owner.cookie,
            origin: "http://localhost",
            "X-Workspace-Id": owner.workspaceId,
          },
          method: "POST",
        },
      ),
      settingsRequest(
        owner.cookie,
        "/api/v1/member/ui-state",
        {
          body: { personWorkspaceView: "things" },
          method: "PATCH",
        },
      ),
    ]);
    const [serializedState] = await sql<{
      readonly personWorkspaceView: string | null;
      readonly recentPersonId: string | null;
    }[]>`
      select ui_state ->> 'personWorkspaceView' as "personWorkspaceView",
        ui_state -> 'recentPersonIds' ->> 0 as "recentPersonId"
      from crm.member_preferences where member_id = ${owner.memberId}::uuid
    `;
    assert(
      recentResponse.status === 200 && uiStateResponse.status === 200 &&
        serializedState?.personWorkspaceView === "things" &&
        serializedState.recentPersonId === recentPersonId,
      "concurrent recent-person state was lost by member UI-state save",
    );

    const boundaryConnection = connectDatabase(databaseUrl);
    try {
      const memberUiState = createMemberUiStateManagement({
        actors: new PostgresActorRevalidation(),
        repository: new PostgresMemberUiStateRepository(),
        transaction: new PostgresRegistrationTransaction(boundaryConnection.db),
      });
      const forged = await memberUiState.read({
        memberId: owner.memberId,
        role: "owner",
        userId: owner.userId,
        workspaceId: foreign.workspaceId,
      });
      assert(
        forged.status === "forbidden",
        "forged workspace context crossed the member UI-state predicate",
      );
    } finally {
      await boundaryConnection.destroy();
    }
    const adminMemberId = await addMembership(
      adminIdentity,
      owner.workspaceId,
      "admin",
    );
    const memberId = await addMembership(
      memberIdentity,
      owner.workspaceId,
      "member",
    );
    const adminSignIn = await signIn(
      "settings-admin@example.test",
      owner.workspaceId,
    );
    const adminCookie = adminSignIn.headers.get("set-cookie")?.split(";")[0];
    const memberSignIn = await signIn(
      "settings-member@example.test",
      owner.workspaceId,
    );
    const memberCookie = memberSignIn.headers.get("set-cookie")?.split(";")[0];
    assert(
      adminSignIn.status === 200 && adminCookie,
      "admin enters target workspace",
    );
    assert(
      memberSignIn.status === 200 && memberCookie,
      "member enters target workspace",
    );

    const profile = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/profile",
      {
        method: "PUT",
        body: { firstName: "Ada", lastName: "Owner" },
      },
    );
    assert(profile.status === 200, "current identity profile saves");
    const preferences = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/preferences",
      {
        method: "PUT",
        body: {
          contactNameOrder: "family_given_nickname",
          contactSortOrder: "family_name_asc",
          currencyCode: "EUR",
          fluidLayout: true,
          locale: "sr-Latn",
          measurementSystem: "metric",
          temperatureScale: "celsius",
          timezone: "Europe/Belgrade",
        },
      },
    );
    assert(preferences.status === 200, "member preferences save");
    const [preferenceIsolation] = await sql<{
      readonly changed: boolean;
      readonly untouched: boolean;
    }[]>`
      select
        (select locale = 'sr-Latn' and timezone = 'Europe/Belgrade'
          and fluid_layout from crm.member_preferences
          where member_id = ${owner.memberId}) as changed,
        (select locale = 'en' and timezone is null and not fluid_layout
          from crm.member_preferences where member_id = ${adminMemberId}) as untouched
    `;
    assert(
      preferenceIsolation?.changed && preferenceIsolation.untouched,
      "preference mutation cannot affect another member",
    );
    const [beforeUnsupportedPreference] = await sql<{
      readonly audits: number;
      readonly currencyCode: string | null;
    }[]>`
      select mp.currency_code::text as "currencyCode",
        (select count(*)::int from crm.audit_events
          where action = 'member.preferences-updated'
            and actor_member_id = ${owner.memberId}) as audits
      from crm.member_preferences mp where mp.member_id = ${owner.memberId}
    `;
    const unsupportedPreference = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/preferences",
      {
        method: "PUT",
        body: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          currencyCode: "ZZZ",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "imperial",
          temperatureScale: "fahrenheit",
          timezone: "Europe/London",
        },
      },
    );
    const unsupportedPreferenceBody = await unsupportedPreference.json() as {
      readonly errors?: Readonly<Record<string, string>>;
    };
    const [afterUnsupportedPreference] = await sql<{
      readonly audits: number;
      readonly currencyCode: string | null;
      readonly locale: string;
    }[]>`
      select mp.currency_code::text as "currencyCode", mp.locale,
        (select count(*)::int from crm.audit_events
          where action = 'member.preferences-updated'
            and actor_member_id = ${owner.memberId}) as audits
      from crm.member_preferences mp where mp.member_id = ${owner.memberId}
    `;
    assert(
      unsupportedPreference.status === 400 &&
        unsupportedPreferenceBody.errors?.currencyCode ===
          "Choose a supported currency.",
      "unsupported personal currency is a field validation error",
    );
    assert(
      beforeUnsupportedPreference?.currencyCode === "EUR" &&
        afterUnsupportedPreference?.currencyCode === "EUR" &&
        afterUnsupportedPreference.locale === "sr-Latn" &&
        afterUnsupportedPreference.audits ===
          beforeUnsupportedPreference.audits,
      "unsupported personal currency cannot mutate or audit preferences",
    );

    const workspace = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/workspace",
      {
        method: "PUT",
        body: {
          name: "Trusted circle",
          slug: "trusted-circle",
          defaultLocale: "sr-Latn",
          defaultTimezone: "Europe/Belgrade",
          defaultCurrencyCode: "EUR",
          defaultReminderTime: "09:30",
        },
      },
    );
    assert(workspace.status === 200, "owner updates workspace defaults");
    const [beforeUnsupportedWorkspace] = await sql<{
      readonly audits: number;
      readonly currencyCode: string | null;
      readonly name: string;
      readonly slug: string | null;
    }[]>`
      select w.name, w.slug, ws.default_currency_code::text as "currencyCode",
        (select count(*)::int from crm.audit_events
          where action = 'workspace.configuration-changed'
            and workspace_id = ${owner.workspaceId}) as audits
      from crm.workspaces w join crm.workspace_settings ws
        on ws.workspace_id = w.id where w.id = ${owner.workspaceId}
    `;
    const unsupportedWorkspace = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/workspace",
      {
        method: "PUT",
        body: {
          name: "Must not commit",
          slug: "must-not-commit",
          defaultLocale: "en",
          defaultCurrencyCode: "ZZZ",
          defaultReminderTime: "08:00",
        },
      },
    );
    const unsupportedWorkspaceBody = await unsupportedWorkspace.json() as {
      readonly errors?: Readonly<Record<string, string>>;
    };
    const [afterUnsupportedWorkspace] = await sql<{
      readonly audits: number;
      readonly currencyCode: string | null;
      readonly name: string;
      readonly slug: string | null;
    }[]>`
      select w.name, w.slug, ws.default_currency_code::text as "currencyCode",
        (select count(*)::int from crm.audit_events
          where action = 'workspace.configuration-changed'
            and workspace_id = ${owner.workspaceId}) as audits
      from crm.workspaces w join crm.workspace_settings ws
        on ws.workspace_id = w.id where w.id = ${owner.workspaceId}
    `;
    assert(
      unsupportedWorkspace.status === 400 &&
        unsupportedWorkspaceBody.errors?.defaultCurrencyCode ===
          "Choose a supported currency.",
      "unsupported workspace currency is a field validation error",
    );
    assert(
      beforeUnsupportedWorkspace?.name === "Trusted circle" &&
        beforeUnsupportedWorkspace.slug === "trusted-circle" &&
        beforeUnsupportedWorkspace.currencyCode === "EUR" &&
        afterUnsupportedWorkspace?.name === beforeUnsupportedWorkspace.name &&
        afterUnsupportedWorkspace.slug === beforeUnsupportedWorkspace.slug &&
        afterUnsupportedWorkspace.currencyCode ===
          beforeUnsupportedWorkspace.currencyCode &&
        afterUnsupportedWorkspace.audits === beforeUnsupportedWorkspace.audits,
      "unsupported workspace currency cannot mutate identity, defaults, or audit",
    );
    const competingSlugs = await Promise.all([
      settingsRequest(owner.cookie, "/api/v1/settings/workspace", {
        method: "PUT",
        body: {
          name: "Trusted circle",
          slug: "race-circle",
          defaultLocale: "sr-Latn",
          defaultTimezone: "Europe/Belgrade",
          defaultCurrencyCode: "EUR",
          defaultReminderTime: "09:30",
        },
      }),
      settingsRequest(foreign.cookie, "/api/v1/settings/workspace", {
        method: "PUT",
        body: {
          name: "Foreign circle",
          slug: "RACE-CIRCLE",
          defaultLocale: "en",
          defaultReminderTime: "09:00",
        },
      }),
    ]);
    assert(
      competingSlugs.map((response) => response.status).sort().join(",") ===
        "200,409",
      "concurrent normalized slug claims produce one success and one conflict",
    );
    assert(
      (await settingsRequest(memberCookie, "/api/v1/settings/workspace", {
        workspaceId: owner.workspaceId,
      }))
        .status === 403,
      "ordinary active member is forbidden",
    );
    const managedMembers = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/members",
    );
    const managedMembersBody = await managedMembers.json() as {
      readonly members: readonly {
        readonly email: string;
        readonly id: string;
        readonly name: string;
      }[];
    };
    const listedMember = managedMembersBody.members.find((item) =>
      item.id === memberId
    );
    assert(
      managedMembers.status === 200 &&
        listedMember?.email === "settings-member@example.test" &&
        listedMember.name === "Test Member",
      "member list composes identity display summary through the public facade",
    );
    const managedUpdate = await settingsRequest(
      adminCookie,
      `/api/v1/settings/members/${memberId}`,
      {
        method: "PATCH",
        body: { role: "admin", status: "active" },
        workspaceId: owner.workspaceId,
      },
    );
    const managedUpdateBody = await managedUpdate.json() as {
      readonly member: {
        readonly email: string;
        readonly name: string;
        readonly role: string;
      };
    };
    assert(
      managedUpdate.status === 200 &&
        managedUpdateBody.member.email === "settings-member@example.test" &&
        managedUpdateBody.member.name === "Test Member" &&
        managedUpdateBody.member.role === "admin",
      "admin update composes the same identity display summary",
    );
    assert(
      (await settingsRequest(
        adminCookie,
        `/api/v1/settings/members/${owner.memberId}`,
        {
          method: "PATCH",
          body: { role: "member", status: "active" },
          workspaceId: owner.workspaceId,
        },
      )).status === 403,
      "admin cannot manage an owner",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/members/${owner.memberId}`,
        {
          method: "PATCH",
          body: { role: "member", status: "active" },
        },
      )).status === 409,
      "last active owner cannot be demoted",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/members/${foreign.memberId}`,
        {
          method: "PATCH",
          body: { role: "admin", status: "active" },
        },
      )).status === 404,
      "cross-workspace member identifier is rejected",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/members/${memberId}`,
        {
          method: "PATCH",
          body: { role: "admin", status: "suspended" },
        },
      )).status === 200,
      "owner suspends an active target-workspace membership",
    );
    assert(
      (await settingsRequest(
        memberCookie,
        "/api/v1/settings/preferences",
        { workspaceId: owner.workspaceId },
      )).status === 401,
      "suspension immediately removes the target workspace",
    );
    assert(
      (await settingsRequest(
        memberIdentity.cookie,
        "/api/v1/settings/preferences",
        { workspaceId: memberIdentity.workspaceId },
      )).status === 200,
      "suspension preserves access to another legitimate workspace",
    );

    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/members/${adminMemberId}`,
        {
          method: "PATCH",
          body: { role: "owner", status: "active" },
        },
      )).status === 200,
      "owner promotes a second active owner",
    );
    const concurrentDemotions = await Promise.all([
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/members/${adminMemberId}`,
        {
          method: "PATCH",
          body: { role: "admin", status: "active" },
        },
      ),
      settingsRequest(
        adminCookie,
        `/api/v1/settings/members/${owner.memberId}`,
        {
          method: "PATCH",
          body: { role: "admin", status: "active" },
          workspaceId: owner.workspaceId,
        },
      ),
    ]);
    assert(
      concurrentDemotions.filter((response) => response.status === 200)
            .length === 1 &&
        concurrentDemotions.some((response) =>
          response.status === 403 || response.status === 409
        ),
      "simultaneous owner demotions allow exactly one mutation",
    );
    const [remainingOwners] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.workspace_members
      where workspace_id = ${owner.workspaceId} and role = 'owner'
        and status = 'active' and left_at is null
    `;
    assert(
      remainingOwners?.count === 1,
      "serialized demotions retain an active owner",
    );

    const secondOwnerSignIn = await signIn(
      "settings-owner@example.test",
      owner.workspaceId,
    );
    assert(secondOwnerSignIn.status === 200, "second owned session created");
    await sql`
      update crm.user_sessions set expires_at = now() + interval '30 minutes'
      where user_id = ${owner.userId} and purpose = 'authenticated'
        and revoked_at is null
    `;
    const [liveHandoff] = await sql<{ readonly id: string }[]>`
      select id::text from crm.user_sessions
      where user_id = ${owner.userId} and purpose = 'verified-entry'
        and revoked_at is null and expires_at > now()
      order by created_at desc limit 1
    `;
    assert(liveHandoff, "live verified-entry handoff exists");
    const sessionsResponse = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/sessions",
    );
    const sessionsBody = await sessionsResponse.json() as {
      readonly sessions: readonly {
        readonly current: boolean;
        readonly id: string;
      }[];
    };
    assert(
      sessionsBody.sessions.length >= 2,
      "short authenticated sessions remain visible",
    );
    assert(
      !sessionsBody.sessions.some((item) => item.id === liveHandoff.id),
      "live verified-entry handoff is not listed as an authenticated session",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/sessions/${liveHandoff.id}`,
        { method: "DELETE" },
      )).status === 404,
      "verified-entry handoff cannot be revoked through session settings",
    );
    const [adminSession] = await sql<{ readonly id: string }[]>`
      select s.id::text from crm.user_sessions s
      where s.user_id = ${adminIdentity.userId} and s.revoked_at is null
        and s.expires_at > now() order by s.created_at desc limit 1
    `;
    assert(adminSession, "foreign-owned active session exists");
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/sessions/${adminSession.id}`,
        { method: "DELETE" },
      )).status === 403,
      "another identity session is forbidden",
    );
    const otherOwned = sessionsBody.sessions.find((item) => !item.current);
    assert(otherOwned, "non-current owned session exists");
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/sessions/${otherOwned.id}`,
        { method: "DELETE" },
      )).status === 200,
      "selected owned session revokes",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `/api/v1/settings/sessions/${otherOwned.id}`,
        { method: "DELETE" },
      )).status === 404,
      "revoked session becomes stale",
    );
    const current = sessionsBody.sessions.find((item) => item.current);
    assert(current, "current session identified without token disclosure");
    const currentRevocation = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/sessions/${current.id}`,
      { method: "DELETE" },
    );
    assert(
      currentRevocation.status === 200 &&
        currentRevocation.headers.get("set-cookie")?.includes("Max-Age=0"),
      "current session revokes and clears cookie",
    );
    assert(
      (await configured.app.request("http://localhost/api/v1/session", {
        headers: { cookie: owner.cookie },
      })).status === 401,
      "revoked credential stops working",
    );
    const [audit] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action in (
          'member.profile-updated', 'member.preferences-updated',
          'workspace.configuration-changed', 'workspace.member-updated',
          'identity.session-revoked'
        )
    `;
    assert(
      (audit?.count ?? 0) >= 6,
      "every accepted settings mutation is durably audited",
    );
  },
});

Deno.test({
  name:
    "WORKSPACE-001 missing workspace settings cannot partially mutate workspace identity",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      "settings-missing-companion@example.test",
      "Missing companion circle",
    );
    const [before] = await sql<{
      readonly auditCount: number;
      readonly name: string;
      readonly slug: string | null;
    }[]>`
      select w.name, w.slug,
        (select count(*)::int from crm.audit_events
          where workspace_id = w.id
            and action = 'workspace.configuration-changed') as "auditCount"
      from crm.workspaces w where w.id = ${owner.workspaceId}::uuid
    `;
    assert(before, "workspace exists before companion removal");
    await sql`
      delete from crm.workspace_settings
      where workspace_id = ${owner.workspaceId}::uuid
    `;

    const response = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/workspace",
      {
        method: "PUT",
        body: {
          name: "Partially changed circle",
          slug: "partially-changed-circle",
          defaultLocale: "en",
          defaultReminderTime: "09:00",
        },
      },
    );
    assert(response.status === 503, "missing settings is safely unavailable");

    const [after] = await sql<{
      readonly auditCount: number;
      readonly name: string;
      readonly slug: string | null;
    }[]>`
      select w.name, w.slug,
        (select count(*)::int from crm.audit_events
          where workspace_id = w.id
            and action = 'workspace.configuration-changed') as "auditCount"
      from crm.workspaces w where w.id = ${owner.workspaceId}::uuid
    `;
    assert(
      after?.name === before.name && after.slug === before.slug,
      "unavailable update leaves workspace identity unchanged",
    );
    assert(
      after.auditCount === before.auditCount,
      "unavailable update does not append an audit event",
    );
  },
});

Deno.test({
  name:
    "WORKSPACE-003 real PostgreSQL personalization is tenant-safe, reference-safe, and atomic",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const owner = await register(
      "personalization-owner@example.test",
      "Personalization circle",
    );
    const memberIdentity = await register(
      "personalization-member@example.test",
      "Member personalization home",
    );
    await addMembership(memberIdentity, owner.workspaceId, "member");
    const memberSignIn = await signIn(
      "personalization-member@example.test",
      owner.workspaceId,
    );
    const memberCookie = memberSignIn.headers.get("set-cookie")?.split(";")[0];
    assert(memberCookie, "member session created");
    assert(
      (await settingsRequest(
        memberCookie,
        "/api/v1/settings/personalization/tags",
        { workspaceId: owner.workspaceId },
      )).status === 403,
      "ordinary member cannot manage personalization",
    );

    const created = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/tags",
      { body: { name: "Close friends" }, method: "POST" },
    );
    assert(created.status === 200, "owner creates workspace tag");
    const createdBody = await created.json() as {
      readonly entry: { readonly id: string; readonly updatedAt: string };
    };
    assert(
      (await settingsRequest(
        owner.cookie,
        "/api/v1/settings/personalization/tags",
        { body: { name: " close FRIENDS " }, method: "POST" },
      )).status === 409,
      "case-insensitive duplicate is rejected",
    );
    const replacement = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/tags",
      { body: { name: "Trusted people" }, method: "POST" },
    );
    const replacementBody = await replacement.json() as {
      readonly entry: { readonly id: string };
    };
    const personId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name)
      values (${personId}, ${owner.workspaceId}, 'Tagged')`;
    await sql`insert into crm.person_tags (person_id, tag_id)
      values (${personId}, ${createdBody.entry.id})`;
    const impact = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/tags",
    );
    const impactBody = await impact.json() as {
      readonly entries: readonly {
        readonly id: string;
        readonly referenceCount: number;
      }[];
    };
    assert(
      impactBody.entries.find((item) => item.id === createdBody.entry.id)
        ?.referenceCount === 1,
      "impact count is returned before deletion",
    );
    const deletePath =
      `/api/v1/settings/personalization/tags/${createdBody.entry.id}?expectedUpdatedAt=${
        encodeURIComponent(createdBody.entry.updatedAt)
      }`;
    assert(
      (await settingsRequest(owner.cookie, deletePath, { method: "DELETE" }))
        .status === 409,
      "in-use option requires replacement",
    );
    assert(
      (await settingsRequest(
        owner.cookie,
        `${deletePath}&replacementId=${replacementBody.entry.id}`,
        { method: "DELETE" },
      )).status === 200,
      "same-workspace replacement and deletion succeeds",
    );
    const [assignment] = await sql<{ readonly tagId: string }[]>`
      select tag_id::text as "tagId" from crm.person_tags where person_id = ${personId}
    `;
    assert(
      assignment?.tagId === replacementBody.entry.id,
      "person history is retained under replacement tag",
    );
    const stale = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/tags/${replacementBody.entry.id}`,
      {
        body: {
          expectedUpdatedAt: createdBody.entry.updatedAt,
          name: "Stale rename",
        },
        method: "PATCH",
      },
    );
    assert(stale.status === 409, "stale mutation is rejected");
    const [audit] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'
    `;
    assert(
      audit?.count === 3,
      "each committed change has one governance audit",
    );

    const createOption = async (
      section: string,
      body: Record<string, unknown>,
    ): Promise<{ readonly id: string; readonly updatedAt: string }> => {
      const response = await settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/${section}`,
        { body, method: "POST" },
      );
      assert(response.status === 200, `${section} option creates`);
      return (await response.json() as {
        readonly entry: { readonly id: string; readonly updatedAt: string };
      }).entry;
    };
    const referenceCount = async (
      section: string,
      id: string,
    ): Promise<number> => {
      const response = await settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/${section}`,
      );
      assert(response.status === 200, `${section} lists`);
      const body = await response.json() as {
        readonly entries: readonly {
          readonly id: string;
          readonly referenceCount: number;
        }[];
      };
      return body.entries.find((entry) => entry.id === id)?.referenceCount ??
        -1;
    };
    const listedEntry = async (
      section: string,
      id: string,
    ): Promise<
      {
        readonly forwardLabel?: string;
        readonly name: string;
        readonly reverseLabel?: string;
        readonly updatedAt: string;
      } | undefined
    > => {
      const response = await settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/${section}`,
      );
      assert(response.status === 200, `${section} lists after mutation`);
      const body = await response.json() as {
        readonly entries: readonly {
          readonly forwardLabel?: string;
          readonly id: string;
          readonly name: string;
          readonly reverseLabel?: string;
          readonly updatedAt: string;
        }[];
      };
      return body.entries.find((entry) => entry.id === id);
    };
    const personalizationAuditCount = async (): Promise<number> => {
      const [row] = await sql<{ readonly count: number }[]>`
        select count(*)::int as count from crm.audit_events
        where workspace_id = ${owner.workspaceId}
          and action = 'workspace-personalization-updated'`;
      return row?.count ?? -1;
    };
    const waitForBlockedOperation = async (
      label: string,
      minimum = 1,
    ): Promise<void> => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const [waiting] = await sql<{ readonly count: number }[]>`
          select count(*)::int as count from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()
              and state = 'active' and wait_event_type = 'Lock'`;
        if ((waiting?.count ?? 0) >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`${label} did not reach its database lock boundary`);
    };
    const settleWithin = <T>(
      promise: Promise<T>,
      label: string,
    ): Promise<T> => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} did not settle after release`)),
          3_000,
        );
      });
      return Promise.race([promise, deadline]).finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
    };

    const assignmentFirstSource = await createOption("tags", {
      name: "Assignment-first source",
    });
    const assignmentFirstTarget = await createOption("tags", {
      name: "Assignment-first target",
    });
    const assignmentFirstPerson = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name)
      values (${assignmentFirstPerson}, ${owner.workspaceId}, 'Assignment first')`;
    const [auditBeforeAssignmentFirst] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    let assignmentInserted!: () => void;
    const assignmentReady = new Promise<void>((resolve) => {
      assignmentInserted = resolve;
    });
    let releaseAssignment!: () => void;
    const assignmentRelease = new Promise<void>((resolve) => {
      releaseAssignment = resolve;
    });
    const assignmentTransaction = sql.begin(async (transaction) => {
      await transaction`insert into crm.person_tags (person_id, tag_id)
        values (${assignmentFirstPerson}, ${assignmentFirstSource.id})`;
      assignmentInserted();
      await assignmentRelease;
    });
    await assignmentReady;
    const assignmentFirstReplacement = settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/tags/${assignmentFirstSource.id}?expectedUpdatedAt=${
        encodeURIComponent(assignmentFirstSource.updatedAt)
      }&replacementId=${assignmentFirstTarget.id}`,
      { method: "DELETE" },
    );
    await waitForBlockedOperation("assignment-first replacement");
    releaseAssignment();
    const assignmentFirstResponse = await assignmentFirstReplacement;
    await assignmentTransaction;
    const assignmentFirstRows = await sql<{ readonly tagId: string }[]>`
      select tag_id::text as "tagId" from crm.person_tags
      where person_id = ${assignmentFirstPerson} order by tag_id`;
    const [assignmentFirstSourceAfter] = await sql<
      { readonly present: boolean }[]
    >`select exists(select 1 from crm.tags
      where id = ${assignmentFirstSource.id}) as present`;
    const [auditAfterAssignmentFirst] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      assignmentFirstResponse.status === 200 &&
        assignmentFirstRows.length === 1 &&
        assignmentFirstRows[0]?.tagId === assignmentFirstTarget.id &&
        assignmentFirstSourceAfter?.present === false &&
        auditAfterAssignmentFirst?.count ===
          (auditBeforeAssignmentFirst?.count ?? 0) + 1,
      "assignment-first tag replacement moves the committed assignment exactly once",
    );

    const replacementFirstSource = await createOption("tags", {
      name: "Replacement-first source",
    });
    const replacementFirstTarget = await createOption("tags", {
      name: "Replacement-first target",
    });
    const replacementFirstPerson = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name)
      values (${replacementFirstPerson}, ${owner.workspaceId}, 'Replacement first')`;
    let tagRowsLocked!: () => void;
    const tagRowLockReady = new Promise<void>((resolve) => {
      tagRowsLocked = resolve;
    });
    let releaseTagRows!: () => void;
    const tagRowRelease = new Promise<void>((resolve) => {
      releaseTagRows = resolve;
    });
    const tagRowGate = sql.begin(async (transaction) => {
      await transaction`select id from crm.tags
        where id in (${replacementFirstSource.id}, ${replacementFirstTarget.id})
        order by id for update`;
      tagRowsLocked();
      await tagRowRelease;
    });
    await tagRowLockReady;
    const [auditBeforeReplacementFirst] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const replacementFirstOperation = settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/tags/${replacementFirstSource.id}?expectedUpdatedAt=${
        encodeURIComponent(replacementFirstSource.updatedAt)
      }&replacementId=${replacementFirstTarget.id}`,
      { method: "DELETE" },
    );
    await waitForBlockedOperation("replacement-first replacement");
    const replacementFirstAssignment = sql`insert into crm.person_tags
      (person_id, tag_id) values
      (${replacementFirstPerson}, ${replacementFirstSource.id})`.then(
      () => "inserted" as const,
      () => "rejected" as const,
    );
    await waitForBlockedOperation("replacement-first assignment", 2);
    releaseTagRows();
    const [replacementFirstResponse, replacementFirstAssignmentOutcome] =
      await Promise.all([
        settleWithin(
          replacementFirstOperation,
          "replacement-first replacement",
        ),
        settleWithin(
          replacementFirstAssignment,
          "replacement-first assignment",
        ),
        settleWithin(tagRowGate, "replacement-first row-lock gate"),
      ]);
    const replacementFirstRows = await sql<{ readonly tagId: string }[]>`
      select tag_id::text as "tagId" from crm.person_tags
      where person_id = ${replacementFirstPerson} order by tag_id`;
    const [replacementFirstSourceAfter] = await sql<
      { readonly present: boolean }[]
    >`select exists(select 1 from crm.tags
      where id = ${replacementFirstSource.id}) as present`;
    const [auditAfterReplacementFirst] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const rejectedWithoutAssignment =
      replacementFirstAssignmentOutcome === "rejected" &&
      replacementFirstRows.length === 0;
    const insertedThenMoved =
      replacementFirstAssignmentOutcome === "inserted" &&
      replacementFirstRows.length === 1 &&
      replacementFirstRows[0]?.tagId === replacementFirstTarget.id;
    assert(
      replacementFirstResponse.status === 200 &&
        (rejectedWithoutAssignment || insertedThenMoved) &&
        replacementFirstRows.every((row) =>
          row.tagId !== replacementFirstSource.id
        ) &&
        replacementFirstSourceAfter?.present === false &&
        auditAfterReplacementFirst?.count ===
          (auditBeforeReplacementFirst?.count ?? 0) + 1,
      "replacement-first tag deletion retains every valid linearization without loss",
    );

    const reminder = await createOption("reminder-rules", { daysBefore: 7 });
    const reminderList = await (await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/reminder-rules",
    )).json() as {
      readonly entries: readonly {
        readonly daysBefore: number;
        readonly kind: string;
        readonly name: string;
      }[];
    };
    assert(
      reminderList.entries.length === 1 &&
        reminderList.entries[0]?.daysBefore === 7 &&
        reminderList.entries[0]?.kind === "reminder-rule" &&
        reminderList.entries[0]?.name === "7 days before",
      "Planning returns real reminder_rules rows without fabricated recurrence values",
    );
    const reminderCapabilityList = await (await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/reminder-rules",
    )).json() as {
      readonly entries: readonly {
        readonly capabilities: { readonly editValue: boolean };
      }[];
    };
    assert(
      reminderCapabilityList.entries[0]?.capabilities.editValue === true,
      "reminder rule declares exact lead-time editing capability",
    );
    const editedReminder = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${reminder.id}`,
      {
        body: { daysBefore: 3, expectedUpdatedAt: reminder.updatedAt },
        method: "PATCH",
      },
    );
    const editedReminderBody = await editedReminder.json() as {
      readonly entry: {
        readonly daysBefore: number;
        readonly name: string;
        readonly updatedAt: string;
      };
    };
    assert(
      editedReminder.status === 200 &&
        editedReminderBody.entry.daysBefore === 3 &&
        editedReminderBody.entry.name === "3 days before",
      "reminder lead time edits through Planning and is returned authoritatively",
    );
    const persistedReminder = await (await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/reminder-rules",
    )).json() as {
      readonly entries: readonly { readonly daysBefore: number }[];
    };
    assert(
      persistedReminder.entries[0]?.daysBefore === 3,
      "edited reminder lead time persists",
    );
    const disabledReminder = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${reminder.id}`,
      {
        body: {
          expectedUpdatedAt: editedReminderBody.entry.updatedAt,
          isActive: false,
        },
        method: "PATCH",
      },
    );
    assert(disabledReminder.status === 200, "reminder delivery rule disables");

    const [profileAuditBefore] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const invalidProfileModule = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/profile-modules",
      { body: { name: " !!! " }, method: "POST" },
    );
    const [invalidModuleCount] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.workspace_profile_modules
      where workspace_id = ${owner.workspaceId} and name = '!!!'`;
    const [profileAuditAfterInvalid] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      invalidProfileModule.status === 400 && invalidModuleCount?.count === 0 &&
        profileAuditAfterInvalid?.count === profileAuditBefore?.count,
      "profile module rejects an empty derived key without row or audit",
    );
    const profileModule = await createOption("profile-modules", {
      name: "Contact methods",
    });
    const equivalentProfileModule = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/profile-modules",
      { body: { name: "Contact-methods" }, method: "POST" },
    );
    const [equivalentModuleCount] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.workspace_profile_modules
      where workspace_id = ${owner.workspaceId} and key = 'contact-methods'`;
    assert(
      equivalentProfileModule.status === 409 &&
        equivalentModuleCount?.count === 1,
      "equivalent profile module keys return a stable conflict",
    );
    const renamedProfileModule = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/profile-modules/${profileModule.id}`,
      {
        body: {
          expectedUpdatedAt: profileModule.updatedAt,
          name: "Ways to connect",
        },
        method: "PATCH",
      },
    );
    const [renamedModuleRow] = await sql<
      { readonly key: string; readonly name: string }[]
    >`select key, name from crm.workspace_profile_modules
      where id = ${profileModule.id}`;
    assert(
      renamedProfileModule.status === 200 &&
        renamedModuleRow?.key === "contact-methods" &&
        renamedModuleRow.name === "Ways to connect",
      "profile module display rename preserves its stable create-time key",
    );
    const [concurrentAuditBefore] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const concurrentEquivalent = await Promise.all([
      settingsRequest(
        owner.cookie,
        "/api/v1/settings/personalization/profile-modules",
        { body: { name: "Review contacts" }, method: "POST" },
      ),
      settingsRequest(
        owner.cookie,
        "/api/v1/settings/personalization/profile-modules",
        { body: { name: "Review-contacts" }, method: "POST" },
      ),
    ]);
    const [concurrentModuleCount] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.workspace_profile_modules
      where workspace_id = ${owner.workspaceId} and key = 'review-contacts'`;
    const [concurrentAuditAfter] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      concurrentEquivalent.map((response) => response.status).sort().join(
            ",",
          ) ===
          "200,409" &&
        concurrentModuleCount?.count === 1 &&
        concurrentAuditAfter?.count === (concurrentAuditBefore?.count ?? 0) + 1,
      "concurrent equivalent module keys have one audited winner",
    );

    const duplicateUpdateSections = [
      "profile-modules",
      "gender-options",
      "contact-method-types",
      "contact-labels",
      "activity-types",
      "life-event-types",
    ] as const;
    for (const [index, section] of duplicateUpdateSections.entries()) {
      const sourceName = `Rename source ${index}`;
      const targetName = `Rename target ${index}`;
      const source = await createOption(section, {
        name: sourceName,
        ...(section === "contact-labels" ? {} : { sortOrder: index + 20 }),
      });
      await createOption(section, {
        name: targetName,
        ...(section === "contact-labels" ? {} : { sortOrder: index + 40 }),
      });
      const auditBeforeCollision = await personalizationAuditCount();
      const collision = await settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/${section}/${source.id}`,
        {
          body: {
            expectedUpdatedAt: source.updatedAt,
            name: targetName.toUpperCase(),
          },
          method: "PATCH",
        },
      );
      const sourceAfterCollision = await listedEntry(section, source.id);
      assert(
        collision.status === 409 &&
          sourceAfterCollision?.name === sourceName &&
          sourceAfterCollision.updatedAt === source.updatedAt &&
          await personalizationAuditCount() === auditBeforeCollision,
        `${section} duplicate rename preserves row version and audit`,
      );
    }

    const concurrentRenameA = await createOption("contact-labels", {
      name: "Concurrent label A",
    });
    const concurrentRenameB = await createOption("contact-labels", {
      name: "Concurrent label B",
    });
    const auditBeforeConcurrentRename = await personalizationAuditCount();
    const concurrentRenames = await Promise.all([
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/contact-labels/${concurrentRenameA.id}`,
        {
          body: {
            expectedUpdatedAt: concurrentRenameA.updatedAt,
            name: "Concurrent shared label",
          },
          method: "PATCH",
        },
      ),
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/contact-labels/${concurrentRenameB.id}`,
        {
          body: {
            expectedUpdatedAt: concurrentRenameB.updatedAt,
            name: "Concurrent shared label",
          },
          method: "PATCH",
        },
      ),
    ]);
    const concurrentRenameAfterA = await listedEntry(
      "contact-labels",
      concurrentRenameA.id,
    );
    const concurrentRenameAfterB = await listedEntry(
      "contact-labels",
      concurrentRenameB.id,
    );
    const concurrentWinners = [concurrentRenameAfterA, concurrentRenameAfterB]
      .filter((entry) => entry?.name === "Concurrent shared label");
    const concurrentLoserUnchanged =
      concurrentRenameAfterA?.name === "Concurrent label A"
        ? concurrentRenameAfterA.updatedAt === concurrentRenameA.updatedAt
        : concurrentRenameAfterB?.name === "Concurrent label B" &&
          concurrentRenameAfterB.updatedAt === concurrentRenameB.updatedAt;
    assert(
      concurrentRenames.map((response) => response.status).sort().join(",") ===
          "200,409" &&
        concurrentWinners.length === 1 &&
        concurrentLoserUnchanged &&
        await personalizationAuditCount() === auditBeforeConcurrentRename + 1,
      "concurrent normalized renames have one winner and preserve the loser",
    );

    const tagRenameSource = await createOption("tags", {
      name: "Tag rename source",
    });
    await createOption("tags", { name: "Tag rename target" });
    const tagAuditBefore = await personalizationAuditCount();
    const tagRenameCollision = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/tags/${tagRenameSource.id}`,
      {
        body: {
          expectedUpdatedAt: tagRenameSource.updatedAt,
          name: "TAG RENAME TARGET",
        },
        method: "PATCH",
      },
    );
    assert(
      tagRenameCollision.status === 409 &&
        (await listedEntry("tags", tagRenameSource.id))?.updatedAt ===
          tagRenameSource.updatedAt &&
        await personalizationAuditCount() === tagAuditBefore,
      "People tag update keeps its own normalized uniqueness semantics",
    );

    const reminderCollisionSource = await createOption("reminder-rules", {
      daysBefore: 31,
    });
    await createOption("reminder-rules", { daysBefore: 32 });
    const reminderAuditBefore = await personalizationAuditCount();
    const reminderCollision = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${reminderCollisionSource.id}`,
      {
        body: {
          daysBefore: 32,
          expectedUpdatedAt: reminderCollisionSource.updatedAt,
        },
        method: "PATCH",
      },
    );
    assert(
      reminderCollision.status === 409 &&
        (await listedEntry("reminder-rules", reminderCollisionSource.id))
            ?.updatedAt === reminderCollisionSource.updatedAt &&
        await personalizationAuditCount() === reminderAuditBefore,
      "Planning reminder update keeps its own lead-time uniqueness semantics",
    );

    const concurrentTagA = await createOption("tags", {
      name: "Concurrent tag rename A",
    });
    const concurrentTagB = await createOption("tags", {
      name: "Concurrent tag rename B",
    });
    const concurrentTagAudit = await personalizationAuditCount();
    const concurrentTagRenames = await Promise.all([
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/tags/${concurrentTagA.id}`,
        {
          body: {
            expectedUpdatedAt: concurrentTagA.updatedAt,
            name: "Concurrent tag winner",
          },
          method: "PATCH",
        },
      ),
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/tags/${concurrentTagB.id}`,
        {
          body: {
            expectedUpdatedAt: concurrentTagB.updatedAt,
            name: "concurrent TAG winner",
          },
          method: "PATCH",
        },
      ),
    ]);
    assert(
      concurrentTagRenames.map((response) => response.status).sort().join(
            ",",
          ) === "200,409" &&
        await personalizationAuditCount() === concurrentTagAudit + 1,
      "concurrent People tag renames have one normalized winner",
    );

    const concurrentReminderAudit = await personalizationAuditCount();
    const concurrentReminderCreates = await Promise.all([
      settingsRequest(
        owner.cookie,
        "/api/v1/settings/personalization/reminder-rules",
        { body: { daysBefore: 340 }, method: "POST" },
      ),
      settingsRequest(
        owner.cookie,
        "/api/v1/settings/personalization/reminder-rules",
        { body: { daysBefore: 340 }, method: "POST" },
      ),
    ]);
    assert(
      concurrentReminderCreates.map((response) => response.status).sort().join(
            ",",
          ) === "200,409" &&
        await personalizationAuditCount() === concurrentReminderAudit + 1,
      "concurrent Planning rule creates have one winner",
    );

    const staleReminder = await createOption("reminder-rules", {
      daysBefore: 341,
    });
    const staleReminderAudit = await personalizationAuditCount();
    let releaseStaleReminder!: () => void;
    let staleReminderLocked!: () => void;
    const staleReminderReady = new Promise<void>((resolve) => {
      staleReminderLocked = resolve;
    });
    const staleReminderRelease = new Promise<void>((resolve) => {
      releaseStaleReminder = resolve;
    });
    const staleReminderGate = sql.begin(async (transaction) => {
      await transaction`select id from crm.reminder_rules
        where id = ${staleReminder.id}::uuid for update`;
      staleReminderLocked();
      await staleReminderRelease;
      await transaction`update crm.reminder_rules set days_before = 342,
        updated_at = clock_timestamp() where id = ${staleReminder.id}::uuid`;
    });
    await staleReminderReady;
    const staleReminderRequest = settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${staleReminder.id}`,
      {
        body: {
          daysBefore: 343,
          expectedUpdatedAt: staleReminder.updatedAt,
        },
        method: "PATCH",
      },
    );
    await waitForBlockedOperation("Planning stale current-row update");
    releaseStaleReminder();
    const [staleReminderResponse] = await Promise.all([
      settleWithin(staleReminderRequest, "Planning stale update"),
      settleWithin(staleReminderGate, "Planning current-row lock gate"),
    ]);
    const [staleReminderRow] = await sql<
      { readonly daysBefore: number; readonly updatedAt: string }[]
    >`select days_before::int as "daysBefore", updated_at::text as "updatedAt"
      from crm.reminder_rules where id = ${staleReminder.id}::uuid`;
    assert(
      staleReminderResponse.status === 409 &&
        staleReminderRow?.daysBefore === 342 &&
        staleReminderRow.updatedAt.replace(" ", "T").replace(/\+00$/, "Z") !==
          staleReminder.updatedAt &&
        await personalizationAuditCount() === staleReminderAudit,
      "Planning locks the current rule before stale validation and preserves the winner",
    );

    const rawTagAudit = await personalizationAuditCount();
    let releaseRawTag!: () => void;
    let rawTagInserted!: () => void;
    const rawTagReady = new Promise<void>((resolve) => {
      rawTagInserted = resolve;
    });
    const rawTagRelease = new Promise<void>((resolve) => {
      releaseRawTag = resolve;
    });
    const rawTagGate = sql.begin(async (transaction) => {
      await transaction`insert into crm.tags (workspace_id, name, slug)
        values (${owner.workspaceId}::uuid, 'Raw tag winner', 'raw-tag-winner')`;
      rawTagInserted();
      await rawTagRelease;
    });
    await rawTagReady;
    const rawTagRequest = settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/tags",
      { body: { name: "Raw tag winner" }, method: "POST" },
    );
    await waitForBlockedOperation("People raw tag unique race");
    releaseRawTag();
    const [rawTagResponse] = await Promise.all([
      settleWithin(rawTagRequest, "People raw tag conflict"),
      settleWithin(rawTagGate, "People raw tag gate"),
    ]);
    const [rawTagRows] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.tags
      where workspace_id = ${owner.workspaceId}::uuid and slug = 'raw-tag-winner'`;
    assert(
      rawTagResponse.status === 409 && rawTagRows?.count === 1 &&
        await personalizationAuditCount() === rawTagAudit,
      "People contains a non-cooperating unique race as a stable conflict",
    );

    const rawReminderSource = await createOption("reminder-rules", {
      daysBefore: 344,
    });
    const rawReminderTarget = await createOption("reminder-rules", {
      daysBefore: 345,
    });
    const rawReminderAudit = await personalizationAuditCount();
    let releaseRawReminder!: () => void;
    let rawReminderUpdated!: () => void;
    const rawReminderReady = new Promise<void>((resolve) => {
      rawReminderUpdated = resolve;
    });
    const rawReminderRelease = new Promise<void>((resolve) => {
      releaseRawReminder = resolve;
    });
    const rawReminderGate = sql.begin(async (transaction) => {
      await transaction`update crm.reminder_rules set days_before = 346,
        updated_at = clock_timestamp()
        where id = ${rawReminderTarget.id}::uuid`;
      rawReminderUpdated();
      await rawReminderRelease;
    });
    await rawReminderReady;
    const rawReminderRequest = settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${rawReminderSource.id}`,
      {
        body: {
          daysBefore: 346,
          expectedUpdatedAt: rawReminderSource.updatedAt,
        },
        method: "PATCH",
      },
    );
    await waitForBlockedOperation("Planning raw unique race");
    releaseRawReminder();
    const [rawReminderResponse] = await Promise.all([
      settleWithin(rawReminderRequest, "Planning raw conflict"),
      settleWithin(rawReminderGate, "Planning raw update gate"),
    ]);
    const [rawReminderSourceRow] = await sql<
      { readonly daysBefore: number; readonly updatedAt: string }[]
    >`select days_before::int as "daysBefore", updated_at::text as "updatedAt"
      from crm.reminder_rules where id = ${rawReminderSource.id}::uuid`;
    assert(
      rawReminderResponse.status === 409 &&
        rawReminderSourceRow?.daysBefore === 344 &&
        rawReminderSourceRow.updatedAt.replace(" ", "T").replace(
            /\+00$/,
            "Z",
          ) ===
          rawReminderSource.updatedAt &&
        await personalizationAuditCount() === rawReminderAudit,
      "Planning rolls back a non-cooperating unique race without version or audit",
    );

    const invalidReminder = await createOption("reminder-rules", {
      daysBefore: 33,
    });
    const invalidReminderAudit = await personalizationAuditCount();
    const invalidReminderUpdate = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/reminder-rules/${invalidReminder.id}`,
      {
        body: {
          expectedUpdatedAt: invalidReminder.updatedAt,
          isDefault: true,
          name: "Ignored reminder name",
          sortOrder: 99,
        },
        method: "PATCH",
      },
    );
    assert(
      invalidReminderUpdate.status === 400 &&
        (await listedEntry("reminder-rules", invalidReminder.id))?.updatedAt ===
          invalidReminder.updatedAt &&
        await personalizationAuditCount() === invalidReminderAudit,
      "unsupported reminder fields do not change version or audit",
    );

    const invalidRelationship = await createOption("relationship-types", {
      forwardLabel: "Strict source",
      reverseLabel: "Strict reverse",
    });
    const invalidRelationshipAudit = await personalizationAuditCount();
    const invalidRelationshipUpdate = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/relationship-types/${invalidRelationship.id}`,
      {
        body: {
          expectedUpdatedAt: invalidRelationship.updatedAt,
          name: "Ignored relationship name",
        },
        method: "PATCH",
      },
    );
    assert(
      invalidRelationshipUpdate.status === 400 &&
        (await listedEntry("relationship-types", invalidRelationship.id))
            ?.updatedAt === invalidRelationship.updatedAt &&
        await personalizationAuditCount() === invalidRelationshipAudit,
      "generic relationship name does not change version or audit",
    );

    const relationshipRenameSource = await createOption(
      "relationship-types",
      { forwardLabel: "Duplicate source", reverseLabel: "Source reverse" },
    );
    await createOption("relationship-types", {
      forwardLabel: "Duplicate target",
      reverseLabel: "Target reverse",
    });
    const relationshipRenameAudit = await personalizationAuditCount();
    const relationshipRenameCollision = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/relationship-types/${relationshipRenameSource.id}`,
      {
        body: {
          expectedUpdatedAt: relationshipRenameSource.updatedAt,
          forwardLabel: "DUPLICATE TARGET",
          reverseLabel: "TARGET REVERSE",
        },
        method: "PATCH",
      },
    );
    assert(
      relationshipRenameCollision.status === 409 &&
        (await listedEntry(
            "relationship-types",
            relationshipRenameSource.id,
          ))?.updatedAt === relationshipRenameSource.updatedAt &&
        await personalizationAuditCount() === relationshipRenameAudit,
      "directional pair duplicate preserves relationship type and audit",
    );

    const relationshipType = await createOption("relationship-types", {
      forwardLabel: "Mentor",
      reverseLabel: "Mentee",
      sortOrder: 4,
    });
    const firstRelationshipSave = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/relationship-types/${relationshipType.id}`,
      {
        body: {
          expectedUpdatedAt: relationshipType.updatedAt,
          forwardLabel: "Coach",
          reverseLabel: "Student",
          sortOrder: 5,
        },
        method: "PATCH",
      },
    );
    assert(firstRelationshipSave.status === 200, "directional labels update");
    const firstRelationshipEntry = (await firstRelationshipSave.json() as {
      readonly entry: { readonly updatedAt: string };
    }).entry;
    const secondRelationshipSave = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/relationship-types/${relationshipType.id}`,
      {
        body: {
          expectedUpdatedAt: firstRelationshipEntry.updatedAt,
          forwardLabel: "Coach",
          reverseLabel: "Student",
          sortOrder: 5,
        },
        method: "PATCH",
      },
    );
    const secondRelationshipEntry = (await secondRelationshipSave.json() as {
      readonly entry: {
        readonly forwardLabel: string;
        readonly reverseLabel: string;
        readonly updatedAt: string;
      };
    }).entry;
    assert(
      secondRelationshipSave.status === 200 &&
        secondRelationshipEntry.forwardLabel === "Coach" &&
        secondRelationshipEntry.reverseLabel === "Student",
      "repeated save does not expand or corrupt direction labels",
    );

    const gender = await createOption("gender-options", {
      name: "Custom gender",
    });
    const [genderDefaultBefore] = await sql<
      { readonly defaultGenderOptionId: string | null }[]
    >`select default_gender_option_id::text as "defaultGenderOptionId"
      from crm.workspace_settings where workspace_id = ${owner.workspaceId}::uuid`;
    const genderAuditBefore = await personalizationAuditCount();
    const falseGenderDefault = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/gender-options/${gender.id}`,
      {
        body: {
          expectedUpdatedAt: gender.updatedAt,
          isDefault: false,
        },
        method: "PATCH",
      },
    );
    const [genderDefaultAfter] = await sql<
      { readonly defaultGenderOptionId: string | null }[]
    >`select default_gender_option_id::text as "defaultGenderOptionId"
      from crm.workspace_settings where workspace_id = ${owner.workspaceId}::uuid`;
    assert(
      falseGenderDefault.status === 400 &&
        (await listedEntry("gender-options", gender.id))?.updatedAt ===
          gender.updatedAt &&
        genderDefaultAfter?.defaultGenderOptionId ===
          genderDefaultBefore?.defaultGenderOptionId &&
        await personalizationAuditCount() === genderAuditBefore,
      "false gender default changes no row, workspace default, or audit",
    );
    const contactType = await createOption("contact-method-types", {
      name: "Pager",
    });
    const contactTypeReplacement = await createOption("contact-method-types", {
      name: "Secure pager",
    });
    const contactLabel = await createOption("contact-labels", {
      name: "Emergency",
    });
    const activityType = await createOption("activity-types", { name: "Walk" });
    const lifeType = await createOption("life-event-types", {
      name: "Milestone",
    });
    const otherPersonId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name, gender_option_id)
      values (${otherPersonId}, ${owner.workspaceId}, 'Related', ${gender.id})`;
    const [method] = await sql<
      { readonly id: string }[]
    >`insert into crm.person_contact_methods
      (person_id, type_id, value) values (${personId}, ${contactType.id}, 'pager-value')
      returning id::text`;
    assert(method, "contact method reference creates");
    await sql`insert into crm.person_contact_method_labels (contact_method_id, label_id)
      values (${method.id}, ${contactLabel.id})`;
    const [activity] = await sql<
      { readonly id: string }[]
    >`insert into crm.activities
      (workspace_id, activity_type_id, summary, happened_at)
      values (${owner.workspaceId}, ${activityType.id}, 'Walked', now()) returning id::text`;
    assert(activity, "activity reference creates");
    await sql`insert into crm.life_events (workspace_id, person_id, life_event_type_id, name)
      values (${owner.workspaceId}, ${personId}, ${lifeType.id}, 'A milestone')`;
    await sql`insert into crm.relationships
      (workspace_id, from_person_id, to_person_id, relationship_type_id)
      values (${owner.workspaceId}, ${personId}, ${otherPersonId}, ${relationshipType.id})`;
    const [petCategory] = await sql<{ readonly id: string }[]>`
      insert into crm.pet_categories (name, is_common)
      values ('WORKSPACE-003 companion', true) returning id::text`;
    const [emotion] = await sql<{ readonly id: string }[]>`
      insert into crm.emotion_options (name) values ('WORKSPACE-003 joy') returning id::text`;
    assert(petCategory && emotion, "test global catalogs are explicit");
    await sql`insert into crm.pets (person_id, category_id, name)
      values (${personId}, ${petCategory.id}, 'Pet')`;
    await sql`insert into crm.activity_emotions (activity_id, emotion_id)
      values (${activity.id}, ${emotion.id})`;
    const tenantPersonId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name)
      values (${tenantPersonId}, ${memberIdentity.workspaceId}, 'Other tenant')`;
    await sql`insert into crm.pets (person_id, category_id, name)
      values (${tenantPersonId}, ${petCategory.id}, 'Other pet')`;

    for (
      const [section, id] of [
        ["gender-options", gender.id],
        ["contact-method-types", contactType.id],
        ["contact-labels", contactLabel.id],
        ["activity-types", activityType.id],
        ["life-event-types", lifeType.id],
        ["relationship-types", relationshipType.id],
        ["pet-categories", petCategory.id],
        ["emotion-options", emotion.id],
      ] as const
    ) {
      assert(
        await referenceCount(section, id) === 1,
        `${section} impact is accurate and workspace-scoped`,
      );
    }

    const primaryCollisionSource = await createOption(
      "contact-method-types",
      { name: "Primary collision source" },
    );
    const primaryCollisionTarget = await createOption(
      "contact-method-types",
      { name: "Primary collision target" },
    );
    const primaryCollisionPersonId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name)
      values (${primaryCollisionPersonId}, ${owner.workspaceId}, 'Primary collision')`;
    await sql`insert into crm.person_contact_methods
      (person_id, type_id, value, is_primary) values
      (${primaryCollisionPersonId}, ${primaryCollisionSource.id}, 'source', true),
      (${primaryCollisionPersonId}, ${primaryCollisionTarget.id}, 'target', true)`;
    const [auditBeforePrimaryCollision] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const primaryCollision = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/contact-method-types/${primaryCollisionSource.id}?expectedUpdatedAt=${
        encodeURIComponent(primaryCollisionSource.updatedAt)
      }&replacementId=${primaryCollisionTarget.id}`,
      { method: "DELETE" },
    );
    const primaryCollisionProblem = await primaryCollision.json() as {
      readonly code?: string;
    };
    const primaryRowsAfterCollision = await sql<
      { readonly typeId: string }[]
    >`select type_id::text as "typeId" from crm.person_contact_methods
      where person_id = ${primaryCollisionPersonId} order by type_id`;
    const [primarySourceAfterCollision] = await sql<
      { readonly present: boolean }[]
    >`select exists(select 1 from crm.contact_method_types
      where id = ${primaryCollisionSource.id}
        and workspace_id = ${owner.workspaceId}) as present`;
    const [auditAfterPrimaryCollision] = await sql<
      { readonly count: number }[]
    >`select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      primaryCollision.status === 409 &&
        primaryCollisionProblem.code ===
          "personalization_replacement_conflict" &&
        primaryRowsAfterCollision.length === 2 &&
        primaryRowsAfterCollision.some((row) =>
          row.typeId === primaryCollisionSource.id
        ) &&
        primaryRowsAfterCollision.some((row) =>
          row.typeId === primaryCollisionTarget.id
        ) && primarySourceAfterCollision?.present === true &&
        auditAfterPrimaryCollision?.count ===
          auditBeforePrimaryCollision?.count,
      "primary contact-method collision is an explicit zero-change conflict",
    );

    const renamedContact = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/contact-method-types/${contactType.id}`,
      {
        body: {
          expectedUpdatedAt: contactType.updatedAt,
          name: "Pager renamed",
        },
        method: "PATCH",
      },
    );
    assert(
      renamedContact.status === 200,
      "contact type rename establishes stale version",
    );
    const renamedContactEntry = (await renamedContact.json() as {
      readonly entry: { readonly updatedAt: string };
    }).entry;
    const [auditBeforeStaleReplacement] = await sql<
      { readonly count: number }[]
    >`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const staleReplacement = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/contact-method-types/${contactType.id}?expectedUpdatedAt=${
        encodeURIComponent(contactType.updatedAt)
      }&replacementId=${contactTypeReplacement.id}`,
      { method: "DELETE" },
    );
    const [methodAfterStale] = await sql<{ readonly typeId: string }[]>`
      select type_id::text as "typeId" from crm.person_contact_methods where id = ${method.id}`;
    const [sourceAfterStale] = await sql<{ readonly present: boolean }[]>`
      select exists(select 1 from crm.contact_method_types
        where id = ${contactType.id} and workspace_id = ${owner.workspaceId}) as present`;
    const [targetReferencesAfterStale] = await sql<
      { readonly count: number }[]
    >`
      select count(*)::int as count from crm.person_contact_methods pcm
      join crm.people p on p.id = pcm.person_id
      where p.workspace_id = ${owner.workspaceId}
        and pcm.type_id = ${contactTypeReplacement.id}`;
    const [auditAfterStaleReplacement] = await sql<
      { readonly count: number }[]
    >`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      staleReplacement.status === 409 &&
        methodAfterStale?.typeId === contactType.id &&
        sourceAfterStale?.present === true &&
        targetReferencesAfterStale?.count === 0 &&
        auditAfterStaleReplacement?.count ===
          auditBeforeStaleReplacement?.count,
      "stale replacement changes no references, source, or governance audit",
    );

    const relationshipReplacement = await createOption("relationship-types", {
      forwardLabel: "Advisor",
      reverseLabel: "Advisee",
      sortOrder: 6,
    });
    await sql`insert into crm.relationships
      (workspace_id, from_person_id, to_person_id, relationship_type_id)
      values (${owner.workspaceId}, ${personId}, ${otherPersonId}, ${relationshipReplacement.id})`;
    const [auditBeforeRelationshipCollision] = await sql<
      { readonly count: number }[]
    >`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const relationshipCollision = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/relationship-types/${relationshipType.id}?expectedUpdatedAt=${
        encodeURIComponent(secondRelationshipEntry.updatedAt)
      }&replacementId=${relationshipReplacement.id}`,
      { method: "DELETE" },
    );
    const relationshipCollisionProblem = await relationshipCollision.json() as {
      readonly code?: string;
    };
    const relationshipRowsAfterCollision = await sql<
      { readonly typeId: string }[]
    >`
      select relationship_type_id::text as "typeId" from crm.relationships
      where workspace_id = ${owner.workspaceId}
        and from_person_id = ${personId} and to_person_id = ${otherPersonId}
      order by relationship_type_id`;
    const [relationshipSourceAfterCollision] = await sql<
      { readonly present: boolean }[]
    >`
      select exists(select 1 from crm.relationship_types
        where id = ${relationshipType.id} and workspace_id = ${owner.workspaceId}) as present`;
    const [auditAfterRelationshipCollision] = await sql<
      { readonly count: number }[]
    >`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    assert(
      relationshipCollision.status === 409 &&
        relationshipCollisionProblem.code ===
          "personalization_replacement_conflict" &&
        relationshipRowsAfterCollision.length === 2 &&
        relationshipRowsAfterCollision.some((row) =>
          row.typeId === relationshipType.id
        ) &&
        relationshipRowsAfterCollision.some((row) =>
          row.typeId === relationshipReplacement.id
        ) &&
        relationshipSourceAfterCollision?.present === true &&
        auditAfterRelationshipCollision?.count ===
          auditBeforeRelationshipCollision?.count,
      "relationship replacement collision is an explicit zero-change conflict",
    );

    const racingSource = await createOption("contact-method-types", {
      name: "Concurrent source",
    });
    const racingTarget = await createOption("contact-method-types", {
      name: "Concurrent target",
    });
    const [racingMethod] = await sql<{ readonly id: string }[]>`
      insert into crm.person_contact_methods (person_id, type_id, value)
      values (${personId}, ${racingSource.id}, 'concurrent-value') returning id::text`;
    assert(racingMethod, "concurrent reference creates");
    const [auditBeforeRace] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const [concurrentRename, concurrentReplacement] = await Promise.all([
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/contact-method-types/${racingSource.id}`,
        {
          body: {
            expectedUpdatedAt: racingSource.updatedAt,
            name: "Concurrent winner",
          },
          method: "PATCH",
        },
      ),
      settingsRequest(
        owner.cookie,
        `/api/v1/settings/personalization/contact-method-types/${racingSource.id}?expectedUpdatedAt=${
          encodeURIComponent(racingSource.updatedAt)
        }&replacementId=${racingTarget.id}`,
        { method: "DELETE" },
      ),
    ]);
    const [racingMethodAfter] = await sql<{ readonly typeId: string }[]>`
      select type_id::text as "typeId" from crm.person_contact_methods where id = ${racingMethod.id}`;
    const [racingSourceAfter] = await sql<{ readonly present: boolean }[]>`
      select exists(select 1 from crm.contact_method_types
        where id = ${racingSource.id} and workspace_id = ${owner.workspaceId}) as present`;
    const [auditAfterRace] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'workspace-personalization-updated'`;
    const renameWon = concurrentRename.status === 200;
    const replacementWon = concurrentReplacement.status === 200;
    assert(
      renameWon !== replacementWon &&
        (renameWon
          ? concurrentReplacement.status === 409 &&
            racingMethodAfter?.typeId === racingSource.id &&
            racingSourceAfter?.present === true
          : (concurrentRename.status === 404 ||
            concurrentRename.status === 409) &&
            racingMethodAfter?.typeId === racingTarget.id &&
            racingSourceAfter?.present === false) &&
        auditAfterRace?.count === (auditBeforeRace?.count ?? 0) + 1,
      "concurrent rename/replacement has one atomic winner and one governance audit",
    );

    const contactDelete = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/contact-method-types/${contactType.id}?expectedUpdatedAt=${
        encodeURIComponent(renamedContactEntry.updatedAt)
      }&replacementId=${contactTypeReplacement.id}`,
      { method: "DELETE" },
    );
    assert(
      contactDelete.status === 200,
      "RESTRICT contact type replaces before delete",
    );
    const [retainedMethod] = await sql<{ readonly typeId: string }[]>`
      select type_id::text as "typeId" from crm.person_contact_methods where id = ${method.id}`;
    assert(
      retainedMethod?.typeId === contactTypeReplacement.id,
      "contact history is retained",
    );

    const activityList = await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/activity-types",
    );
    const currentActivity = (await activityList.json() as {
      readonly entries: readonly {
        readonly id: string;
        readonly updatedAt: string;
      }[];
    }).entries.find((entry) => entry.id === activityType.id);
    assert(currentActivity, "activity option is listed");
    const disabledActivity = await settingsRequest(
      owner.cookie,
      `/api/v1/settings/personalization/activity-types/${activityType.id}`,
      {
        body: { expectedUpdatedAt: currentActivity.updatedAt, isActive: false },
        method: "PATCH",
      },
    );
    const [retainedActivity] = await sql<{ readonly typeId: string }[]>`
      select activity_type_id::text as "typeId" from crm.activities where id = ${activity.id}`;
    assert(
      disabledActivity.status === 200 &&
        retainedActivity?.typeId === activityType.id,
      "disabling an in-use option retains historical data",
    );

    const globalList = await (await settingsRequest(
      owner.cookie,
      "/api/v1/settings/personalization/pet-categories",
    )).json() as {
      readonly capabilities: { readonly create: boolean };
      readonly entries: readonly { readonly readOnly: boolean }[];
      readonly readOnly: boolean;
    };
    assert(
      globalList.readOnly && !globalList.capabilities.create &&
        globalList.entries.every((entry) => entry.readOnly),
      "global pet categories explicitly declare read-only capabilities",
    );
  },
});

// --- GAP-009 -------------------------------------------------------------

/**
 * A workspace whose only member can be revoked mid-test. The actor is built
 * directly so the use case is exercised without the session layer refusing
 * first.
 */
async function revocableActor(name: string): Promise<{
  readonly memberId: string;
  readonly personId: string;
  readonly role: "owner";
  readonly userId: string;
  readonly workspaceId: string;
}> {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const personId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.users (id, email, first_name, status)
      values (${userId}, ${`${name}@example.test`}, 'Revocable', 'active')
    `;
    await transaction`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      values (${workspaceId}, ${name}, 'active', ${userId})
    `;
    await transaction`
      insert into crm.workspace_members (
        id, workspace_id, user_id, role, status, joined_at
      ) values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
    `;
    await transaction`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name)
      values (${personId}, ${workspaceId}, ${memberId}, 'Revocation subject')
    `;
  });
  return { memberId, personId, role: "owner", userId, workspaceId };
}

async function revokeMembership(memberId: string): Promise<void> {
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${memberId}
  `;
}

Deno.test({
  name:
    "UXD-002C3 GAP-009 a revoked member cannot read or write its own UI state",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        `ui-state-revocation-${crypto.randomUUID()}`,
      );
      const actors = new PostgresActorRevalidation();
      const transaction = new PostgresRegistrationTransaction(connection.db);
      const memberUiState = createRevocableMemberUiState({
        actors,
        repository: new RevocableMemberUiStateRepository(),
        transaction,
      });
      const recentPeople = createRecentPeopleManagement({
        actors,
        repository: new PostgresRecentPeopleRepository(),
        transaction,
      });

      const allowed = await memberUiState.save(actor, { theme: "dark" });
      assert(allowed.status === "ready", "an active member saves UI state");
      const allowedRecent = await recentPeople.record(actor, actor.personId);
      assert(
        allowedRecent.status === "recorded",
        "an active member records a recent person",
      );

      await revokeMembership(actor.memberId);

      const refusedRead = await memberUiState.read(actor);
      const refusedSave = await memberUiState.save(actor, { theme: "light" });
      const refusedRecent = await recentPeople.record(actor, actor.personId);
      assert(
        refusedRead.status === "forbidden" &&
          refusedSave.status === "forbidden" &&
          refusedRecent.status === "forbidden",
        "a revoked member still reached its member preferences",
      );
      const [stored] = await sql<[{ readonly state: string }]>`
        select ui_state::text as state from crm.member_preferences
        where member_id = ${actor.memberId}
      `;
      assert(
        stored?.state.includes('"dark"'),
        "a revoked member overwrote its stored UI state",
      );
    } finally {
      await connection.destroy();
    }
  },
});
Deno.test({
  name: "APP-002E PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
  },
});
