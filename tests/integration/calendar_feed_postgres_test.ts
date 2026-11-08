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
import {
  type CalendarFeedCriteria,
  createCalendarFeed,
} from "../../packages/backend/read-models/calendar-feed/public.ts";
import { createCalendarFeedPublication } from "../../packages/backend/modules/integrations/public.ts";
import { createCalendarFeedRoutes } from "../../packages/backend/modules/integrations/transport/http/calendar_feed.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  apiTokenAuditFrom,
  createCalendarFeedTokens,
} from "../../packages/backend/modules/api-access/public.ts";
import {
  PostgresApiTokenRepository,
  PostgresApiTokenTransaction,
  PostgresCalendarFeedRepository as PostgresFeedTokenRepository,
} from "../../packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts";
import { WebCryptoApiTokenSecrets } from "../../packages/backend/modules/api-access/adapters/crypto/api_token_secrets.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import {
  addMembership,
  assertCrossWorkspaceRefused,
  revokeMembership,
} from "../support/database.ts";
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
      day, precision, updated_at, workspace_id)
    values (${id}, ${personId}, ${value.kind ?? "custom"},
      ${value.label ?? null}, ${value.year ?? null}, ${value.month},
      ${value.day}, ${value.year === undefined ? "month_day" : "full"},
      '2026-09-01T08:00:00Z', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
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
      deliver_at, channel, status, workspace_id)
    values (${reminderId}, ${memberId}, ${occursOn},
      ${occursOn}::date + time '09:00', ${options.channel ?? "in_app"},
      ${
    options.status ?? "pending"
  }, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
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
  const held = await fetchFeed(url);
  const heldTag = held.headers.get("etag");
  assert(heldTag, "the old link's last tag");
  await held.body?.cancel();
  const rotated = await api.request(
    fixture,
    "/api/v1/settings/calendar-feed/rotation",
    "POST",
  );
  assertEquals(rotated.status, 201);
  const next = (await rotated.json() as { url: string }).url;
  assert(next !== url, "rotation mints a new secret");
  assertEquals((await fetchFeed(url)).status, 404, "the old link is dead");
  assertEquals(
    (await fetchFeed(url, { "If-None-Match": heldTag })).status,
    404,
    "even presenting its last tag, never 304",
  );
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
  // A reminder in the foreign workspace cannot name the reader's member: the
  // database refuses the occurrence (ADR 0008), so the feed never meets it.
  const smuggled = await reminder(foreign, theirs, "Smuggled reminder");
  await assertCrossWorkspaceRefused(
    () => occurrence(smuggled, fixture.memberId, day(4)),
    "a foreign reminder's occurrence for the reader's member",
  );

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
      deliver_at, channel, status, next_attempt_at, workspace_id)
    values (${paused}, ${fixture.memberId}, ${day(3)},
      ${
    day(3)
  }::date + time '09:00', 'in_app', 'retry', now(), (select scope.workspace_id from crm.reminders scope where scope.id = ${paused}::uuid))
  `;
  // A day already delivered stays: it is visible history.
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, sent_at, provider_result_state,
      provider_receipt, provider_effect_at, visible_at, workspace_id)
    values (${paused}, ${fixture.memberId}, ${day(-2)},
      ${day(-2)}::date + time '09:00', 'in_app', 'sent', now(), 'confirmed',
      'in-app', now(), now(), (select scope.workspace_id from crm.reminders scope where scope.id = ${paused}::uuid))
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

/** The feed read model's repository, counting the statement that renders. */
class CountingFeedRepository extends PostgresCalendarFeedRepository {
  renders = 0;
  override async read(criteria: CalendarFeedCriteria) {
    this.renders += 1;
    return await super.read(criteria);
  }
}

Deno.test("[INTEGRATION-002] BEQ-14 a matching tag answers 304 without running the feed statement", async () => {
  const fixture = await owner("feed-validator");
  const ada = await person(fixture, "Ada");
  const dateId = await date(ada, { day: 9, label: "Launch", month: 9 });
  const remind = await reminder(fixture, ada, "Call Ada");
  await occurrence(remind, fixture.memberId, day(3));
  const actors = new PostgresActorRevalidation();
  const tokens = createCalendarFeedTokens({
    actorContext: actors,
    actors,
    audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
    calendarFeeds: new PostgresFeedTokenRepository(),
    clock: { now: () => new Date() },
    ids: { next: () => crypto.randomUUID() },
    repository: new PostgresApiTokenRepository(),
    secrets: new WebCryptoApiTokenSecrets(),
    transaction: new PostgresApiTokenTransaction(connection.db),
  });
  const repository = new CountingFeedRepository(connection.db);
  const routes = createCalendarFeedRoutes({
    calendarFeed: createCalendarFeedPublication({
      authority: tokens,
      origin: ORIGIN,
      source: createCalendarFeed({
        actors,
        clock: { now: () => new Date() },
        repository,
        transaction: new PostgresPeopleTransaction(connection.db),
      }),
    }),
  });
  const created = await tokens.create({ ...fixture, role: "owner" });
  assert(created.status === "created", "feed minted");
  const url = `${ORIGIN}/api/v1/calendar-feeds/${created.secret}.ics`;
  const poll = (headers: Record<string, string> = {}) =>
    routes.request(url, { headers });

  const first = await poll();
  assertEquals(first.status, 200);
  const body = await first.text();
  const tag = first.headers.get("etag");
  assert(tag && /^"[A-Za-z0-9_-]{43}"$/.test(tag), `a strong tag: ${tag}`);
  assertEquals(repository.renders, 1, "the first poll renders the feed");

  const unchanged = await poll({ "If-None-Match": tag });
  assertEquals(unchanged.status, 304, "nothing changed");
  assertEquals(await unchanged.text(), "");
  assertEquals(unchanged.headers.get("etag"), tag);
  assertEquals(
    unchanged.headers.get("cache-control"),
    "private, max-age=300",
  );
  assertEquals(repository.renders, 1, "a 304 never runs the feed statement");

  const again = await poll();
  assertEquals(again.headers.get("etag"), tag, "the tag is stable");
  assertEquals(await again.text(), body, "for the same body");
  assertEquals(repository.renders, 2);

  const changes = [
    () =>
      sql`update crm.person_dates set label = 'Relaunch', updated_at = now()
      where id = ${dateId}`,
    () =>
      sql`update crm.people set given_name = 'Augusta', updated_at = now()
      where id = ${ada}`,
    () =>
      sql`update crm.reminders set title = 'Write to Ada', updated_at = now()
      where id = ${remind}`,
    () =>
      sql`update crm.reminder_occurrences set status = 'cancelled'
      where reminder_id = ${remind}`,
    () => sql`delete from crm.person_dates where id = ${dateId}`,
    () =>
      sql`update crm.workspaces set name = 'Renamed circle'
      where id = ${fixture.workspaceId}`,
    // A zone whose today is not UTC's right now: UTC+14 is a day ahead from
    // 10:00 UTC, and UTC-12 a day behind until 12:00 UTC.
    () =>
      sql`update crm.member_preferences set timezone = ${
        new Date().getUTCHours() >= 10 ? "Pacific/Kiritimati" : "Etc/GMT+12"
      } where member_id = ${fixture.memberId}`,
  ];
  let previous = tag;
  for (const [index, change] of changes.entries()) {
    await change();
    const changed = await poll({ "If-None-Match": previous });
    const next = changed.headers.get("etag");
    const text = await changed.text();
    assertEquals(changed.status, 200, `change ${index} is answered in full`);
    assert(next && next !== previous, `change ${index} moves the tag`);
    assert(text.startsWith("BEGIN:VCALENDAR"), `change ${index} renders`);
    previous = next;
  }
});

/**
 * A person whose one reminder occurs in three days, every row stamped with
 * `changedAt`, so a test decides which row holds the feed's latest change.
 */
async function remindedPerson(
  fixture: { readonly memberId: string; readonly workspaceId: string },
  givenName: string,
  changedAt: string,
  archived = false,
): Promise<{ readonly person: string; readonly reminder: string }> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.people (id, workspace_id, created_by_member_id, given_name,
      archived_at, updated_at)
    values (${id}, ${fixture.workspaceId}, ${fixture.memberId}, ${givenName},
      ${archived ? changedAt : null}, ${changedAt})
  `;
  const reminderId = crypto.randomUUID();
  await sql`
    insert into crm.reminders (id, workspace_id, person_id, target_kind, title,
      anchor_on, created_by_member_id, updated_at)
    values (${reminderId}, ${fixture.workspaceId}, ${id}, 'person',
      ${`Call ${givenName}`}, current_date, ${fixture.memberId}, ${changedAt})
  `;
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, updated_at, workspace_id)
    values (${reminderId}, ${fixture.memberId}, ${day(3)},
      ${
    day(3)
  }::date + time '09:00', 'in_app', 'pending', ${changedAt}, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
  `;
  return { person: id, reminder: reminderId };
}

Deno.test("[INTEGRATION-002] BEQ-14 swapping which people are archived moves the tag while another row holds the latest change", async () => {
  const fixture = await owner("feed-swap");
  const alpha = await remindedPerson(fixture, "Alpha", "2026-02-01T00:00:00Z");
  const bravo = await remindedPerson(
    fixture,
    "Bravo",
    "2026-02-01T00:00:00Z",
    true,
  );
  // Charlie's rows hold the latest change before and after the swap.
  await remindedPerson(fixture, "Charlie", "2099-01-01T00:00:00Z");
  const url = await createFeed(fixture);
  const first = await fetchFeed(url);
  const tag = first.headers.get("etag");
  const before = await first.text();
  assert(tag, "a tag");
  assert(before.includes("SUMMARY:Call Alpha\r\n"), before);
  assert(!before.includes("SUMMARY:Call Bravo\r\n"), before);

  await sql`
    update crm.people set archived_at = now(), updated_at = now()
    where id = ${alpha.person}
  `;
  await sql`
    update crm.people set archived_at = null, updated_at = now()
    where id = ${bravo.person}
  `;
  const polled = await fetchFeed(url, { "If-None-Match": tag });
  assertEquals(polled.status, 200, "a changed feed is answered in full");
  assert(polled.headers.get("etag") !== tag, "with a new tag");
  const after = await polled.text();
  assert(after.includes("SUMMARY:Call Bravo\r\n"), after);
  assert(!after.includes("SUMMARY:Call Alpha\r\n"), after);
});

Deno.test("[INTEGRATION-002] BEQ-14 a published row rewritten with an older change moves the tag", async () => {
  const fixture = await owner("feed-older");
  const ada = await remindedPerson(fixture, "Ada", "2026-03-01T00:00:00Z");
  await remindedPerson(fixture, "Charlie", "2099-01-01T00:00:00Z");
  const birthday = await date(ada.person, {
    day: 4,
    label: "Launch",
    month: 4,
  });
  const url = await createFeed(fixture);
  let tag = (await fetchFeed(url)).headers.get("etag");
  assert(tag, "a tag");
  // As a Monica import does: the source's own, older `updated_at`.
  const rewrites = [
    () =>
      sql`update crm.reminders set title = 'Write to Ada',
        updated_at = '2026-01-15T00:00:00Z' where id = ${ada.reminder}`,
    () =>
      sql`update crm.person_dates set label = 'Relaunch',
        updated_at = '2026-01-15T00:00:00Z' where id = ${birthday}`,
  ];
  for (const [index, rewrite] of rewrites.entries()) {
    await rewrite();
    const polled = await fetchFeed(url, { "If-None-Match": tag });
    assertEquals(polled.status, 200, `rewrite ${index} is answered in full`);
    const next = polled.headers.get("etag");
    assert(next && next !== tag, `rewrite ${index} moves the tag`);
    await polled.body?.cancel();
    tag = next;
  }
});

Deno.test("[INTEGRATION-002] the feed stops at its event cap and says so", async () => {
  const fixture = await owner("feed-cap");
  const ada = await person(fixture, "Ada");
  await sql`
    insert into crm.person_dates (person_id, kind, label, month, day,
      precision, workspace_id)
    select ${ada}, 'custom', 'Day ' || series, 1 + series % 12,
      1 + series % 28, 'month_day',
        (select scope.workspace_id from crm.people scope where scope.id = ${ada})
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
        precision, workspace_id)
      select ${ada}, 'custom', md5(series::text), 1 + series % 12,
        1 + series % 28, 'month_day',
        (select scope.workspace_id from crm.people scope where scope.id = ${ada})
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

