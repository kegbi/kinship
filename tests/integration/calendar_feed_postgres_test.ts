/**
 * The calendar feed against real PostgreSQL (GAP-052, `INTEGRATION-002`).
 *
 * Every case drives the configured API the way a calendar application does:
 * the settings routes mint the secret under a session, and the feed is then
 * fetched with no cookie at all. Rows the feed must leave out — another
 * workspace's, an archived or deleted person's, a cancelled occurrence,
 * another member's, a day outside the window — sit beside the rows it must
 * publish, so each assertion observes both.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  CALENDAR_FEED_STATEMENT_TIMEOUT_MS,
  PostgresCalendarFeedRepository,
} from "../../packages/backend/read-models/calendar-feed/adapters/postgres/calendar_feed_repository.ts";
import { createCalendarFeed } from "../../packages/backend/read-models/calendar-feed/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { addMembership, revokeMembership } from "../support/database.ts";
import {
  apiSupport,
  ORIGIN,
  type SignedInFixture,
  workspaceHeaders,
} from "../support/api.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const connection = connectDatabase(databaseUrl);
const mail = new CapturedVerificationMail();
const logLines: string[] = [];
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  true,
  jsonLogger((line) => void logLines.push(line)),
);
const api = apiSupport(configured.app, mail, sql);

/** A new owner in their own workspace, on UTC. */
async function owner(name: string): Promise<SignedInFixture> {
  const fixture = await api.register(
    `${name}-${crypto.randomUUID()}@example.test`,
    `${name} circle`,
    { firstName: "Feed", lastName: "Owner" },
  );
  await sql`
    update crm.member_preferences set timezone = 'UTC'
    where member_id = ${fixture.memberId}
  `;
  return fixture;
}

async function person(
  fixture: { readonly memberId: string; readonly workspaceId: string },
  givenName: string,
  familyName: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.people (id, workspace_id, created_by_member_id,
      given_name, family_name)
    values (${id}, ${fixture.workspaceId}, ${fixture.memberId}, ${givenName},
      ${familyName})
  `;
  return id;
}

async function date(
  personId: string,
  value: {
    readonly day: number;
    readonly kind?: string;
    readonly label?: string;
    readonly month: number;
    readonly year?: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.person_dates (id, person_id, kind, label, year, month,
      day, precision, updated_at)
    values (${id}, ${personId}, ${value.kind ?? "custom"},
      ${value.label ?? null}, ${value.year ?? null}, ${value.month},
      ${value.day}, ${value.year === undefined ? "month_day" : "full"},
      '2026-09-01T08:00:00Z')
  `;
  return id;
}

async function reminder(
  fixture: { readonly memberId: string; readonly workspaceId: string },
  personId: string,
  title: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.reminders (id, workspace_id, person_id, target_kind, title,
      anchor_on, created_by_member_id, updated_at)
    values (${id}, ${fixture.workspaceId}, ${personId}, 'person', ${title},
      current_date, ${fixture.memberId}, '2026-09-02T08:00:00Z')
  `;
  return id;
}

/** `YYYY-MM-DD`, this many days from today in UTC. */
function day(offset: number): string {
  const today = new Date();
  return new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + offset,
  )).toISOString().slice(0, 10);
}

async function occurrence(
  reminderId: string,
  memberId: string,
  occursOn: string,
  options: { readonly channel?: string; readonly status?: string } = {},
): Promise<void> {
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status)
    values (${reminderId}, ${memberId}, ${occursOn},
      ${occursOn}::date + time '09:00', ${options.channel ?? "in_app"},
      ${options.status ?? "pending"})
  `;
}

async function createFeed(fixture: SignedInFixture): Promise<string> {
  const created = await api.request(
    fixture,
    "/api/v1/settings/calendar-feed",
    "POST",
  );
  assertEquals(created.status, 201);
  const body = await created.json() as { url: string };
  assert(
    body.url.startsWith(`${ORIGIN}/api/v1/calendar-feeds/kin_cal_`),
    body.url,
  );
  return body.url;
}

/** A calendar application's fetch: no cookie, no workspace header. */
async function fetchFeed(
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return await configured.app.request(url, { headers });
}

async function feedText(url: string): Promise<string> {
  const response = await fetchFeed(url);
  assertEquals(response.status, 200);
  return await response.text();
}

