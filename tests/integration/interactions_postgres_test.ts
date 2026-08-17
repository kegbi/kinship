import postgres from "postgres";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createInteractionManagement,
  PostgresInteractionRepository,
} from "../../packages/backend/modules/interactions/public.ts";
import {
  PostgresPeopleTransaction,
  PostgresRelationshipPersonBoundary,
} from "../../packages/backend/modules/people/public.ts";
import { PostgresInteractionAudit } from "../../packages/backend/modules/governance/public.ts";
import { PostgresInteractionWorkspaceBoundary } from "../../packages/backend/modules/workspaces/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tamperCursorId(cursor: string): string {
  const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
  const parsed = JSON.parse(atob(normalized.padEnd(
    normalized.length + (4 - normalized.length % 4) % 4,
    "=",
  ))) as Record<string, unknown>;
  return btoa(JSON.stringify({ ...parsed, id: "not-a-uuid" }))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const directConnection = connectDatabase(databaseUrl);
const directInteractions = createInteractionManagement({
  audit: new PostgresInteractionAudit(),
  clock: { now: () => new Date("2026-08-17T12:30:00.000Z") },
  people: new PostgresRelationshipPersonBoundary(),
  repository: new PostgresInteractionRepository(),
  transaction: new PostgresPeopleTransaction(directConnection.db),
  workspace: new PostgresInteractionWorkspaceBoundary(),
});
const password = "correct horse battery staple";