Deno.test("[INTEGRATION-002] REL-067 a feed's fetches write its use at most once per 15 minutes", async () => {
  const fixture = await owner("feed-use");
  const start = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  let now = start;
  const actors = new PostgresActorRevalidation();
  const feeds = createCalendarFeedTokens({
    actorContext: actors,
    actors,
    audit: apiTokenAuditFrom(new PostgresAuditEventRecorder()),
    calendarFeeds: new PostgresFeedTokenRepository(),
    clock: { now: () => now },
    ids: { next: () => crypto.randomUUID() },
    repository: new PostgresApiTokenRepository(),
    secrets: new WebCryptoApiTokenSecrets(),
    transaction: new PostgresApiTokenTransaction(connection.db),
  });
  const created = await feeds.create({ ...fixture, role: "owner" });
  assert(created.status === "created", "feed minted");
  const fetchAt = async (minutes: number) => {
    now = new Date(start.getTime() + minutes * 60_000);
    const accepted = await feeds.authenticate(created.secret);
    const [row] = await sql<{ last_used_at: Date | null; updated_at: Date }[]>`
      select last_used_at, updated_at from crm.api_tokens
      where id = ${created.feed.id}::uuid
    `;
    return {
      lastUsedAt: row?.last_used_at?.getTime(),
      status: accepted.status,
      updatedAt: row?.updated_at.getTime(),
    };
  };
  const minute = (value: number) => start.getTime() + value * 60_000;

  assertEquals(await fetchAt(1), {
    lastUsedAt: minute(1),
    status: "authenticated",
    updatedAt: minute(1),
  }, "the first fetch is recorded");
  assertEquals(await fetchAt(15), {
    lastUsedAt: minute(1),
    status: "authenticated",
    updatedAt: minute(1),
  }, "a fetch within 15 minutes is accepted but not written");
  assertEquals(await fetchAt(17), {
    lastUsedAt: minute(17),
    status: "authenticated",
    updatedAt: minute(17),
  }, "a fetch after 15 minutes is recorded");
});

Deno.test("[INTEGRATION-002] closes its connections", async () => {
  await Promise.all([sql.end(), connection.destroy(), configured.close()]);
});