const uids = (document: string) =>
  [...document.replaceAll("\r\n ", "").matchAll(/^UID:(.*)\r$/gm)].map((
    match,
  ) => match[1]!);

Deno.test("[INTEGRATION-002] a member subscribes, rotates, and revokes; old links answer 404", async () => {
  const fixture = await owner("feed-lifecycle");
  const ada = await person(fixture, "Ada", "Lovelace");
  const birthday = await date(ada, {
    day: 10,
    kind: "birthday",
    month: 12,
    year: 1815,
  });

  const status = await api.request(fixture, "/api/v1/settings/calendar-feed");
  assertEquals(await status.json(), { status: "ready" });
  const url = await createFeed(fixture);
  const document = await feedText(url);
  assert(
    document.includes(`UID:person-date-${birthday}@localhost\r\n`) &&
      document.includes("DTSTART;VALUE=DATE:18151210\r\nRRULE:FREQ=YEARLY") &&
      document.includes("SUMMARY:Ada Lovelace — Birthday\r\n"),
    document,
  );
  const [token] = await sql<{ token_hash: string; scopes: string[] }[]>`
    select token_hash, scopes from crm.api_tokens
    where user_id = ${fixture.userId} and revoked_at is null
  `;
  assertEquals(token?.scopes, ["calendar.read"]);
  assert(!url.includes(token!.token_hash), "only the hash is stored");

  const listed = await api.request(fixture, "/api/v1/settings/calendar-feed");
  const shown = await listed.json() as {
    feed: { createdAt: string; lastUsedAt?: string };
  };
  assert(shown.feed.lastUsedAt, "the fetch recorded its use");
  assert(
    !JSON.stringify(shown).includes("kin_cal_"),
    "the URL is not shown again",
  );
  const tokens = await api.request(fixture, "/api/v1/settings/api-tokens");
  assertEquals(
    (await tokens.json() as { records: unknown[] }).records,
    [],
    "a feed is not a personal access token",
  );
  const secret = url.slice(url.lastIndexOf("/") + 1, -".ics".length);
  const bearer = await configured.app.request(`${ORIGIN}/api/v1/people`, {
    headers: { authorization: `Bearer ${secret}` },
  });
  assertEquals(bearer.status, 401, "a feed secret cannot read the directory");

  assertEquals(
    (await api.request(fixture, "/api/v1/settings/calendar-feed", "POST"))
      .status,
    409,
    "one live feed per member and workspace",
  );
  const rotated = await api.request(
    fixture,
    "/api/v1/settings/calendar-feed/rotation",
    "POST",
  );
  assertEquals(rotated.status, 201);
  const next = (await rotated.json() as { url: string }).url;
  assert(next !== url, "rotation mints a new secret");
  assertEquals((await fetchFeed(url)).status, 404, "the old link is dead");
  assertEquals((await fetchFeed(next)).status, 200);

  assertEquals(
    (await api.request(fixture, "/api/v1/settings/calendar-feed", "DELETE"))
      .status,
    200,
  );
  const revoked = await fetchFeed(next);
  assertEquals(revoked.status, 404);
  assertEquals((await revoked.json()).code, "calendar_feed_not_found");
  assertEquals(
    (await api.request(fixture, "/api/v1/settings/calendar-feed", "DELETE"))
      .status,
    404,
  );

  const audit = await sql<{ action: string; payload: unknown }[]>`
    select action, payload from crm.audit_events
    where workspace_id = ${fixture.workspaceId}
      and subject_type = 'api_token' order by occurred_at, action
  `;
  assertEquals(
    audit.map((row) => row.action),
    [
      "api-token-created",
      "api-token-created",
      "api-token-revoked",
      "api-token-revoked",
    ],
  );
});