interface Fixture {
  readonly cookie: string;
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

async function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  const registration = await configured.app.request(
    "http://localhost/api/v1/registrations",
    {
      body: JSON.stringify({
        email,
        firstName: "Interaction",
        lastName: "Tester",
        password,
        workspaceName,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  assert(registration.status === 202, "fixture registers");
  const token = mail.latestToken(email);
  assert(token, "verification token captured");
  assert(
    (await configured.app.request(
      "http://localhost/api/v1/email-verifications",
      {
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    )).status === 200,
    "fixture verifies",
  );
  const signed = await configured.app.request(
    "http://localhost/api/v1/sessions",
    {
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      method: "POST",
    },
  );
  const body = await signed.json() as {
    readonly member: { readonly id: string };
    readonly workspace: { readonly id: string };
  };
  const cookie = signed.headers.get("set-cookie")?.split(";")[0];
  assert(signed.status === 200 && cookie, "fixture signs in");
  const membership = await sql<{
    readonly role: "admin" | "member" | "owner";
    readonly user_id: string;
  }[]>`
    select role, user_id::text from crm.workspace_members
    where id = ${body.member.id}::uuid
  `;
  assert(membership[0], "fixture membership resolves its transaction actor");
  return {
    cookie,
    memberId: body.member.id,
    role: membership[0].role,
    userId: membership[0].user_id,
    workspaceId: body.workspace.id,
  };
}

async function createPerson(
  fixture: Fixture,
  givenName: string,
): Promise<string> {
  const response = await configured.app.request(
    "http://localhost/api/v1/people",
    {
      body: JSON.stringify({ givenName, isPartial: false }),
      headers: {
        "content-type": "application/json",
        cookie: fixture.cookie,
        origin: "http://localhost",
        "X-Workspace-Id": fixture.workspaceId,
      },
      method: "POST",
    },
  );
  const body = await response.json() as {
    readonly person: { readonly id: string };
  };
  assert(response.status === 201, `${givenName} created`);
  return body.person.id;
}

async function request(
  fixture: Fixture,
  path: string,
  method: "DELETE" | "GET" | "POST" = "GET",
  body?: unknown,
): Promise<Response> {
  return await configured.app.request(`http://localhost${path}`, {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      cookie: fixture.cookie,
      ...(method !== "GET"
        ? { "content-type": "application/json", origin: "http://localhost" }
        : {}),
      "X-Workspace-Id": fixture.workspaceId,
    },
    method,
  });
}

Deno.test("INTERACTION-001 PostgreSQL persists atomic participants, note favorite, audit, and projections", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `interactions-${suffix}@example.test`,
    "Interactions",
  );
  const foreign = await register(`foreign-${suffix}@example.test`, "Foreign");
  const ada = await createPerson(primary, "Ada");
  const grace = await createPerson(primary, "Grace");
  const outsider = await createPerson(foreign, "Outsider");
  await sql`
    insert into crm.workspace_profile_modules (workspace_id, key, name, is_active)
    values
      (${primary.workspaceId}::uuid, 'activities', 'Activities', false),
      (${primary.workspaceId}::uuid, 'notes', 'Notes', true)
    on conflict (workspace_id, key) do update set is_active = excluded.is_active
  `;
  const noteOnly = await request(primary, "/api/v1/interaction-options");
  const noteOnlyBody = await noteOnly.json() as {
    readonly availability: {
      readonly activity: boolean;
      readonly note: boolean;
    };
  };
  assert(
    noteOnly.status === 200 && !noteOnlyBody.availability.activity &&
      noteOnlyBody.availability.note,
    "activities hidden incorrectly disabled note capture",
  );
  const noteOnlyProfile = await request(primary, `/api/v1/people/${ada}`);
  const noteOnlyProfileBody = await noteOnlyProfile.json() as {
    readonly person: {
      readonly profileSections: readonly {
        readonly id: string;
        readonly status: string;
      }[];
    };
  };
  assert(
    noteOnlyProfile.status === 200 &&
      noteOnlyProfileBody.person.profileSections.some((section) =>
        section.id === "activities" && section.status === "hidden"
      ) &&
      noteOnlyProfileBody.person.profileSections.some((section) =>
        section.id === "notes" && section.status === "ready"
      ),
    "profile did not expose the note-only personalization permutation",
  );
  const hiddenActivity = await request(
    primary,
    "/api/v1/interactions",
    "POST",
    {
      happenedAt: "2026-08-16T18:00:00.000Z",
      kind: "activity",
      participantIds: [ada],
      requestId: crypto.randomUUID(),
      summary: "Must be hidden",
    },
  );
  assert(hiddenActivity.status === 403, "hidden activity capture was accepted");
  await sql`
    update crm.workspace_profile_modules set is_active = key = 'activities'
    where workspace_id = ${primary.workspaceId}::uuid and key in ('activities', 'notes')
  `;
  const activityOnly = await request(primary, "/api/v1/interaction-options");
  const activityOnlyBody = await activityOnly.json() as {
    readonly availability: {
      readonly activity: boolean;
      readonly note: boolean;
    };
  };
  assert(
    activityOnly.status === 200 && activityOnlyBody.availability.activity &&
      !activityOnlyBody.availability.note,
    "notes hidden incorrectly disabled activity capture",
  );
  const activityOnlyProfile = await request(primary, `/api/v1/people/${ada}`);
  const activityOnlyProfileBody = await activityOnlyProfile.json() as {
    readonly person: {
      readonly profileSections: readonly {
        readonly id: string;
        readonly status: string;
      }[];
    };
  };
  assert(
    activityOnlyProfile.status === 200 &&
      activityOnlyProfileBody.person.profileSections.some((section) =>
        section.id === "activities" && section.status === "ready"
      ) &&
      activityOnlyProfileBody.person.profileSections.some((section) =>
        section.id === "notes" && section.status === "hidden"
      ),
    "profile did not expose the activity-only personalization permutation",
  );
  const hiddenNote = await request(primary, "/api/v1/interactions", "POST", {
    body: "Must be hidden",
    kind: "note",
    personId: ada,
    requestId: crypto.randomUUID(),
  });
  assert(hiddenNote.status === 403, "hidden note capture was accepted");
  await sql`
    update crm.workspace_profile_modules set is_active = true
    where workspace_id = ${primary.workspaceId}::uuid and key in ('activities', 'notes')
  `;
  const activityTypeId = crypto.randomUUID();
  const emotionId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.activity_types (id, workspace_id, name, sort_order)
      values (${activityTypeId}::uuid, ${primary.workspaceId}::uuid, 'Shared meal', 1)
    `;
    await transaction`
      insert into crm.emotion_options (id, name, sort_order)
      values (${emotionId}::uuid, 'Joy', 1)
    `;
  });
  await sql`
    insert into crm.activity_types (workspace_id, name, sort_order)
    select ${primary.workspaceId}::uuid, 'Paged type ' || value, value + 10
    from generate_series(1, 55) value
  `;
  await sql`
    insert into crm.emotion_options (name, sort_order)
    select ${`Paged emotion ${suffix} `} || value, value + 10
    from generate_series(1, 55) value
  `;
  const firstOptions = await request(
    primary,
    "/api/v1/interaction-options?limit=20",
  );
  const firstOptionsBody = await firstOptions.json() as {
    readonly activityTypes: readonly { readonly id: string }[];
    readonly activityTypesNextCursor?: string;
    readonly emotions: readonly { readonly id: string }[];
    readonly emotionsNextCursor?: string;
  };
  assert(
    firstOptions.status === 200 &&
      firstOptionsBody.activityTypes.length === 20 &&
      firstOptionsBody.emotions.length === 20 &&
      firstOptionsBody.activityTypesNextCursor &&
      firstOptionsBody.emotionsNextCursor,
    "interaction option pages were silently capped or unbounded",
  );
  const searchedType = await request(
    primary,
    "/api/v1/interaction-options?activityTypeSearch=Paged%20type%2055&limit=20",
  );
  const searchedTypeBody = await searchedType.json() as {
    readonly activityTypes: readonly { readonly name: string }[];
  };
  assert(
    searchedType.status === 200 &&
      searchedTypeBody.activityTypes.some((entry) =>
        entry.name === "Paged type 55"
      ),
    "search could not discriminate an activity type beyond the first page",
  );
  const mismatchedOptionCursor = await request(
    primary,
    `/api/v1/interaction-options?activityTypeSearch=changed&activityTypeCursor=${
      encodeURIComponent(firstOptionsBody.activityTypesNextCursor ?? "")
    }`,
  );
  const foreignOptionCursor = await request(
    foreign,
    `/api/v1/interaction-options?activityTypeCursor=${
      encodeURIComponent(firstOptionsBody.activityTypesNextCursor ?? "")
    }`,
  );
  assert(
    mismatchedOptionCursor.status === 409 && foreignOptionCursor.status === 409,
    "option cursor was not search/workspace bound",
  );
  const generatedPeople = await sql<{ readonly id: string }[]>`
    insert into crm.people (workspace_id, created_by_member_id, given_name)
    select ${primary.workspaceId}::uuid, ${primary.memberId}::uuid,
      case when value = 55 then 'Beyond Participant' else 'Paged Person ' || value end
    from generate_series(1, 55) value
    returning id::text
  `;
  const beyondId = generatedPeople.at(-1)?.id;
  const searchedPeople = await request(
    primary,
    "/api/v1/people?search=Beyond%20Participant&limit=20",
  );
  const searchedPeopleBody = await searchedPeople.json() as {
    readonly people: readonly { readonly id: string }[];
  };
  assert(
    searchedPeople.status === 200 && beyondId &&
      searchedPeopleBody.people.some((person) => person.id === beyondId),
    "participant search could not reach beyond the first 50 people",
  );

  const activity = await request(primary, "/api/v1/interactions", "POST", {
    activityTypeId,
    description: "Caught up over dinner.",
    emotionIds: [emotionId],
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity",
    participantIds: [ada, grace],
    requestId: crypto.randomUUID(),
    summary: "Dinner together",
  });
  const activityBody = await activity.json() as {
    readonly record: { readonly id: string };
  };
  assert(activity.status === 201, `activity returned ${activity.status}`);
  const note = await request(primary, "/api/v1/interactions", "POST", {
    body: "Prefers quiet morning meetings.",
    isFavorited: true,
    kind: "note",
    personId: ada,
    requestId: crypto.randomUUID(),
  });
  const noteBody = await note.json() as {
    readonly record: { readonly id: string };
  };
  assert(note.status === 201, `note returned ${note.status}`);
  const retryId = crypto.randomUUID();
  const retryInput = {
    body: "One idempotent note",
    isFavorited: false,
    kind: "note",
    personId: ada,
    requestId: retryId,
  };
  const [retryOne, retryTwo] = await Promise.all([
    request(primary, "/api/v1/interactions", "POST", retryInput),
    request(primary, "/api/v1/interactions", "POST", retryInput),
  ]);
  const retryOneBody = await retryOne.json() as {
    readonly record?: { readonly id: string };
  };
  const retryTwoBody = await retryTwo.json() as {
    readonly record?: { readonly id: string };
  };
  assert(
    retryOne.status === 201 && retryTwo.status === 201 &&
      retryOneBody.record?.id !== retryId &&
      retryOneBody.record?.id === retryTwoBody.record?.id,
    "concurrent identical retry did not return the stable record",
  );
  const retryRecordId = retryOneBody.record!.id;
  const mismatch = await request(primary, "/api/v1/interactions", "POST", {
    ...retryInput,
    body: "Changed retry payload",
  });
  const foreignReplay = await request(foreign, "/api/v1/interactions", "POST", {
    body: "One idempotent note",
    kind: "note",
    personId: outsider,
    requestId: retryId,
  });
  const foreignReplayBody = await foreignReplay.json() as {
    readonly record?: { readonly id: string };
  };
  const retryProof = await sql<{
    readonly audits: number;
    readonly notes: number;
  }[]>`
    select
      (select count(*)::int from crm.notes where id = ${retryRecordId}::uuid) notes,
      (select count(*)::int from crm.audit_events
        where workspace_id = ${primary.workspaceId}::uuid
          and subject_id = ${retryRecordId}::uuid
          and action = 'interactions.interaction-or-note-created') audits
  `;
  assert(
    mismatch.status === 409 && foreignReplay.status === 201 &&
      foreignReplayBody.record?.id !== retryRecordId &&
      retryProof[0]?.notes === 1 &&
      retryProof[0].audits === 1,
    "idempotency mismatch changed interaction or audit state",
  );

  const proof = await sql<{
    readonly audits: number;
    readonly emotions: number;
    readonly participants: number;
  }[]>`
    select
      (select count(*)::int from crm.activity_participants
        where activity_id = ${activityBody.record.id}::uuid) participants,
      (select count(*)::int from crm.activity_emotions
        where activity_id = ${activityBody.record.id}::uuid) emotions,
      (select count(*)::int from crm.audit_events
        where workspace_id = ${primary.workspaceId}::uuid
          and action = 'interactions.interaction-or-note-created'
          and visible_on_dashboard = true) audits
  `;
  assert(
    proof[0]?.participants === 2 && proof[0].emotions === 1 &&
      proof[0].audits === 3,
    `atomic persistence/audit proof failed: ${JSON.stringify(proof[0])}`,
  );
  for (const personId of [ada, grace]) {
    const report = await request(
      primary,
      `/api/v1/people/${personId}/activity-report`,
    );
    const body = await report.json() as {
      readonly items: readonly { readonly kind: string }[];
    };
    assert(
      report.status === 200 &&
        body.items.some((item) => item.kind === "activity"),
      "activity missing from a valid participant profile/report",
    );
  }
  const [todayFavorites, todayRecent] = await Promise.all([
    request(primary, "/api/v1/today/favorite-notes"),
    request(primary, "/api/v1/today/recent-activity"),
  ]);
  const todayFavoriteBody = await todayFavorites.json() as {
    readonly items: readonly unknown[];
  };
  const todayRecentBody = await todayRecent.json() as {
    readonly items: readonly {
      readonly activityType?: string;
      readonly id: string;
      readonly kind: string;
    }[];
  };
  const recentActivity = todayRecentBody.items.find((item) =>
    item.id === activityBody.record.id
  );
  assert(
    todayFavorites.status === 200 && todayRecent.status === 200 &&
      todayFavoriteBody.items.length === 1 &&
      todayRecentBody.items.length === 3 &&
      recentActivity?.kind === "activity" &&
      recentActivity.activityType === "Shared meal",
    "Today projections did not include the activity and favorite note",
  );

  await sql`
    insert into crm.notes (
      workspace_id, person_id, body, is_favorited, created_by_member_id,
      created_at, updated_at
    )
    select ${primary.workspaceId}::uuid, ${ada}::uuid,
      'Newer projection note ' || value, false, ${primary.memberId}::uuid,
      now() + value * interval '1 millisecond',
      now() + value * interval '1 millisecond'
    from generate_series(1, 21) value
  `;
  const mixedProfilePage = await request(
    primary,
    `/api/v1/people/${ada}/activity-report?limit=20`,
  );
  const activityProfilePage = await request(
    primary,
    `/api/v1/people/${ada}/activity-report?kind=activity&limit=20`,
  );
  const mixedProfileBody = await mixedProfilePage.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  const activityProfileBody = await activityProfilePage.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  assert(
    mixedProfilePage.status === 200 &&
      !mixedProfileBody.items.some((item) =>
        item.id === activityBody.record.id
      ) &&
      activityProfilePage.status === 200 &&
      activityProfileBody.items.some((item) =>
        item.id === activityBody.record.id
      ),
    "newer notes concealed an activity from its kind-scoped profile projection",
  );
  const [favoriteAfterNewerItems, recentAfterNewerItems] = await Promise.all([
    request(primary, "/api/v1/today/favorite-notes"),
    request(primary, "/api/v1/today/recent-activity"),
  ]);
  const favoriteAfterNewerItemsBody = await favoriteAfterNewerItems.json() as {
    readonly items: readonly { readonly id: string }[];
  };
  const recentAfterNewerItemsBody = await recentAfterNewerItems.json() as {
    readonly items: readonly unknown[];
  };
  assert(
    favoriteAfterNewerItems.status === 200 &&
      recentAfterNewerItems.status === 200 &&
      favoriteAfterNewerItemsBody.items.some((entry) =>
        entry.id === noteBody.record.id
      ) && favoriteAfterNewerItemsBody.items.length <= 8 &&
      recentAfterNewerItemsBody.items.length <= 20,
    "newer non-favorites evicted the independently bounded Today favorite",
  );
  const tamperedTypeCursor = await request(
    primary,
    `/api/v1/interaction-options?activityTypeCursor=${
      encodeURIComponent(tamperCursorId(
        firstOptionsBody.activityTypesNextCursor ?? "",
      ))
    }`,
  );
  const tamperedEmotionCursor = await request(
    primary,
    `/api/v1/interaction-options?emotionCursor=${
      encodeURIComponent(tamperCursorId(
        firstOptionsBody.emotionsNextCursor ?? "",
      ))
    }`,
  );
  assert(
    tamperedTypeCursor.status === 409 && tamperedEmotionCursor.status === 409,
    "UUID-tampered option cursor was not rejected before SQL",
  );

  const tied = await sql<{ readonly id: string }[]>`
    insert into crm.activities (
      workspace_id, summary, happened_at, created_by_member_id
    )
    select ${primary.workspaceId}::uuid, 'Tied activity ' || value,
      '2025-05-20T12:00:00.000Z'::timestamptz, ${primary.memberId}::uuid
    from generate_series(1, 25) value
    returning id::text
  `;
  await sql`
    insert into crm.activity_participants (activity_id, person_id)
    select id, ${ada}::uuid from unnest(${tied.map((row) => row.id)}::uuid[]) id
  `;
  const pagedIds: string[] = [];
  let reportCursor: string | undefined;
  let firstReportCursor: string | undefined;
  let firstReportAnchor: string | undefined;
  do {
    const page = await request(
      primary,
      `/api/v1/people/${ada}/activity-report?year=2025&limit=10${
        reportCursor ? `&cursor=${encodeURIComponent(reportCursor)}` : ""
      }`,
    );
    const pageBody = await page.json() as {
      readonly items: readonly { readonly id: string }[];
      readonly nextCursor?: string;
    };
    assert(page.status === 200, `activity report page returned ${page.status}`);
    if (!reportCursor) {
      firstReportCursor = pageBody.nextCursor;
      firstReportAnchor = pageBody.items.at(-1)?.id;
    }
    pagedIds.push(...pageBody.items.map((item) => item.id));
    reportCursor = pageBody.nextCursor;
  } while (reportCursor);
  assert(
    pagedIds.length === 25 && new Set(pagedIds).size === 25,
    "tied-timestamp keyset report had duplicates or gaps",
  );
  assert(
    firstReportCursor && firstReportAnchor,
    "first report page did not continue",
  );
  const foreignReportCursor = await request(
    foreign,
    `/api/v1/people/${outsider}/activity-report?year=2025&cursor=${
      encodeURIComponent(firstReportCursor)
    }`,
  );
  assert(
    foreignReportCursor.status === 409,
    "report cursor crossed workspaces",
  );
  const tamperedReportCursor = await request(
    primary,
    `/api/v1/people/${ada}/activity-report?year=2025&cursor=${
      encodeURIComponent(tamperCursorId(firstReportCursor))
    }`,
  );
  assert(
    tamperedReportCursor.status === 409,
    "UUID-tampered report cursor was not rejected before SQL",
  );
  await sql`
    update crm.activities set happened_at = happened_at + interval '1 second'
    where id = ${firstReportAnchor}::uuid
  `;
  const staleReportCursor = await request(
    primary,
    `/api/v1/people/${ada}/activity-report?year=2025&cursor=${
      encodeURIComponent(firstReportCursor)
    }`,
  );
  assert(
    staleReportCursor.status === 409,
    "mutated report anchor was not rejected",
  );

  const before = await sql<[{ readonly count: number }]>`
    select count(*)::int as count from crm.activities
    where workspace_id = ${primary.workspaceId}::uuid
  `;
  const concealed = await request(primary, "/api/v1/interactions", "POST", {
    happenedAt: "2026-08-16T20:00:00.000Z",
    kind: "activity",
    participantIds: [ada, outsider],
    requestId: crypto.randomUUID(),
    summary: "Must not persist",
  });
  const after = await sql<[{ readonly count: number }]>`
    select count(*)::int as count from crm.activities
    where workspace_id = ${primary.workspaceId}::uuid
  `;
  assert(
    concealed.status === 404 && before[0].count === after[0].count,
    "cross-workspace participant was disclosed or partially persisted",
  );
});

Deno.test("INTERACTION-001 PostgreSQL projections and replay conceal malformed cross-workspace links", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `interaction-malformed-${suffix}@example.test`,
    "Malformed primary",
  );
  const foreign = await register(
    `interaction-foreign-${suffix}@example.test`,
    "Malformed foreign",
  );
  const localPerson = await createPerson(primary, "Local participant");
  const foreignPerson = await createPerson(foreign, "Foreign secret person");
  const foreignType = crypto.randomUUID();
  const activityRequestId = crypto.randomUUID();
  const noteRequestId = crypto.randomUUID();
  const createdActivity = await request(
    primary,
    "/api/v1/interactions",
    "POST",
    {
      happenedAt: "2026-07-01T12:00:00.000Z",
      kind: "activity",
      participantIds: [localPerson],
      requestId: activityRequestId,
      summary: "Imported malformed activity",
    },
  );
  const createdActivityBody = await createdActivity.json() as {
    readonly record: { readonly id: string };
  };
  const createdNote = await request(primary, "/api/v1/interactions", "POST", {
    body: "Foreign linked note body",
    isFavorited: true,
    kind: "note",
    personId: localPerson,
    requestId: noteRequestId,
  });
  const createdNoteBody = await createdNote.json() as {
    readonly record: { readonly id: string };
  };
  assert(
    createdActivity.status === 201 && createdNote.status === 201,
    "local interaction fixtures created before malformed import repair",
  );
  const activityId = createdActivityBody.record.id;
  const noteId = createdNoteBody.record.id;
  await sql`
    insert into crm.activity_types (id, workspace_id, name, sort_order)
    values (
      ${foreignType}::uuid, ${foreign.workspaceId}::uuid,
      'Foreign secret terminology', 1
    )
  `;
  await sql`
    update crm.activities set activity_type_id = ${foreignType}::uuid
    where id = ${activityId}::uuid
  `;
  await sql`
    insert into crm.activity_participants (activity_id, person_id)
    values
      (${activityId}::uuid, ${foreignPerson}::uuid)
  `;
  await sql`
    update crm.notes set person_id = ${foreignPerson}::uuid
    where id = ${noteId}::uuid
  `;

  const report = await request(
    primary,
    `/api/v1/people/${localPerson}/activity-report`,
  );
  const activityReplay = await request(
    primary,
    "/api/v1/interactions",
    "POST",
    {
      activityTypeId: foreignType,
      happenedAt: "2026-07-01T12:00:00.000Z",
      kind: "activity",
      participantIds: [localPerson, foreignPerson],
      requestId: activityRequestId,
      summary: "Imported malformed activity",
    },
  );
  const noteReplay = await request(primary, "/api/v1/interactions", "POST", {
    body: "Foreign linked note body",
    isFavorited: true,
    kind: "note",
    personId: foreignPerson,
    requestId: noteRequestId,
  });
  const [todayFavorites, todayRecent] = await Promise.all([
    request(primary, "/api/v1/today/favorite-notes"),
    request(primary, "/api/v1/today/recent-activity"),
  ]);
  const serialized = [
    await report.text(),
    await activityReplay.text(),
    await noteReplay.text(),
    await todayFavorites.text(),
    await todayRecent.text(),
  ].join("\n");
  assert(report.status === 200, "local activity report remained available");
  assert(
    activityReplay.status === 201,
    `malformed activity replay returned ${activityReplay.status}`,
  );
  assert(
    noteReplay.status === 404,
    `malformed note replay returned ${noteReplay.status}`,
  );
  assert(
    todayFavorites.status === 200 && todayRecent.status === 200,
    "Today projections remained available",
  );
  for (
    const secret of [
      foreignPerson,
      foreignType,
      "Foreign secret person",
      "Foreign secret terminology",
      "Foreign linked note body",
    ]
  ) {
    assert(
      !serialized.includes(secret),
      `cross-workspace projection leaked ${secret}`,
    );
  }
  assert(
    serialized.includes(localPerson) &&
      serialized.includes("Local participant"),
    "valid local participant semantics were lost",
  );
});

Deno.test("INTERACTION-001 PostgreSQL Today safely retains activity after its sole participant is deleted", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `interaction-retained-${suffix}@example.test`,
    "Retained activity",
  );
  const personId = await createPerson(fixture, "Deleted private identity");
  const activityId = crypto.randomUUID();
  const created = await request(fixture, "/api/v1/interactions", "POST", {
    happenedAt: "2026-06-01T09:00:00.000Z",
    kind: "activity",
    participantIds: [personId],
    requestId: activityId,
    summary: "Retained redacted activity",
  });
  const createdBody = await created.json() as {
    readonly record: { readonly id: string };
  };
  assert(created.status === 201, "sole-participant activity created");
  const aggregateId = createdBody.record.id;
  const impact = await request(
    fixture,
    `/api/v1/people/${personId}/deletion-impact`,
  );
  const impactBody = await impact.json() as {
    readonly impact: {
      readonly confirmation: string;
      readonly person: { readonly updatedAt: string };
    };
  };
  assert(impact.status === 200, "deletion impact resolved");
  const deleted = await request(
    fixture,
    `/api/v1/people/${personId}`,
    "DELETE",
    {
      confirmation: impactBody.impact.confirmation,
      expectedUpdatedAt: impactBody.impact.person.updatedAt,
    },
  );
  assert(deleted.status === 200, "sole participant soft-deleted");

  const replay = await request(fixture, "/api/v1/interactions", "POST", {
    happenedAt: "2026-06-01T09:00:00.000Z",
    kind: "activity",
    participantIds: [personId],
    requestId: activityId,
    summary: "Retained redacted activity",
  });
  const replayBody = await replay.json() as {
    readonly record?: {
      readonly id: string;
      readonly participants: readonly {
        readonly id: string;
        readonly name: string;
      }[];
    };
  };
  const auditProof = await sql<{ readonly audits: number }[]>`
    select count(*)::int as audits from crm.audit_events
    where workspace_id = ${fixture.workspaceId}::uuid
      and subject_id = ${aggregateId}::uuid
      and action = 'interactions.interaction-or-note-created'
  `;
  assert(
    replay.status === 201 && replayBody.record?.id === aggregateId &&
      replayBody.record.participants.length === 0 &&
      auditProof[0]?.audits === 1,
    `idempotent replay leaked deleted participant or duplicated audit: ${
      JSON.stringify({ replayBody, auditProof })
    }`,
  );
  const replaySerialized = JSON.stringify(replayBody);
  assert(
    !replaySerialized.includes(personId) &&
      !replaySerialized.includes("Deleted private identity"),
    "idempotent replay leaked a soft-deleted participant identity",
  );

  const recent = await request(fixture, "/api/v1/today/recent-activity");
  const recentBody = await recent.json() as {
    readonly items: readonly {
      readonly emotions: readonly unknown[];
      readonly happenedAt: string;
      readonly id: string;
      readonly kind: string;
      readonly participants: readonly unknown[];
      readonly summary: string;
    }[];
    readonly status: string;
  };
  const retained = recentBody.items.find((item) => item.id === aggregateId);
  assert(
    recent.status === 200 && recentBody.status === "ready" && retained &&
      retained.kind === "activity" &&
      retained.summary === "Retained redacted activity" &&
      retained.happenedAt === "2026-06-01T09:00:00.000000Z" &&
      retained.emotions.length === 0 && retained.participants.length === 0,
    `retained activity was not safely redacted: ${JSON.stringify(retained)}`,
  );
  const serialized = JSON.stringify(recentBody);
  assert(
    !serialized.includes(personId) &&
      !serialized.includes("Deleted private identity"),
    "Today leaked a soft-deleted participant identity",
  );
});

Deno.test("INTERACTION-001 PostgreSQL note replay conceals a deleted person and note body", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `interaction-note-deleted-${suffix}@example.test`,
    "Deleted note owner",
  );
  const personId = await createPerson(fixture, "Deleted note identity");
  const noteId = crypto.randomUUID();
  const noteBody = "Private note that must not survive in replay output";
  const input = {
    body: noteBody,
    isFavorited: true,
    kind: "note",
    personId,
    requestId: noteId,
  } as const;
  const created = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    input,
  );
  const createdBody = await created.json() as {
    readonly record: { readonly id: string };
  };
  assert(created.status === 201, "note created before person deletion");
  const aggregateId = createdBody.record.id;
  const impact = await request(
    fixture,
    `/api/v1/people/${personId}/deletion-impact`,
  );
  const impactBody = await impact.json() as {
    readonly impact: {
      readonly confirmation: string;
      readonly person: { readonly updatedAt: string };
    };
  };
  assert(impact.status === 200, "note person deletion impact resolved");
  const deleted = await request(
    fixture,
    `/api/v1/people/${personId}`,
    "DELETE",
    {
      confirmation: impactBody.impact.confirmation,
      expectedUpdatedAt: impactBody.impact.person.updatedAt,
    },
  );
  assert(deleted.status === 200, "note person soft-deleted");

  const replay = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    input,
  );
  const replayBody = await replay.json();
  const proof = await sql<{
    readonly audits: number;
    readonly notes: number;
  }[]>`
    select
      (select count(*)::int from crm.notes
        where id = ${aggregateId}::uuid
          and workspace_id = ${fixture.workspaceId}::uuid) as notes,
      (select count(*)::int from crm.audit_events
        where workspace_id = ${fixture.workspaceId}::uuid
          and subject_id = ${aggregateId}::uuid
          and action = 'interactions.interaction-or-note-created') as audits
  `;
  const serialized = JSON.stringify(replayBody);
  assert(
    replay.status === 404 && proof[0]?.notes === 1 && proof[0].audits === 1,
    `deleted-person note replay was not concealed and idempotent: ${
      JSON.stringify({ replayBody, proof, status: replay.status })
    }`,
  );
  assert(
    !serialized.includes(personId) &&
      !serialized.includes("Deleted note identity") &&
      !serialized.includes(noteBody),
    "deleted-person note replay leaked an identity or note body",
  );
});

Deno.test("INTERACTION-001 PostgreSQL scopes one client request id independently per workspace", async () => {
  const suffix = crypto.randomUUID();
  const primary = await register(
    `interaction-key-primary-${suffix}@example.test`,
    "Primary request scope",
  );
  const foreign = await register(
    `interaction-key-foreign-${suffix}@example.test`,
    "Foreign request scope",
  );
  const primaryPerson = await createPerson(primary, "Primary person");
  const foreignPerson = await createPerson(foreign, "Foreign person");
  const sharedRequestId = crypto.randomUUID();
  const primaryInput = {
    body: "Primary private note",
    kind: "note",
    personId: primaryPerson,
    requestId: sharedRequestId,
  } as const;
  const foreignInput = {
    body: "Foreign private note",
    kind: "note",
    personId: foreignPerson,
    requestId: sharedRequestId,
  } as const;
  const foreignCreated = await request(
    foreign,
    "/api/v1/interactions",
    "POST",
    foreignInput,
  );
  const foreignBody = await foreignCreated.json() as {
    readonly record?: { readonly id: string };
  };
  const primaryCreated = await request(
    primary,
    "/api/v1/interactions",
    "POST",
    primaryInput,
  );
  const primaryBody = await primaryCreated.json() as {
    readonly record?: { readonly id: string };
  };
  assert(
    foreignCreated.status === 201 && primaryCreated.status === 201 &&
      foreignBody.record && primaryBody.record &&
      foreignBody.record.id !== primaryBody.record.id &&
      foreignBody.record.id !== sharedRequestId &&
      primaryBody.record.id !== sharedRequestId,
    `shared request key was a global aggregate oracle: ${
      JSON.stringify({ foreignBody, primaryBody })
    }`,
  );

  const [foreignReplay, primaryReplay] = await Promise.all([
    request(foreign, "/api/v1/interactions", "POST", foreignInput),
    request(primary, "/api/v1/interactions", "POST", primaryInput),
  ]);
  const foreignReplayBody = await foreignReplay.json() as {
    readonly record?: { readonly id: string };
  };
  const primaryReplayBody = await primaryReplay.json() as {
    readonly record?: { readonly id: string };
  };
  const mismatch = await request(
    primary,
    "/api/v1/interactions",
    "POST",
    { ...primaryInput, body: "Mismatched primary payload" },
  );
  const proof = await sql<{
    readonly audits: number;
    readonly notes: number;
  }[]>`
    select
      (select count(*)::int from crm.notes where id in (
        ${foreignBody.record.id}::uuid, ${primaryBody.record.id}::uuid
      )) as notes,
      (select count(*)::int from crm.audit_events where subject_id in (
        ${foreignBody.record.id}::uuid, ${primaryBody.record.id}::uuid
      ) and action = 'interactions.interaction-or-note-created') as audits
  `;
  assert(
    foreignReplay.status === 201 && primaryReplay.status === 201 &&
      foreignReplayBody.record?.id === foreignBody.record.id &&
      primaryReplayBody.record?.id === primaryBody.record.id &&
      mismatch.status === 409 && proof[0]?.notes === 2 && proof[0].audits === 2,
    `workspace request replay changed records or effects: ${
      JSON.stringify({
        foreignReplayBody,
        mismatch: mismatch.status,
        primaryReplayBody,
        proof,
      })
    }`,
  );
});

Deno.test("INTERACTION-001 PostgreSQL reauthorizes resolved actors before replay disclosure", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `interaction-revoked-${suffix}@example.test`,
    "Revoked replay",
  );
  const personId = await createPerson(fixture, "Authority private person");
  const activityInput = {
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity" as const,
    participantIds: [personId],
    requestId: crypto.randomUUID(),
    summary: "Authority private activity",
  };
  const noteInput = {
    body: "Authority private note body",
    isFavorited: true,
    kind: "note" as const,
    personId,
    requestId: crypto.randomUUID(),
  };
  const [createdActivity, createdNote] = await Promise.all([
    request(fixture, "/api/v1/interactions", "POST", activityInput),
    request(fixture, "/api/v1/interactions", "POST", noteInput),
  ]);
  const activityBody = await createdActivity.json() as {
    readonly record?: { readonly id: string };
  };
  const noteBody = await createdNote.json() as {
    readonly record?: { readonly id: string };
  };
  assert(
    createdActivity.status === 201 && createdNote.status === 201 &&
      activityBody.record && noteBody.record,
    "authority-sensitive replay fixtures created",
  );
  const actor = {
    memberId: fixture.memberId,
    role: fixture.role,
    userId: fixture.userId,
    workspaceId: fixture.workspaceId,
  };
  const authorityChanges = [
    {
      disable: () =>
        sql`update crm.workspace_members set status = 'suspended'
          where id = ${fixture.memberId}::uuid`,
      name: "membership",
      restore: () =>
        sql`update crm.workspace_members set status = 'active'
          where id = ${fixture.memberId}::uuid`,
    },
    {
      disable: () =>
        sql`update crm.users set status = 'disabled'
          where id = ${fixture.userId}::uuid`,
      name: "user",
      restore: () =>
        sql`update crm.users set status = 'active'
          where id = ${fixture.userId}::uuid`,
    },
    {
      disable: () =>
        sql`update crm.workspaces set status = 'suspended'
          where id = ${fixture.workspaceId}::uuid`,
      name: "workspace",
      restore: () =>
        sql`update crm.workspaces set status = 'active'
          where id = ${fixture.workspaceId}::uuid`,
    },
  ];
  for (const change of authorityChanges) {
    await change.disable();
    try {
      const results = await Promise.all([
        directInteractions.record(actor, activityInput),
        directInteractions.record(actor, {
          ...activityInput,
          summary: "Mismatched private activity",
        }),
        directInteractions.record(actor, noteInput),
        directInteractions.record(actor, {
          ...noteInput,
          body: "Mismatched private note body",
        }),
      ]);
      assert(
        results.every((result) => result.status === "forbidden"),
        `${change.name} revocation disclosed replay existence: ${
          JSON.stringify(results)
        }`,
      );
      const serialized = JSON.stringify(results);
      for (
        const secret of [
          personId,
          activityBody.record.id,
          noteBody.record.id,
          activityInput.summary,
          noteInput.body,
        ]
      ) {
        assert(
          !serialized.includes(secret),
          `${change.name} revocation leaked ${secret}`,
        );
      }
    } finally {
      await change.restore();
    }
  }
  const [activeActivityReplay, activeNoteReplay] = await Promise.all([
    directInteractions.record(actor, activityInput),
    directInteractions.record(actor, noteInput),
  ]);
  const proof = await sql<{
    readonly activities: number;
    readonly audits: number;
    readonly notes: number;
  }[]>`
    select
      (select count(*)::int from crm.activities
        where id = ${activityBody.record.id}::uuid) as activities,
      (select count(*)::int from crm.notes
        where id = ${noteBody.record.id}::uuid) as notes,
      (select count(*)::int from crm.audit_events
        where subject_id in (
          ${activityBody.record.id}::uuid, ${noteBody.record.id}::uuid
        ) and action = 'interactions.interaction-or-note-created') as audits
  `;
  assert(
    activeActivityReplay.status === "created" &&
      activeNoteReplay.status === "created" &&
      proof[0]?.activities === 1 && proof[0].notes === 1 &&
      proof[0].audits === 2,
    `reauthorization changed replay records or audits: ${
      JSON.stringify(proof)
    }`,
  );
});

Deno.test("INTERACTION-001 HTTP canonicalizes uppercase UUID retries without duplicate effects", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `interaction-case-${suffix}@example.test`,
    "Interaction case",
  );
  const personId = await createPerson(fixture, "Case participant");
  const activityRequestId = crypto.randomUUID();
  const activityInput = {
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity" as const,
    participantIds: [personId, personId.toUpperCase()],
    requestId: activityRequestId,
    summary: "Case-stable activity",
  };
  const createdActivity = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    activityInput,
  );
  const createdActivityBody = await createdActivity.json() as {
    readonly record?: { readonly id: string };
  };
  const replayedActivity = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    {
      ...activityInput,
      participantIds: [personId.toUpperCase()],
      requestId: activityRequestId.toUpperCase(),
    },
  );
  const replayedActivityBody = await replayedActivity.json();

  const noteRequestId = crypto.randomUUID();
  const noteInput = {
    body: "Case-stable note",
    isFavorited: true,
    kind: "note" as const,
    personId,
    requestId: noteRequestId,
  };
  const createdNote = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    noteInput,
  );
  const createdNoteBody = await createdNote.json() as {
    readonly record?: { readonly id: string };
  };
  const replayedNote = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    {
      ...noteInput,
      personId: personId.toUpperCase(),
      requestId: noteRequestId.toUpperCase(),
    },
  );
  const replayedNoteBody = await replayedNote.json();
  const mismatch = await request(
    fixture,
    "/api/v1/interactions",
    "POST",
    {
      ...noteInput,
      body: "Different payload",
      personId: personId.toUpperCase(),
      requestId: noteRequestId.toUpperCase(),
    },
  );
  assert(
    createdActivity.status === 201 && replayedActivity.status === 201 &&
      createdNote.status === 201 && replayedNote.status === 201 &&
      mismatch.status === 409 &&
      JSON.stringify(createdActivityBody) ===
        JSON.stringify(replayedActivityBody) &&
      JSON.stringify(createdNoteBody) === JSON.stringify(replayedNoteBody),
    `uppercase retries changed their original response: ${
      JSON.stringify({
        createdActivityBody,
        createdNoteBody,
        replayedActivityBody,
        replayedNoteBody,
      })
    }`,
  );
  assert(
    createdActivityBody.record && createdNoteBody.record,
    "case-stable records did not expose aggregate identifiers",
  );
  const proof = await sql<{
    readonly activities: number;
    readonly audits: number;
    readonly notes: number;
    readonly participants: number;
  }[]>`
    select
      (select count(*)::int from crm.activities
        where id = ${createdActivityBody.record.id}::uuid) activities,
      (select count(*)::int from crm.activity_participants
        where activity_id = ${createdActivityBody.record.id}::uuid) participants,
      (select count(*)::int from crm.notes
        where id = ${createdNoteBody.record.id}::uuid) notes,
      (select count(*)::int from crm.audit_events
        where subject_id in (
          ${createdActivityBody.record.id}::uuid,
          ${createdNoteBody.record.id}::uuid
        ) and action = 'interactions.interaction-or-note-created') audits
  `;
  assert(
    proof[0]?.activities === 1 && proof[0].participants === 1 &&
      proof[0].notes === 1 && proof[0].audits === 2,
    `uppercase retries duplicated persistence or audit: ${
      JSON.stringify(proof[0])
    }`,
  );
});

Deno.test({
  name: "INTERACTION-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
    await directConnection.destroy();
  },
});
