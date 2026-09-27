/**
 * Settings preferences (split from `settings_postgres_test.ts`, GAP-035):
 * member preferences, workspace identity, and a revoked member's UI state.
 *
 * Its final test closes the app and pools it loaded from
 * `settings.test-helper.ts`.
 */

import {
  createMemberUiStateManagement as createRevocableMemberUiState,
  createRecentPeopleManagement,
} from "../../packages/backend/modules/workspaces/public.ts";
import { createMemberUiStateManagement } from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  PostgresMemberUiStateRepository,
  PostgresMemberUiStateRepository as RevocableMemberUiStateRepository,
} from "../../packages/backend/modules/workspaces/adapters/postgres/member_ui_state.ts";
import { PostgresRecentPeopleRepository } from "../../packages/backend/modules/workspaces/adapters/postgres/recent_people.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresRegistrationTransaction } from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  configured,
  databaseUrl,
  register,
  settingsRequest,
  signIn,
  sql,
} from "./settings.test-helper.ts";
import { closeResources } from "./settings.test-helper.ts";
import {
  resetDatabase,
  revocableActor,
  revokeMembership,
} from "../support/database.ts";

Deno.test({
  name:
    "AUTH-004 and WORKSPACE-001 real PostgreSQL settings remain atomic, member-owned, and tenant-safe",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql);
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

// --- GAP-009 -------------------------------------------------------------

Deno.test({
  name:
    "UXD-002C3 GAP-009 a revoked member cannot read or write its own UI state",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const connection = connectDatabase(databaseUrl);
    try {
      const actor = await revocableActor(
        sql,
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

      await revokeMembership(sql, actor.memberId);

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
  name: "APP-002E PostgreSQL preferences resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