Deno.test("[INTEGRATION-002] a personal token, a member who left, and a foreign workspace see nothing", async () => {
  const fixture = await owner("feed-scope");
  const foreign = await owner("feed-foreign");
  const mine = await person(fixture, "Mine");
  await date(mine, { day: 1, label: "Mine day", month: 3 });
  const theirs = await person(foreign, "Theirs");
  const theirDate = await date(theirs, { day: 2, label: "Theirs", month: 3 });
  const theirReminder = await reminder(foreign, theirs, "Foreign reminder");
  await occurrence(theirReminder, foreign.memberId, day(3));
  // A reminder in the foreign workspace that names the reader's member.
  const smuggled = await reminder(foreign, theirs, "Smuggled reminder");
  await occurrence(smuggled, fixture.memberId, day(4));

  const url = await createFeed(fixture);
  const document = await feedText(url);
  assert(!document.includes(theirDate), "another workspace's date");
  assert(!document.includes("Foreign reminder"), document);
  assert(!document.includes("Smuggled reminder"), document);
  assert(document.includes("Mine — Mine day"), document);

  const pat = await api.request(
    fixture,
    "/api/v1/settings/api-tokens",
    "POST",
    { name: "Reader", scopes: ["people:read"] },
  );
  const personal = (await pat.json() as { secret: string }).secret;
  const asFeed = await fetchFeed(
    `${ORIGIN}/api/v1/calendar-feeds/${
      personal.replace("kin_pat_", "kin_cal_")
    }.ics`,
  );
  assertEquals(asFeed.status, 404, "a people:read token is out of scope");

  const invited = await addMembership(
    sql,
    foreign.userId,
    fixture.workspaceId,
    "member",
  );
  await sql`
    update crm.member_preferences set timezone = 'UTC'
    where member_id = ${invited}
  `;
  const invitedSession = await api.signIn(
    // The foreign owner signs in to the reader's workspace as a member.
    (await sql<{ email: string }[]>`
      select email from crm.users where id = ${foreign.userId}
    `)[0]!.email,
    { workspaceId: fixture.workspaceId },
  );
  const cookie = invitedSession.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "the member signs in");
  const memberFeed = await configured.app.request(
    `${ORIGIN}/api/v1/settings/calendar-feed`,
    {
      headers: workspaceHeaders(
        { cookie, workspaceId: fixture.workspaceId },
        { method: "POST" },
      ),
      method: "POST",
    },
  );
  assertEquals(memberFeed.status, 201, "a plain member manages their own feed");
  const memberUrl = (await memberFeed.json() as { url: string }).url;
  assert(
    (await feedText(memberUrl)).includes("Mine — Mine day"),
    "a member's feed shows the workspace's dates",
  );
  assert(
    !(await feedText(memberUrl)).includes("Smuggled reminder"),
    "and never the other workspace's rows",
  );
  await revokeMembership(sql, invited);
  assertEquals(
    (await fetchFeed(memberUrl)).status,
    404,
    "a member who left reads nothing",
  );
  assertEquals((await fetchFeed(url)).status, 200, "the owner still does");
});

Deno.test("[INTEGRATION-002] archived and deleted people drop out; deceased people and Feb 29 stay", async () => {
  const fixture = await owner("feed-people");
  const archived = await person(fixture, "Archived");
  const deleted = await person(fixture, "Deleted");
  const deceased = await person(fixture, "Grace", "Hopper");
  const leap = await person(fixture, "Leap");
  const archivedDate = await date(archived, { day: 5, label: "A", month: 5 });
  const deletedDate = await date(deleted, { day: 6, label: "D", month: 6 });
  const deceasedDate = await date(deceased, {
    day: 1,
    kind: "deceased",
    month: 1,
    year: 1992,
  });
  const leapDate = await date(leap, {
    day: 29,
    kind: "birthday",
    month: 2,
  });
  const archivedReminder = await reminder(fixture, archived, "Archived call");
  await occurrence(archivedReminder, fixture.memberId, day(2));
  await sql`update crm.people set is_deceased = true where id = ${deceased}`;
  await sql`update crm.people set archived_at = now() where id = ${archived}`;
  await sql`update crm.people set deleted_at = now() where id = ${deleted}`;

  const document = await feedText(await createFeed(fixture));
  const published = uids(document);
  assert(!published.some((uid) => uid.includes(archivedDate)), document);
  assert(!published.some((uid) => uid.includes(deletedDate)), document);
  assert(!document.includes("Archived call"), document);
  assert(
    published.includes(`person-date-${deceasedDate}@localhost`) &&
      document.includes("SUMMARY:Grace Hopper — Date of death"),
    "a deceased person keeps their dates",
  );
  assert(
    published.includes(`person-date-${leapDate}@localhost`) &&
      document.includes("DTSTART;VALUE=DATE:20000229\r\nRRULE:FREQ=YEARLY\r\n"),
    "Feb 29 recurs on its own day from a leap placeholder year",
  );
  assert(
    document.includes("Year unknown\\; 2000 is only a placeholder."),
    document,
  );
});

