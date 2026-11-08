import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  PostgresPersonProfileRepository,
} from "../../packages/backend/read-models/person-profile/adapters/postgres/person_profile_repository.ts";
import {
  PostgresRegistrationTransaction,
} from "../../packages/backend/modules/workspaces/adapters/postgres/registration_repository.ts";
import {
  PostgresWorkspaceSettings,
} from "../../packages/backend/modules/workspaces/adapters/postgres/settings_management.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";

Deno.test("APR-009 settings resolve member, workspace, and UTC timezone without granting admin access", async () => {
  const url = requireDatabaseUrl();
  const sql = openSql(url, { max: 1 });
  const connection = connectDatabase(url);
  const transaction = new PostgresRegistrationTransaction(connection.db);
  const repository = new PostgresWorkspaceSettings();
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const foreign = crypto.randomUUID();
  const input = {
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "de-DE",
    measurementSystem: "metric" as const,
    temperatureScale: "celsius" as const,
  };
  const read = () =>
    transaction.run(
      (transaction) => repository.getPreferences({ ...actor, transaction }),
      { workspaceId: actor.workspaceId },
    );
  try {
    await sql`insert into crm.users (id, email) values (${actor.userId}, ${`${actor.userId}@example.test`})`;
    await sql`insert into crm.workspaces (id, name) values (${actor.workspaceId}, 'Time preferences'), (${foreign}, 'Other workspace')`;
    await sql`insert into crm.workspace_members (id, workspace_id, user_id) values (${actor.memberId}, ${actor.workspaceId}, ${actor.userId})`;
    await sql`insert into crm.member_preferences (member_id, locale) values (${actor.memberId}, 'de-DE')`;
    await sql`insert into crm.workspace_settings (workspace_id, default_timezone, default_locale) values (${actor.workspaceId}, 'Europe/Belgrade', 'fr-FR'), (${foreign}, 'Asia/Tokyo', 'ja-JP')`;
    const inherited = await read() as (Awaited<ReturnType<typeof read>> & {
      effectiveTimezone: string;
    });
    assert(
      inherited?.effectiveTimezone === "Europe/Belgrade",
      "ordinary member must inherit the selected workspace timezone",
    );
    assert(
      inherited.locale === "de-DE" && inherited.timezone === undefined,
      "read must preserve saved locale and unset editable timezone",
    );
    assert(
      await transaction.run(
        (transaction) => repository.getWorkspace({ ...actor, transaction }),
        { workspaceId: actor.workspaceId },
      ) === "forbidden",
      "preference read does not grant workspace management",
    );
    const saved = await transaction.run(
      (transaction) =>
        repository.updatePreferences({ ...actor, ...input, transaction }),
      { workspaceId: actor.workspaceId },
    ) as typeof inherited;
    assert(
      saved.effectiveTimezone === "Europe/Belgrade" &&
        saved.timezone === undefined,
      "save must not turn inheritance into an override",
    );
    await sql`update crm.member_preferences set timezone = 'America/Los_Angeles' where member_id = ${actor.memberId}`;
    assert(
      (await read() as typeof inherited).effectiveTimezone ===
        "America/Los_Angeles",
      "explicit member timezone takes precedence",
    );
    await sql`update crm.member_preferences set timezone = null where member_id = ${actor.memberId}`;
    await sql`update crm.workspace_settings set default_timezone = null where workspace_id = ${actor.workspaceId}`;
    assert(
      (await read() as typeof inherited).effectiveTimezone === "UTC",
      "no member or workspace timezone resolves to UTC",
    );
    for (
      const forged of [{ workspaceId: foreign }, {
        userId: crypto.randomUUID(),
      }, { memberId: crypto.randomUUID() }]
    ) {
      assert(
        await transaction.run(
          (transaction) =>
            repository.getPreferences({ ...actor, ...forged, transaction }),
          { workspaceId: actor.workspaceId },
        ) === undefined,
        "forged membership must not expose settings",
      );
    }
    const personId = crypto.randomUUID();
    await sql`insert into crm.people (id, workspace_id, given_name) values (${personId}, ${actor.workspaceId}, 'Calendar person')`;
    await sql`insert into crm.life_events (workspace_id, person_id, name, year, month, day, precision, happened_at) values
      (${actor.workspaceId}, ${personId}, 'Calendar full', 2026, 9, 5, 'full', null),
      (${actor.workspaceId}, ${personId}, 'Month and day', null, 2, 29, 'month_day', null),
      (${actor.workspaceId}, ${personId}, 'Actual instant', null, null, null, 'full', '2026-09-04T22:10:00Z')`;
    const timeline = new PostgresPersonProfileRepository(connection.db);
    const events = await timeline.listTimeline({
      ...actor,
      personId,
      limit: 20,
    });
    assert("items" in events, "timeline is readable by its member");
    const calendar = events.items.find((event) =>
      event.title === "Calendar full"
    ) as unknown as {
      calendarDate?: { year?: number; month?: number; day?: number };
    };
    assert(
      calendar.calendarDate?.year === 2026 &&
        calendar.calendarDate?.month === 9 && calendar.calendarDate?.day === 5,
      "component-backed full date must be distinct from an instant",
    );
    const partial = events.items.find((event) =>
      event.title === "Month and day"
    ) as unknown as {
      datePrecision: string;
      calendarDate?: { year?: number; month?: number; day?: number };
    };
    assert(
      partial.datePrecision === "month_day" &&
        partial.calendarDate?.year === undefined &&
        partial.calendarDate?.month === 2 && partial.calendarDate?.day === 29,
      "partial calendar components survive without an invented year",
    );
    assert(
      !("calendarDate" in
        events.items.find((event) => event.title === "Actual instant")!),
      "actual timestamp remains an instant",
    );
    assert(
      // The actor's standing is the read model's question now, so the
      // repository conceals another workspace's person as absent.
      (await timeline.listTimeline({
        ...actor,
        workspaceId: foreign,
        personId,
        limit: 20,
      })).status === "not-found",
      "calendar details stay tenant isolated",
    );
    await sql`update crm.workspace_members set status = 'suspended' where id = ${actor.memberId}`;
    assert(
      await read() === undefined,
      "suspended membership cannot read preferences",
    );
  } finally {
    await sql`delete from crm.workspaces where id in (${actor.workspaceId}, ${foreign})`;
    await sql`delete from crm.users where id = ${actor.userId}`;
    await sql.end();
    await connection.destroy();
  }
});