Deno.test("[INTEGRATION-002] reminder days follow the window, the member, and one event per day", async () => {
  const fixture = await owner("feed-window");
  const other = await owner("feed-colleague");
  const colleague = await addMembership(
    sql,
    other.userId,
    fixture.workspaceId,
    "member",
  );
  const ada = await person(fixture, "Ada");
  const call = await reminder(fixture, ada, "Call Ada");
  await occurrence(call, fixture.memberId, day(-31));
  await occurrence(call, fixture.memberId, day(-30));
  await occurrence(call, fixture.memberId, day(0));
  await occurrence(call, fixture.memberId, day(0), { channel: "email" });
  await occurrence(call, fixture.memberId, day(7), { status: "cancelled" });
  await occurrence(call, fixture.memberId, day(8), { status: "skipped" });
  await occurrence(call, fixture.memberId, day(365));
  await occurrence(call, fixture.memberId, day(366));
  await occurrence(call, colleague, day(9));
  // A person-date reminder is the yearly date event already.
  const birthday = await date(ada, { day: 3, kind: "birthday", month: 4 });
  const dated = crypto.randomUUID();
  await sql`
    insert into crm.reminders (id, workspace_id, person_id, person_date_id,
      target_kind, title, anchor_on, recurrence_unit)
    values (${dated}, ${fixture.workspaceId}, ${ada}, ${birthday},
      'person_date', 'Birthday', current_date, 'year')
  `;
  await occurrence(dated, fixture.memberId, day(1));

  const document = await feedText(await createFeed(fixture));
  const reminders = uids(document).filter((uid) => uid.startsWith("reminder-"));
  assertEquals(
    reminders,
    [day(-30), day(0), day(365)].map((on) =>
      `reminder-${call}-${on}@localhost`
    ),
    "30 days back to 365 ahead, cancelled and skipped left out, channels collapsed",
  );
  assert(
    document.includes(
      `DTSTART;VALUE=DATE:${
        day(0).replaceAll("-", "")
      }\r\nSUMMARY:Call Ada\r\n`,
    ),
    document,
  );
  assert(!document.includes(`reminder-${dated}`), "no person-date reminder");
});

Deno.test("[INTEGRATION-002] a paused reminder keeps only the days it was delivered, as Today does", async () => {
  const fixture = await owner("feed-paused");
  const ada = await person(fixture, "Ada");
  const paused = await reminder(fixture, ada, "Paused call");
  await sql`
    update crm.reminders set is_active = false where id = ${paused}
  `;
  await occurrence(paused, fixture.memberId, day(2), { status: "failed" });
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, next_attempt_at)
    values (${paused}, ${fixture.memberId}, ${day(3)},
      ${day(3)}::date + time '09:00', 'in_app', 'retry', now())
  `;
  // A day already delivered stays: it is visible history.
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, sent_at, provider_result_state,
      provider_receipt, provider_effect_at, visible_at)
    values (${paused}, ${fixture.memberId}, ${day(-2)},
      ${day(-2)}::date + time '09:00', 'in_app', 'sent', now(), 'confirmed',
      'in-app', now(), now())
  `;
  const document = await feedText(await createFeed(fixture));
  assertEquals(
    uids(document).filter((uid) => uid.startsWith("reminder-")),
    [`reminder-${paused}-${day(-2)}@localhost`],
    "only the delivered day of a paused reminder is published",
  );
});

Deno.test("[INTEGRATION-002] an unchanged feed answers 304 and a change moves its tag", async () => {
  const fixture = await owner("feed-etag");
  const ada = await person(fixture, "Ada");
  const dateId = await date(ada, { day: 9, label: "Launch", month: 9 });
  const url = await createFeed(fixture);
  const first = await fetchFeed(url);
  const tag = first.headers.get("etag");
  assert(tag && /^"[A-Za-z0-9_-]{43}"$/.test(tag), `a strong tag: ${tag}`);
  assertEquals(first.headers.get("cache-control"), "private, max-age=300");
  assertEquals(
    first.headers.get("content-type"),
    "text/calendar; charset=utf-8",
  );
  const again = await fetchFeed(url);
  assertEquals(
    again.headers.get("etag"),
    tag,
    "the same content, the same tag",
  );
  await again.body?.cancel();
  const unchanged = await fetchFeed(url, { "If-None-Match": tag });
  assertEquals(unchanged.status, 304);
  assertEquals(await unchanged.text(), "");
  await sql`
    update crm.person_dates set label = 'Relaunch', updated_at = now()
    where id = ${dateId}
  `;
  const changed = await fetchFeed(url, { "If-None-Match": tag });
  assertEquals(changed.status, 200, "an edit is a new body");
  assert(changed.headers.get("etag") !== tag, "and a new tag");
  assert((await changed.text()).includes("Ada — Relaunch"), "the new label");
});

Deno.test("[INTEGRATION-002] the feed stops at its event cap and says so", async () => {
  const fixture = await owner("feed-cap");
  const ada = await person(fixture, "Ada");
  await sql`
    insert into crm.person_dates (person_id, kind, label, month, day,
      precision)
    select ${ada}, 'custom', 'Day ' || series, 1 + series % 12,
      1 + series % 28, 'month_day'
    from generate_series(1, 2001) series
  `;
  const document = await feedText(await createFeed(fixture));
  assertEquals(uids(document).length, 2000, "the first 2000 events only");
  assert(
    document.includes(
      "X-KINSHIP-TRUNCATED:Only the first 2000 events are included.\r\n",
    ),
    "the cut is stated in the calendar",
  );
});

Deno.test({
  name:
    "[INTEGRATION-002] a feed read past its statement timeout is unavailable and leaks no setting",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fixture = await owner("feed-timeout");
    const ada = await person(fixture, "Ada");
    await sql`
      insert into crm.person_dates (person_id, kind, label, month, day,
        precision)
      select ${ada}, 'custom', md5(series::text), 1 + series % 12,
        1 + series % 28, 'month_day'
      from generate_series(1, 60000) series
    `;
    const feed = createCalendarFeed({
      actors: new PostgresActorRevalidation(),
      clock: { now: () => new Date() },
      repository: new PostgresCalendarFeedRepository(connection.db, {
        statementTimeoutMs: 1,
      }),
      transaction: new PostgresPeopleTransaction(connection.db),
    });
    assertEquals(
      await feed.read({ ...fixture, role: "owner" }),
      { status: "unavailable" },
    );
    assertEquals(
      CALENDAR_FEED_STATEMENT_TIMEOUT_MS,
      1500,
      "the production bound",
    );
    const settings = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          sql`show statement_timeout`.then((rows) =>
            rows[0]?.statement_timeout
          ),
      ),
    );
    assert(settings.every((value) => value === "0"), `leaked: ${settings}`);
    const bounded = createCalendarFeed({
      actors: new PostgresActorRevalidation(),
      clock: { now: () => new Date() },
      repository: new PostgresCalendarFeedRepository(connection.db),
      transaction: new PostgresPeopleTransaction(connection.db),
    });
    const healthy = await bounded.read({ ...fixture, role: "owner" });
    assert(
      healthy.status === "ready" && healthy.truncated?.limit === 2000,
      "the next read, under the production bound, answers the capped feed",
    );
  },
});

Deno.test("[INTEGRATION-002] the API request log never carries a feed secret", async () => {
  const fixture = await owner("feed-log");
  const url = await createFeed(fixture);
  logLines.length = 0;
  await (await fetchFeed(url)).body?.cancel();
  await (await fetchFeed(`${url.slice(0, -8)}AAAAAAA.ics`)).body?.cancel();
  const secret = url.slice(url.lastIndexOf(".", url.length - 5) + 1, -4);
  assert(secret.length >= 16, "the secret part");
  assertEquals(logLines.length, 2, logLines.join(""));
  for (const line of logLines) {
    assert(!line.includes(secret) && !line.includes("kin_cal_"), line);
    assert(
      line.includes('"route":"/api/v1/calendar-feeds/:feedFile"'),
      line,
    );
  }
});

Deno.test("[INTEGRATION-002] closes its connections", async () => {
  await Promise.all([sql.end(), connection.destroy(), configured.close()]);
});
