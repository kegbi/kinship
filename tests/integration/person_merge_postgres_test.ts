/**
 * Merging two people against PostgreSQL (GAP-049, PEOPLE-008).
 *
 * The merge runs through the public API and every owning module's registered
 * participant, in one people transaction. These suites prove what the unit
 * suites cannot: that every foreign key to `crm.people` in the canonical
 * schema has a participant, that every one of those tables really is
 * relinked, that the per-table collision rules hold, that a failing
 * participant rolls the whole merge back, that tenancy and membership are
 * enforced, that a re-imported Monica export lands on the surviving person,
 * and that no reminder occurrence is duplicated under its delivery key.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
  personMergeParticipants,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import {
  createPersonMerge,
  personMergeAuditFrom,
  type PersonMergeParticipant,
} from "../../packages/backend/modules/people/public.ts";
import { PostgresPersonMergeRepository } from "../../packages/backend/modules/people/adapters/postgres/person_merge_repository.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { governanceAuditRecorder } from "../../packages/backend/modules/governance/composition.ts";
import {
  composeWorkspaceBoundaries,
  workspaceActors,
} from "../../packages/backend/modules/workspaces/composition.ts";
import { personDateReminderPublisher } from "../../packages/backend/modules/planning/composition.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  openSql,
  requireDatabaseUrl,
  revokeMembership,
} from "../support/database.ts";
import {
  apiSupport,
  ORIGIN,
  sessionCookie,
  type SignedInFixture,
} from "../support/api.ts";
import { createPerson, importantDateRequest } from "../support/fixtures.ts";
import { silentLogger } from "../../packages/backend/shared-kernel/telemetry.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

/** The one reference that is a text key rather than a foreign key. */
const TEXT_KEYS = ["crm.data_import_entities.target_key"];

/** A person, created through the API even when the name is already taken. */
function addPerson(
  fixture: SignedInFixture,
  person: string | Readonly<Record<string, unknown>>,
): Promise<string> {
  const [givenName, ...family] = typeof person === "string"
    ? person.split(" ")
    : [];
  return createPerson(
    api,
    fixture,
    typeof person === "string"
      ? {
        duplicateOverride: true,
        ...(family.length ? { familyName: family.join(" ") } : {}),
        givenName,
        isPartial: false,
      }
      : { duplicateOverride: true, ...person },
  );
}

function register(label: string): Promise<SignedInFixture> {
  const suffix = crypto.randomUUID();
  return api.register(
    `merge-${label}-${suffix}@example.test`,
    `Merge ${label}`,
  );
}

/**
 * Every column that references `crm.people.id`, as `crm.<table>.<column>`. A
 * composite key that also matches `people.workspace_id` names only its person
 * column: the workspace column holds no person.
 */
async function peopleForeignKeys(): Promise<readonly string[]> {
  const rows = await sql<{ readonly reference: string }[]>`
    select namespace.nspname || '.' || source.relname || '.' ||
      attribute.attname as reference
    from pg_constraint constraint_row
    join pg_class source on source.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = source.relnamespace
    cross join lateral unnest(constraint_row.conkey, constraint_row.confkey)
      as pair(source_column, target_column)
    join pg_attribute target
      on target.attrelid = constraint_row.confrelid
      and target.attnum = pair.target_column
      and target.attname = 'id'
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
      and attribute.attnum = pair.source_column
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = 'crm.people'::regclass
    order by 1
  `;
  return rows.map((row) => row.reference);
}

function handledReferences(): readonly string[] {
  return [
    ...personMergeParticipants().flatMap((participant) =>
      participant.references
    ),
    ...new PostgresPersonMergeRepository().ownTables.references,
  ];
}

/** How many rows name the person, per foreign key. */
async function referenceCounts(
  personId: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const reference of await peopleForeignKeys()) {
    const [schema, table, column] = reference.split(".");
    assert(
      /^[a-z_]+$/.test(`${schema}${table}${column}`),
      `${reference} is a plain identifier`,
    );
    const [row] = await sql.unsafe<{ readonly count: number }[]>(
      `select count(*)::int as count from ${schema}.${table} where ${column} = $1`,
      [personId],
    );
    counts[reference] = row?.count ?? 0;
  }
  return counts;
}

/** The pair's merge preview, as the confirmation reads it. */
async function preview(
  fixture: SignedInFixture,
  primaryId: string,
  duplicateId: string,
): Promise<Response> {
  return await api.request(
    fixture,
    `/api/v1/people/${primaryId}/merge-preview?duplicateId=${duplicateId}`,
  );
}

/**
 * Posts a merge the way the confirmation does: confirmed, against both
 * people's current revisions and the digest of the conflicts a preview read
 * just now, unless `body` says otherwise.
 */
async function merge(
  fixture: SignedInFixture,
  primaryId: string,
  body: Readonly<Record<string, unknown>> & { readonly duplicateId: string },
): Promise<Response> {
  const current = async (personId: string) =>
    (await sql<{ readonly updated_at: string }[]>`
      select to_char(updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
      from crm.people where id = ${personId}
    `)[0]?.updated_at ?? "2000-01-01T00:00:00.000000Z";
  const previewed = await preview(fixture, primaryId, body.duplicateId);
  const conflictsDigest = previewed.ok
    ? (await previewed.json() as { conflictsDigest: string }).conflictsDigest
    : "0".repeat(64);
  return await api.request(
    fixture,
    `/api/v1/people/${primaryId}/merge`,
    "POST",
    {
      confirmed: true,
      conflictsDigest,
      duplicateRevision: await current(body.duplicateId),
      primaryRevision: await current(primaryId),
      ...body,
    },
  );
}

async function revision(personId: string): Promise<string> {
  const [row] = await sql<{ readonly updated_at: string }[]>`
    select to_char(updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
    from crm.people where id = ${personId}
  `;
  assert(row, `${personId} exists`);
  return row.updated_at;
}

async function contactType(
  workspaceId: string,
  kind: "email" | "phone",
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${id}, ${workspaceId}, ${`Merge ${kind} ${id}`}, ${kind})
  `;
  return id;
}

async function relationshipType(workspaceId: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.relationship_types (
      id, workspace_id, forward_label, reverse_label, sort_order
    ) values (${id}, ${workspaceId}, 'Friend of', 'Friend of', 900)
  `;
  return id;
}

async function file(workspaceId: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.files (id, workspace_id, original_filename, status)
    values (${id}, ${workspaceId}, 'letter.pdf', 'missing')
  `;
  return id;
}

async function activity(workspaceId: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.activities (id, workspace_id, summary, happened_at)
    values (${id}, ${workspaceId}, 'Tea', now())
  `;
  return id;
}

async function tag(workspaceId: string, name: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.tags (id, workspace_id, name, slug)
    values (${id}, ${workspaceId}, ${name}, ${`${name}-${id}`})
  `;
  return id;
}

async function contactMethod(
  personId: string,
  typeId: string,
  value: string,
  isPrimary = false,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.person_contact_methods (
      id, person_id, type_id, value, is_primary
    ) values (${id}, ${personId}, ${typeId}, ${value}, ${isPrimary})
  `;
  return id;
}

/**
 * One row in every table that can name a person, all naming `personId`,
 * none of which would collide with anything the primary has.
 */
async function seedEveryReference(
  owner: SignedInFixture,
  personId: string,
  thirdId: string,
): Promise<void> {
  const workspaceId = owner.workspaceId;
  const email = await contactType(workspaceId, "email");
  const friend = await relationshipType(workspaceId);
  const document = await file(workspaceId);
  const tea = await activity(workspaceId);
  const colleague = await tag(workspaceId, "colleague");
  const location = crypto.randomUUID();
  const reminder = crypto.randomUUID();
  const book = crypto.randomUUID();
  const importId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.person_avatars (person_id, source, background_color)
      values (${personId}, 'generated', '#b3d5fe')
    `;
    await transaction`
      insert into crm.person_dates (person_id, kind, month, day, precision)
      values (${personId}, 'custom', 5, 4, 'month_day')
    `;
    await transaction`
      insert into crm.person_first_meetings (person_id, place_text)
      values (${personId}, 'At the Analytical Society')
    `;
    await transaction`
      insert into crm.person_first_meetings (
        person_id, introduced_by_person_id, place_text
      ) values (${thirdId}, ${personId}, 'Introduced at a salon')
    `;
    await transaction`
      insert into crm.person_contact_methods (person_id, type_id, value)
      values (${personId}, ${email}, 'countess@example.test')
    `;
    await transaction`
      insert into crm.locations (id, workspace_id, city)
      values (${location}, ${workspaceId}, 'London')
    `;
    await transaction`
      insert into crm.person_addresses (person_id, location_id, display_name)
      values (${personId}, ${location}, 'Home')
    `;
    await transaction`
      insert into crm.person_occupations (person_id, title)
      values (${personId}, 'Mathematician')
    `;
    await transaction`
      insert into crm.person_tags (person_id, tag_id)
      values (${personId}, ${colleague})
    `;
    await transaction`
      insert into crm.pets (person_id, name) values (${personId}, 'Puff')
    `;
    await transaction`
      insert into crm.person_file_links (person_id, file_id, kind)
      values (${personId}, ${document}, 'document')
    `;
    await transaction`
      insert into crm.activity_participants (activity_id, person_id)
      values (${tea}, ${personId})
    `;
    await transaction`
      insert into crm.calls (workspace_id, person_id, called_at)
      values (${workspaceId}, ${personId}, now())
    `;
    await transaction`
      insert into crm.conversation_threads (workspace_id, person_id, happened_at)
      values (${workspaceId}, ${personId}, now())
    `;
    await transaction`
      insert into crm.notes (workspace_id, person_id, body)
      values (${workspaceId}, ${personId}, 'Wrote the first program')
    `;
    await transaction`
      insert into crm.life_events (workspace_id, person_id, name, precision)
      values (${workspaceId}, ${personId}, 'Married', 'unknown')
    `;
    await transaction`
      insert into crm.tasks (workspace_id, person_id, title)
      values (${workspaceId}, ${personId}, 'Send the notes')
    `;
    await transaction`
      insert into crm.reminders (
        id, workspace_id, person_id, target_kind, title, anchor_on
      ) values (
        ${reminder}, ${workspaceId}, ${personId}, 'person', 'Call', '2030-01-01'
      )
    `;
    await transaction`
      insert into crm.stay_in_touch_cadences (person_id, interval_count)
      values (${personId}, 30)
    `;
    await transaction`
      insert into crm.relationships (
        workspace_id, from_person_id, to_person_id, relationship_type_id
      ) values
        (${workspaceId}, ${personId}, ${thirdId}, ${friend}),
        (${workspaceId}, ${thirdId}, ${personId}, ${friend})
    `;
    await transaction`
      insert into crm.gifts (workspace_id, person_id, recipient_person_id, name)
      values
        (${workspaceId}, ${personId}, ${thirdId}, 'Notebook'),
        (${workspaceId}, ${thirdId}, ${personId}, 'Pen')
    `;
    await transaction`
      insert into crm.debts (workspace_id, person_id, direction, amount)
      values (${workspaceId}, ${personId}, 'they_owe', 10)
    `;
    await transaction`
      insert into crm.dav_address_books (id, workspace_id, owner_member_id, name)
      values (${book}, ${workspaceId}, ${owner.memberId}, 'Contacts')
    `;
    await transaction`
      insert into crm.dav_objects (
        workspace_id, address_book_id, object_kind, person_id
      ) values (${workspaceId}, ${book}, 'person', ${personId})
    `;
    await transaction`
      update crm.workspace_members set self_person_id = ${personId}
      where id = ${owner.memberId}
    `;
    await transaction`
      insert into crm.data_imports (id, workspace_id, source_system, status)
      values (${importId}, ${workspaceId}, 'monica', 'completed')
    `;
    await transaction`
      insert into crm.data_import_entities (
        import_id, source_table, source_primary_key, target_table, target_key
      ) values (${importId}, 'contacts', 'c-1', 'people', ${personId})
    `;
    // Two dismissals, one on each side of the pair: ids below and above any
    // random person's, so the duplicate is the higher of one pair and the
    // lower of the other, and so is the primary once both are rewritten.
    const [lowest, highest] = [
      `00000000${crypto.randomUUID().slice(8)}`,
      `ffffffff${crypto.randomUUID().slice(8)}`,
    ];
    await transaction`
      insert into crm.people (id, workspace_id, given_name) values
        (${lowest}, ${workspaceId}, 'Mary'), (${highest}, ${workspaceId}, 'Annabella')
    `;
    await transaction`
      insert into crm.person_duplicate_dismissals (
        workspace_id, person_low_id, person_high_id
      ) values
        (${workspaceId}, ${lowest}, ${personId}),
        (${workspaceId}, ${personId}, ${highest})
    `;
  });
}

async function importTargets(personId: string): Promise<number> {
  const [row] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.data_import_entities
    where target_table = 'people' and target_key = ${personId}
  `;
  return row?.count ?? 0;
}

Deno.test("[PEOPLE-008] every foreign key to crm.people has a merge participant", async () => {
  const foreignKeys = await peopleForeignKeys();
  const handled = handledReferences();
  assert(foreignKeys.length >= 26, `the inventory is read (${foreignKeys})`);
  const unhandled = foreignKeys.filter((key) => !handled.includes(key));
  assertEquals(unhandled, [], "a foreign key no participant relinks");
  const stale = handled.filter((reference) =>
    !foreignKeys.includes(reference) && !TEXT_KEYS.includes(reference)
  );
  assertEquals(stale, [], "a participant names a reference that is gone");
  assertEquals(
    handled.length,
    new Set(handled).size,
    "no reference is claimed by two participants",
  );
});

Deno.test("[PEOPLE-008] a merge relinks every table to the primary and deletes the duplicate", async () => {
  const owner = await register("every-table");
  const primary = await addPerson(owner, {
    familyName: "Lovelace",
    givenName: "Ada",
    isPartial: false,
  });
  const duplicate = await addPerson(owner, {
    givenName: "Ada",
    isPartial: false,
    nickname: "Countess",
  });
  const third = await addPerson(owner, "Charles Babbage");
  await sql`
    update crm.people set description = 'Poet''s daughter',
      food_preferences = 'Tea', is_starred = true
    where id = ${duplicate}
  `;
  await seedEveryReference(owner, duplicate, third);
  const primaryBefore = await referenceCounts(primary);
  const duplicateBefore = await referenceCounts(duplicate);
  const untouched = Object.entries(duplicateBefore)
    .filter(([, count]) => count === 0)
    .map(([reference]) => reference);
  assertEquals(untouched, [], "the seed names the duplicate in every table");

  const response = await merge(owner, primary, {
    duplicateId: duplicate,
    duplicateRevision: await revision(duplicate),
    primaryRevision: await revision(primary),
  });
  const body = await response.json() as {
    readonly moved: number;
    readonly next: string;
    readonly person: {
      readonly familyName?: string;
      readonly nickname?: string;
    };
    readonly status: string;
  };
  assertEquals(response.status, 200, JSON.stringify(body));
  assertEquals(body.status, "merged");
  assertEquals(body.next, `/app/people/${primary}`);
  assertEquals(body.person.familyName, "Lovelace");
  assertEquals(body.person.nickname, "Countess");

  const duplicateAfter = await referenceCounts(duplicate);
  const primaryAfter = await referenceCounts(primary);
  for (const [reference, count] of Object.entries(duplicateAfter)) {
    assertEquals(count, 0, `${reference} still names the duplicate`);
    assert(
      (primaryAfter[reference] ?? 0) > (primaryBefore[reference] ?? 0),
      `${reference} was relinked to the primary`,
    );
  }
  assertEquals(await importTargets(duplicate), 0);
  assertEquals(await importTargets(primary), 1);

  const [people] = await sql<{
    readonly description: string | null;
    readonly duplicate_deleted: boolean;
    readonly food_preferences: string | null;
    readonly is_starred: boolean;
    readonly nickname: string | null;
  }[]>`
    select primary_person.description, primary_person.food_preferences,
      primary_person.is_starred, primary_person.nickname,
      duplicate_person.deleted_at is not null as duplicate_deleted
    from crm.people primary_person, crm.people duplicate_person
    where primary_person.id = ${primary} and duplicate_person.id = ${duplicate}
  `;
  assertEquals(people, {
    description: "Poet's daughter",
    food_preferences: "Tea",
    is_starred: true,
    nickname: "Countess",
    duplicate_deleted: true,
  });
  const [audit] = await sql<{
    readonly duplicate_id: string;
    readonly notes: unknown;
    readonly person_id: string;
  }[]>`
    select person_id::text, payload->>'duplicateId' as duplicate_id,
      payload->'tables'->'crm.notes.person_id' as notes
    from crm.audit_events
    where action = 'people.person-merged'
      and workspace_id = ${owner.workspaceId}
  `;
  // A jsonb object reads back with its keys ordered by length.
  assertEquals(audit, {
    person_id: primary,
    duplicate_id: duplicate,
    notes: { removed: 0, relinked: 1 },
  });
  assertEquals(
    (await api.request(owner, `/api/v1/people/${duplicate}`)).status,
    404,
    "the duplicate's workspace is gone",
  );
  assertEquals(
    (await api.request(owner, `/api/v1/people/${primary}`)).status,
    200,
  );
});

Deno.test("[PEOPLE-008] colliding rows keep the primary's and drop the duplicate's", async () => {
  const owner = await register("collisions");
  const workspaceId = owner.workspaceId;
  const primary = await addPerson(owner, "Grace Hopper");
  const duplicate = await addPerson(owner, "Grace Hopper");
  const third = await addPerson(owner, "Howard Aiken");
  const email = await contactType(workspaceId, "email");
  const friend = await relationshipType(workspaceId);
  const shared = await tag(workspaceId, "navy");
  const tea = await activity(workspaceId);
  const letter = await file(workspaceId);
  const secondMember = await (async () => {
    const other = await register("collisions-member");
    return await addMembership(sql, other.userId, workspaceId, "member");
  })();

  // Single-valued dates through the API, so planning schedules their
  // reminders exactly as it would for a member.
  const birthday = {
    day: 9,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 12,
    precision: "month_day",
  };
  for (
    const [personId, value] of [
      [primary, birthday],
      [duplicate, { ...birthday, day: 12, month: 3, notes: "From the Navy" }],
    ] as const
  ) {
    const created = await importantDateRequest(
      api,
      owner,
      personId,
      "POST",
      value,
    );
    assertEquals(created.status, 201);
  }
  const custom = await importantDateRequest(api, owner, duplicate, "POST", {
    day: 1,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "custom",
    label: "Commissioned",
    month: 8,
    precision: "month_day",
  });
  assertEquals(custom.status, 201);
  const customDate = (await custom.json() as { date: { id: string } }).date.id;
  // A second moved date whose reminder the member paused: it stays paused.
  const paused = await importantDateRequest(api, owner, duplicate, "POST", {
    day: 2,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "custom",
    label: "Retired",
    month: 9,
    precision: "month_day",
  });
  assertEquals(paused.status, 201);
  const pausedDate = (await paused.json() as { date: { id: string } }).date.id;
  await sql`
    update crm.reminders set is_active = false where person_date_id = ${pausedDate}
  `;
  await sql`
    update crm.reminder_occurrences set status = 'cancelled'
    where status = 'pending' and reminder_id in (
      select id from crm.reminders where person_date_id = ${pausedDate}
    )
  `;

  const place = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      insert into crm.person_avatars (person_id, source) values
        (${primary}, 'generated'), (${duplicate}, 'external')
    `;
    await transaction`
      insert into crm.locations (id, workspace_id, label)
      values (${place}, ${workspaceId}, 'Poughkeepsie')
    `;
    await transaction`
      insert into crm.person_first_meetings (
        person_id, introduced_by_person_id, location_id, place_text
      ) values
        (${primary}, ${duplicate}, null, 'Harvard'),
        (${duplicate}, ${third}, ${place}, 'Vassar')
    `;
    await transaction`
      insert into crm.person_tags (person_id, tag_id) values
        (${primary}, ${shared}), (${duplicate}, ${shared})
    `;
    await transaction`
      insert into crm.activity_participants (activity_id, person_id) values
        (${tea}, ${primary}), (${tea}, ${duplicate})
    `;
    await transaction`
      insert into crm.person_file_links (person_id, file_id, kind) values
        (${primary}, ${letter}, 'document'), (${duplicate}, ${letter}, 'document')
    `;
    await transaction`
      insert into crm.relationships (
        workspace_id, from_person_id, to_person_id, relationship_type_id
      ) values
        (${workspaceId}, ${primary}, ${duplicate}, ${friend}),
        (${workspaceId}, ${duplicate}, ${primary}, ${friend}),
        (${workspaceId}, ${primary}, ${third}, ${friend}),
        (${workspaceId}, ${duplicate}, ${third}, ${friend}),
        (${workspaceId}, ${third}, ${primary}, ${friend}),
        (${workspaceId}, ${third}, ${duplicate}, ${friend})
    `;
    await transaction`
      insert into crm.stay_in_touch_cadences (
        person_id, interval_count, last_contacted_at
      ) values
        (${primary}, 7, '2026-01-01T00:00:00Z'),
        (${duplicate}, 30, '2026-06-01T00:00:00Z')
    `;
    await transaction`
      update crm.workspace_members set self_person_id = ${duplicate}
      where id = ${secondMember}
    `;
  });
  await contactMethod(primary, email, "grace@example.test", true);
  await contactMethod(duplicate, email, "  GRACE@example.test ", true);
  const moved = await contactMethod(duplicate, email, "amazing@example.test");

  // The preview names every fact only the primary keeps, from the same
  // decision the merge takes.
  const previewed = await preview(owner, primary, duplicate);
  assertEquals(previewed.status, 200);
  const previewBody = await previewed.json() as {
    readonly conflicts: readonly {
      readonly discarded: string;
      readonly fact: string;
      readonly kept: string;
    }[];
    readonly conflictsDigest: string;
    readonly moves: number;
  };
  assert(/^[0-9a-f]{64}$/.test(previewBody.conflictsDigest), "a digest");
  assertEquals(
    previewBody.conflicts.map((entry) =>
      `${entry.fact}: kept ${entry.kept}, discarded ${entry.discarded}`
    ),
    [
      "birthday: kept 9 December, discarded 12 March",
      "first-meeting: kept Harvard — introduced by Grace Hopper, discarded Vassar — Poughkeepsie — introduced by Howard Aiken",
      "avatar: kept The primary's photo, discarded The duplicate's photo will not be used",
      "stay-in-touch: kept every 7 days, discarded every 30 days",
    ],
  );
  assert(
    previewBody.moves > 10,
    `the preview counts what moves (${previewBody.moves})`,
  );

  const response = await merge(owner, primary, { duplicateId: duplicate });
  assertEquals(response.status, 200, await response.clone().text());

  for (
    const [reference, count] of Object.entries(await referenceCounts(duplicate))
  ) {
    assertEquals(count, 0, `${reference} still names the duplicate`);
  }
  const [state] = await sql<{
    readonly avatar_source: string;
    readonly birthdays: number;
    readonly cadence_interval: number;
    readonly cadence_last_contact: string;
    readonly cadence_next_due: string;
    readonly emails: string;
    readonly file_links: number;
    readonly introduced_by: string | null;
    readonly meeting_place: string;
    readonly participants: number;
    readonly relationships: string;
    readonly second_member_self: string | null;
    readonly tags: number;
  }[]>`
    select
      (select source from crm.person_avatars where person_id = ${primary})
        as avatar_source,
      (select count(*)::int from crm.person_dates
        where person_id = ${primary} and kind = 'birthday') as birthdays,
      (select interval_count from crm.stay_in_touch_cadences
        where person_id = ${primary}) as cadence_interval,
      (select to_char(last_contacted_at at time zone 'UTC', 'YYYY-MM-DD')
        from crm.stay_in_touch_cadences where person_id = ${primary})
        as cadence_last_contact,
      (select to_char(next_due_at at time zone 'UTC', 'YYYY-MM-DD')
        from crm.stay_in_touch_cadences where person_id = ${primary})
        as cadence_next_due,
      (select string_agg(value || ':' || is_primary, ',' order by value)
        from crm.person_contact_methods where person_id = ${primary}) as emails,
      (select count(*)::int from crm.person_file_links
        where person_id = ${primary}) as file_links,
      (select introduced_by_person_id::text from crm.person_first_meetings
        where person_id = ${primary}) as introduced_by,
      (select place_text from crm.person_first_meetings
        where person_id = ${primary}) as meeting_place,
      (select count(*)::int from crm.activity_participants
        where activity_id = ${tea}) as participants,
      (select string_agg(
          case when from_person_id = ${primary} then 'primary' else 'third' end
          || '>' ||
          case when to_person_id = ${primary} then 'primary' else 'third' end,
          ',' order by from_person_id = ${primary} desc)
        from crm.relationships where workspace_id = ${workspaceId})
        as relationships,
      (select self_person_id::text from crm.workspace_members
        where id = ${secondMember}) as second_member_self,
      (select count(*)::int from crm.person_tags
        where person_id = ${primary}) as tags
  `;
  assertEquals(state, {
    avatar_source: "generated",
    birthdays: 1,
    cadence_interval: 7,
    cadence_last_contact: "2026-06-01",
    // Seven days after the duplicate's later contact, as an interaction
    // would have moved it.
    cadence_next_due: "2026-06-08",
    emails: "amazing@example.test:false,grace@example.test:true",
    file_links: 1,
    introduced_by: null,
    meeting_place: "Harvard",
    participants: 1,
    relationships: "primary>third,third>primary",
    second_member_self: primary,
    tags: 1,
  });
  assert(moved, "the distinct email moved");

  // Reminders: one birthday reminder, the moved date's reminder now the
  // primary's, and nothing twice under the unique delivery key.
  const duplicates = await sql`
    select occurrence.reminder_id, occurrence.member_id, occurrence.occurs_on,
      occurrence.channel, coalesce(occurrence.lead_time_days, -1), count(*)
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    where reminder.workspace_id = ${workspaceId}
    group by 1, 2, 3, 4, 5
    having count(*) > 1
  `;
  assertEquals(duplicates.length, 0, "a delivery key occurs twice");
  const [reminders] = await sql<{
    readonly birthday_reminders: number;
    readonly birthday_pending: number;
    readonly moved_owner: string;
    readonly moved_pending: number;
  }[]>`
    select
      (select count(*)::int from crm.reminders reminder
        join crm.person_dates date on date.id = reminder.person_date_id
        where date.kind = 'birthday' and reminder.deleted_at is null
          and reminder.workspace_id = ${workspaceId}) as birthday_reminders,
      (select count(*)::int from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        join crm.person_dates date on date.id = reminder.person_date_id
        where date.kind = 'birthday' and occurrence.status = 'pending'
          and reminder.workspace_id = ${workspaceId}) as birthday_pending,
      (select person_id::text from crm.reminders
        where person_date_id = ${customDate}) as moved_owner,
      (select count(*)::int from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        where reminder.person_date_id = ${customDate}
          and occurrence.status = 'pending') as moved_pending
  `;
  assertEquals(reminders?.birthday_reminders, 1);
  assert((reminders?.birthday_pending ?? 0) > 0, "the birthday is scheduled");
  assertEquals(reminders?.moved_owner, primary);
  assert((reminders?.moved_pending ?? 0) > 0, "the moved date is rescheduled");
  const [pausedReminder] = await sql<{
    readonly is_active: boolean;
    readonly pending: number;
    readonly person_id: string;
  }[]>`
    select reminder.person_id::text, reminder.is_active,
      (select count(*)::int from crm.reminder_occurrences occurrence
        where occurrence.reminder_id = reminder.id
          and occurrence.status = 'pending') as pending
    from crm.reminders reminder where reminder.person_date_id = ${pausedDate}
  `;
  assertEquals(pausedReminder, {
    person_id: primary,
    is_active: false,
    pending: 0,
  });

  const [audit] = await sql<{
    readonly discarded: readonly Record<string, unknown>[];
    readonly tables: Record<string, unknown>;
  }[]>`
    select payload->'tables' as tables, payload->'discarded' as discarded
    from crm.audit_events
    where action = 'people.person-merged' and person_id = ${primary}
  `;
  // A jsonb object reads back with its keys ordered by length.
  assertEquals(audit?.tables["crm.person_tags.person_id"], {
    removed: 1,
    relinked: 0,
  });
  assertEquals(audit?.tables["crm.person_dates.person_id"], {
    removed: 1,
    relinked: 2,
  });
  // The discarded facts, as they were, since a merge cannot be undone.
  assertEquals(audit?.discarded.map((entry) => entry.fact), [
    "birthday",
    "first-meeting",
    "avatar",
    "stay-in-touch",
  ]);
  assertEquals(audit?.discarded[0]?.notes, "From the Navy");
  assertEquals(audit?.discarded[0]?.day, 12);
  assertEquals(audit?.discarded[1]?.placeText, "Vassar");
  assertEquals(audit?.discarded[1]?.locationId, place);
  assertEquals(audit?.discarded[1]?.location, "Poughkeepsie");
  assertEquals(audit?.discarded[1]?.introducedByPersonId, third);
  assertEquals(audit?.discarded[1]?.introducedByName, "Howard Aiken");
  assertEquals(audit?.discarded[2]?.source, "external");
  assertEquals(audit?.discarded[3]?.intervalCount, 30);
});

Deno.test("[PEOPLE-008] a merge keeps the duplicate's not-duplicate decisions on the primary", async () => {
  const owner = await register("dismissals");
  const workspaceId = owner.workspaceId;
  const primary = await addPerson(owner, "Mary Somerville");
  const duplicate = await addPerson(owner, "Mary Somerville");
  const [other, both] = [
    await addPerson(owner, "Mary Shelley"),
    await addPerson(owner, "Mary Anning"),
  ];
  const pair = (a: string, b: string): readonly [string, string] =>
    a < b ? [a, b] : [b, a];
  for (
    const [low, high] of [
      pair(primary, duplicate),
      pair(duplicate, other),
      pair(duplicate, both),
      pair(primary, both),
    ]
  ) {
    await sql`
      insert into crm.person_duplicate_dismissals (
        workspace_id, person_low_id, person_high_id, dismissed_by_member_id
      ) values (${workspaceId}, ${low}, ${high}, ${owner.memberId})
    `;
  }

  const response = await merge(owner, primary, { duplicateId: duplicate });
  assertEquals(response.status, 200, await response.clone().text());

  const rows = await sql<{
    readonly high: string;
    readonly low: string;
    readonly member: string | null;
  }[]>`
    select person_low_id::text as low, person_high_id::text as high,
      dismissed_by_member_id::text as member
    from crm.person_duplicate_dismissals
    where workspace_id = ${workspaceId}
  `;
  // The merged pair is gone, the duplicate's decision about `other` is now
  // the primary's, and `both` is dismissed once.
  const byPair = (a: { readonly low: string; readonly high: string }, b: {
    readonly low: string;
    readonly high: string;
  }) => `${a.low}${a.high}` < `${b.low}${b.high}` ? -1 : 1;
  assertEquals(
    [...rows].sort(byPair),
    [pair(primary, other), pair(primary, both)]
      .map(([low, high]) => ({ low, high, member: owner.memberId }))
      .sort(byPair),
  );
  const [audit] = await sql<
    { readonly high: unknown; readonly low: unknown }[]
  >`
    select payload->'tables'->'crm.person_duplicate_dismissals.person_low_id'
        as low,
      payload->'tables'->'crm.person_duplicate_dismissals.person_high_id'
        as high
    from crm.audit_events
    where action = 'people.person-merged' and workspace_id = ${workspaceId}
  `;
  const moved = [audit?.low, audit?.high] as {
    readonly relinked: number;
    readonly removed: number;
  }[];
  assertEquals(
    [
      moved.reduce((sum, count) => sum + (count?.relinked ?? 0), 0),
      moved.reduce((sum, count) => sum + (count?.removed ?? 0), 0),
    ],
    [1, 2],
    "one decision rewritten, the merged pair and the repeat dropped",
  );
});

Deno.test("[PEOPLE-008] two people who both represent a member are not merged", async () => {
  const owner = await register("both-members");
  const primary = await addPerson(owner, "Radia Perlman");
  const duplicate = await addPerson(owner, "Radia Perlman");
  const other = await register("both-members-other");
  const member = await addMembership(
    sql,
    other.userId,
    owner.workspaceId,
    "member",
  );
  await sql`
    update crm.workspace_members set self_person_id = ${primary}
    where id = ${owner.memberId}
  `;
  await sql`
    update crm.workspace_members set self_person_id = ${duplicate}
    where id = ${member}
  `;
  for (
    const response of [
      await merge(owner, primary, { duplicateId: duplicate }),
      await api.request(
        owner,
        `/api/v1/people/${primary}/merge-preview?duplicateId=${duplicate}`,
      ),
    ]
  ) {
    assertEquals(response.status, 409);
    assertEquals(
      (await response.json() as { code: string }).code,
      "merge_both_members",
    );
  }
  const [state] = await sql<{
    readonly deleted: boolean;
    readonly selves: string;
  }[]>`
    select
      (select deleted_at is not null from crm.people where id = ${duplicate})
        as deleted,
      (select string_agg(self_person_id::text, ',' order by self_person_id)
        from crm.workspace_members
        where workspace_id = ${owner.workspaceId}) as selves
  `;
  assertEquals(state, {
    deleted: false,
    selves: [primary, duplicate].sort().join(","),
  });
});

Deno.test("[PEOPLE-008] a failing participant rolls the whole merge back", async () => {
  const owner = await register("rollback");
  const primary = await addPerson(owner, "Katherine Johnson");
  const duplicate = await addPerson(owner, "Katherine Johnson");
  const third = await addPerson(owner, "Dorothy Vaughan");
  await seedEveryReference(owner, duplicate, third);
  const before = await referenceCounts(duplicate);
  const connection = connectDatabase(databaseUrl);
  try {
    const shared = {
      actors: workspaceActors(),
    } as unknown as SharedComposition;
    const failing: PersonMergeParticipant = {
      countReferences: () => Promise.resolve({}),
      module: "failing",
      references: [],
      relinkPerson: () => Promise.reject(new Error("participant failed")),
    };
    const merger = createPersonMerge({
      actors: workspaceActors(),
      audit: personMergeAuditFrom(governanceAuditRecorder()),
      clock: { now: () => new Date() },
      // The merge rolls back, so no image is ever discarded.
      images: {
        discard: () => Promise.resolve({ status: "discarded" as const }),
      },
      logger: silentLogger(),
      participants: [...personMergeParticipants(), failing],
      publisher: personDateReminderPublisher(
        shared,
        composeWorkspaceBoundaries().reminderDelivery,
      ),
      repository: new PostgresPersonMergeRepository(),
      transaction: peopleTransactionRunner(connection.db),
    });
    let failure: unknown;
    try {
      await merger.merge(
        {
          memberId: owner.memberId,
          role: owner.role,
          userId: owner.userId,
          workspaceId: owner.workspaceId,
        },
        primary,
        {
          // The failing participant runs before anything is compared twice.
          conflictsDigest: (await (await preview(owner, primary, duplicate))
            .json() as { conflictsDigest: string }).conflictsDigest,
          duplicateId: duplicate,
          duplicateRevision: await revision(duplicate),
          primaryRevision: await revision(primary),
        },
      );
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof Error, "the merge fails");
  } finally {
    await connection.destroy();
  }
  assertEquals(await referenceCounts(duplicate), before);
  assertEquals(await importTargets(duplicate), 1);
  const [state] = await sql<{
    readonly deleted: boolean;
    readonly merges: number;
  }[]>`
    select
      (select deleted_at is not null from crm.people where id = ${duplicate})
        as deleted,
      (select count(*)::int from crm.audit_events
        where action = 'people.person-merged'
          and workspace_id = ${owner.workspaceId}) as merges
  `;
  assertEquals(state, { deleted: false, merges: 0 });
});

Deno.test("[PEOPLE-008] another workspace's, an archived, a stale, or the same person is refused", async () => {
  const owner = await register("refusals");
  const foreign = await register("refusals-foreign");
  const primary = await addPerson(owner, "Mary Jackson");
  const duplicate = await addPerson(owner, "Mary Jackson");
  const elsewhere = await addPerson(foreign, "Mary Jackson");
  await sql`
    insert into crm.notes (workspace_id, person_id, body)
    values (${owner.workspaceId}, ${duplicate}, 'Engineer')
  `;
  const cases: readonly [string, Promise<Response>, number, string][] = [
    [
      "a duplicate in another workspace",
      merge(owner, primary, { duplicateId: elsewhere }),
      404,
      "person_not_found",
    ],
    [
      "a primary in another workspace",
      merge(owner, elsewhere, { duplicateId: duplicate }),
      404,
      "person_not_found",
    ],
    [
      "another workspace's member",
      merge(foreign, primary, { duplicateId: duplicate }),
      404,
      "person_not_found",
    ],
    [
      "the same person",
      merge(owner, primary, { duplicateId: primary }),
      400,
      "merge_self",
    ],
    [
      "a stale duplicate revision",
      merge(owner, primary, {
        duplicateId: duplicate,
        duplicateRevision: "2020-01-01T00:00:00.000000Z",
      }),
      409,
      "person_stale",
    ],
    [
      "a stale primary revision",
      merge(owner, primary, {
        duplicateId: duplicate,
        primaryRevision: "2020-01-01T00:00:00.000000Z",
      }),
      409,
      "person_stale",
    ],
    [
      "an unconfirmed merge",
      merge(owner, primary, { confirmed: undefined, duplicateId: duplicate }),
      400,
      "validation_failed",
    ],
    [
      "a merge without the duplicate's revision",
      merge(owner, primary, {
        duplicateId: duplicate,
        duplicateRevision: undefined,
      }),
      400,
      "validation_failed",
    ],
  ];
  const foreignPreviews: readonly [
    string,
    Promise<Response>,
    number,
    string,
  ][] = [
    [
      "a preview of a primary in another workspace",
      preview(owner, elsewhere, duplicate),
      404,
      "person_not_found",
    ],
    [
      "a preview of a duplicate in another workspace",
      preview(owner, primary, elsewhere),
      404,
      "person_not_found",
    ],
  ];
  for (
    const [label, pending, status, code] of [...cases, ...foreignPreviews]
  ) {
    const response = await pending;
    const body = await response.json() as { readonly code: string };
    assertEquals(response.status, status, label);
    assertEquals(body.code, code, label);
  }
  const archived = await api.request(
    owner,
    `/api/v1/people/${duplicate}/archive`,
    "POST",
    { expectedUpdatedAt: await revision(duplicate) },
  );
  assertEquals(archived.status, 200);
  const refused = await merge(owner, primary, { duplicateId: duplicate });
  assertEquals(refused.status, 409);
  assertEquals(
    (await refused.json() as { code: string }).code,
    "archived_write_rejected",
  );
  const [still] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.notes where person_id = ${duplicate}
  `;
  assertEquals(still?.count, 1, "nothing moved");

  await revokeMembership(sql, owner.memberId);
  const revoked = await merge(owner, primary, { duplicateId: duplicate });
  assert(
    revoked.status === 401 || revoked.status === 403,
    `a removed member cannot merge (${revoked.status})`,
  );
});

Deno.test("[PEOPLE-008] a member may merge, as they may delete", async () => {
  const owner = await register("member-merge");
  const invited = await register("member-merge-invitee");
  await addMembership(sql, invited.userId, owner.workspaceId, "member");
  const signed = await api.signIn(
    (await sql<{ email: string }[]>`
      select email from crm.users where id = ${invited.userId}
    `)[0]!.email,
    { workspaceId: owner.workspaceId },
  );
  const cookie = sessionCookie(signed);
  assert(signed.status === 200 && cookie, "the member signs in");
  const member: SignedInFixture = {
    ...invited,
    cookie,
    role: "member",
    workspaceId: owner.workspaceId,
  };
  const primary = await addPerson(owner, "Annie Easley");
  const duplicate = await addPerson(owner, "Annie Easley");
  const response = await merge(member, primary, { duplicateId: duplicate });
  assertEquals(response.status, 200);
});

Deno.test("[PEOPLE-008] re-importing the same Monica export after a merge stays idempotent", async () => {
  const owner = await register("reimport");
  const source = {
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [
        { id: "contact:1", first_name: "Evelyn", last_name: "Boyd" },
        { id: "contact:2", first_name: "Evelyn", last_name: "Boyd" },
      ],
    },
  };
  const importOnce = async () => {
    const dry = await api.request(owner, "/api/v1/imports/dry-runs", "POST", {
      source,
    });
    assertEquals(dry.status, 201);
    const { importId } = await dry.json() as { importId: string };
    const committed = await api.request(
      owner,
      `/api/v1/imports/${importId}/commit`,
      "POST",
      { confirmed: true },
    );
    assertEquals(committed.status, 200);
    const body = await committed.json() as {
      readonly peopleCreated: number;
      readonly peopleReused: number;
    };
    return { created: body.peopleCreated, reused: body.peopleReused };
  };
  const people = () =>
    sql<{ readonly id: string }[]>`
      select id::text from crm.people
      where workspace_id = ${owner.workspaceId} and deleted_at is null
        and given_name = 'Evelyn'
      order by created_at, id
    `;
  assertEquals(await importOnce(), { created: 2, reused: 0 });
  const imported = await people();
  assertEquals(imported.length, 2);
  const [primary, duplicate] = imported.map((row) => row.id);
  assert(primary && duplicate, "both contacts became people");

  const merged = await merge(owner, primary, { duplicateId: duplicate });
  assertEquals(merged.status, 200);
  assertEquals(await importTargets(duplicate), 0);

  assertEquals(await importOnce(), { created: 0, reused: 2 });
  assertEquals(
    (await people()).map((row) => row.id),
    [primary],
    "the re-import lands on the primary and never recreates the duplicate",
  );
  const [deleted] = await sql<{ readonly deleted: boolean }[]>`
    select deleted_at is not null as deleted from crm.people
    where id = ${duplicate}
  `;
  assertEquals(deleted?.deleted, true);
});

Deno.test("[PEOPLE-008] the duplicate review pairs names, emails, and phones in the workspace", async () => {
  const owner = await register("review");
  const foreign = await register("review-foreign");
  const workspaceId = owner.workspaceId;
  const email = await contactType(workspaceId, "email");
  const phone = await contactType(workspaceId, "phone");
  const grace = await addPerson(owner, {
    familyName: "Hopper",
    givenName: "Grace",
    isPartial: false,
  });
  const graceAgain = await addPerson(owner, {
    familyName: " HOPPER ",
    givenName: "grace",
    isPartial: false,
  });
  const alan = await addPerson(owner, "Alan Turing");
  const al = await addPerson(owner, "Al");
  const joan = await addPerson(owner, "Joan Clarke");
  const jo = await addPerson(owner, "Jo");
  const lone = await addPerson(owner, "Lone Person");
  await contactMethod(alan, email, "alan@example.test");
  await contactMethod(al, email, " ALAN@example.test");
  await contactMethod(joan, phone, "+44 (20) 7946-0000");
  await contactMethod(jo, phone, "442079460000");
  await contactMethod(lone, phone, "123");
  await contactMethod(grace, phone, "123");
  const archived = await addPerson(owner, {
    familyName: "Hopper",
    givenName: "Grace",
    isPartial: false,
  });
  await sql`update crm.people set archived_at = now() where id = ${archived}`;
  await addPerson(foreign, {
    familyName: "Hopper",
    givenName: "Grace",
    isPartial: false,
  });

  const review = async () => {
    const response = await api.request(owner, "/api/v1/people/duplicates");
    assertEquals(response.status, 200);
    const body = await response.json() as {
      readonly pairs: readonly {
        readonly people: readonly { readonly id: string }[];
        readonly reasons: readonly string[];
      }[];
      readonly truncated: boolean;
    };
    assertEquals(body.truncated, false);
    return body.pairs.map((pair) => [
      pair.people.map((person) => person.id).join(" "),
      pair.reasons.join(","),
    ]);
  };
  assertEquals(await review(), [
    [`${grace} ${graceAgain}`, "name"],
    [`${alan} ${al}`, "email"],
    [`${joan} ${jo}`, "phone"],
  ]);
  // A value shared by more than five people is a placeholder, not a match:
  // it pairs nobody, so it can never build every pair of a crowd.
  for (let index = 0; index < 6; index += 1) {
    const crowd = await addPerson(owner, "Unknown Caller");
    await contactMethod(crowd, phone, "000 000 0000");
  }
  assertEquals(await review(), [
    [`${grace} ${graceAgain}`, "name"],
    [`${alan} ${al}`, "email"],
    [`${joan} ${jo}`, "phone"],
  ]);
  const merged = await merge(owner, grace, { duplicateId: graceAgain });
  assertEquals(merged.status, 200);
  assertEquals(await review(), [
    [`${alan} ${al}`, "email"],
    [`${joan} ${jo}`, "phone"],
  ]);
  const foreignReview = await api.request(foreign, "/api/v1/people/duplicates");
  assertEquals(
    (await foreignReview.json() as { pairs: unknown[] }).pairs,
    [],
    "another workspace's people are never paired with these",
  );
});

Deno.test("[PEOPLE-008] a pair marked not duplicates leaves every member's review", async () => {
  const owner = await register("dismiss");
  const foreign = await register("dismiss-foreign");
  const invited = await register("dismiss-invitee");
  await addMembership(sql, invited.userId, owner.workspaceId, "member");
  const signed = await api.signIn(
    (await sql<{ email: string }[]>`
      select email from crm.users where id = ${invited.userId}
    `)[0]!.email,
    { workspaceId: owner.workspaceId },
  );
  const cookie = sessionCookie(signed);
  assert(signed.status === 200 && cookie, "the member signs in");
  const member: SignedInFixture = {
    ...invited,
    cookie,
    memberId: (await sql<{ readonly id: string }[]>`
      select id::text from crm.workspace_members
      where user_id = ${invited.userId} and workspace_id = ${owner.workspaceId}
    `)[0]!.id,
    role: "member",
    workspaceId: owner.workspaceId,
  };
  const first = await addPerson(owner, "Mary Jackson");
  const second = await addPerson(owner, "Mary Jackson");
  const kept = await addPerson(owner, "Dorothy Vaughan");
  const keptAgain = await addPerson(owner, "Dorothy Vaughan");
  const outsider = await addPerson(foreign, "Mary Jackson");
  const [low, high] = [first, second].sort() as [string, string];
  const review = async (fixture: SignedInFixture) => {
    const response = await api.request(fixture, "/api/v1/people/duplicates");
    assertEquals(response.status, 200);
    const body = await response.json() as {
      readonly pairs: readonly {
        readonly people: readonly { readonly id: string }[];
      }[];
    };
    return body.pairs.map((pair) =>
      pair.people.map((person) => person.id).sort().join(" ")
    );
  };
  const both = [`${low} ${high}`, [kept, keptAgain].sort().join(" ")];
  assertEquals(await review(owner), both);
  const dismiss = (fixture: SignedInFixture, personIds: readonly string[]) =>
    api.request(fixture, "/api/v1/people/duplicates/dismissals", "POST", {
      personIds,
    });
  const stored = () =>
    sql<{
      readonly by: string | null;
      readonly high: string;
      readonly low: string;
      readonly workspace: string;
    }[]>`
      select workspace_id::text as workspace, person_low_id::text as low,
        person_high_id::text as high, dismissed_by_member_id::text as by
      from crm.person_duplicate_dismissals
      where workspace_id in (${owner.workspaceId}, ${foreign.workspaceId})
      order by created_at
    `;
  const audits = async () =>
    (await sql<{ readonly payload: unknown }[]>`
      select payload - 'requestId' as payload from crm.audit_events
      where workspace_id = ${owner.workspaceId}
        and action = 'people.duplicate-dismissed'
    `).map((row) => row.payload);

  // Another workspace's person, a person paired with themselves, and a
  // deleted person are refused, and nothing is stored.
  assertEquals((await dismiss(owner, [first, outsider])).status, 404);
  assertEquals((await dismiss(foreign, [outsider, first])).status, 404);
  assertEquals((await dismiss(owner, [first, first])).status, 400);
  const gone = await addPerson(owner, "Mary Jackson");
  await sql`update crm.people set deleted_at = now() where id = ${gone}`;
  assertEquals((await dismiss(owner, [first, gone])).status, 404);
  assertEquals(await stored(), []);

  const dismissed = await dismiss(member, [high, low]);
  assertEquals(dismissed.status, 200);
  assertEquals(await dismissed.json(), {
    personIds: [low, high],
    status: "dismissed",
  });
  assertEquals(
    (await stored()).map((row) => [row.workspace, row.low, row.high, row.by]),
    [[owner.workspaceId, low, high, member.memberId]],
    "stored once, lower id first, as the member who dismissed it",
  );
  assertEquals(await review(owner), [both[1]], "the owner no longer sees it");
  assertEquals(await review(member), [both[1]], "nor does the member");
  assertEquals(await audits(), [{ personIds: [low, high] }]);

  // Dismissing it again, from either side, changes nothing.
  assertEquals((await dismiss(owner, [low, high])).status, 200);
  assertEquals((await stored()).length, 1);
  assertEquals((await audits()).length, 1);
});

Deno.test("[PEOPLE-008] a merge whose conflicts changed after its preview is refused", async () => {
  const owner = await register("conflicts-changed");
  const primary = await addPerson(owner, "Annie Easley");
  const duplicate = await addPerson(owner, "Annie Easley");
  const birthday = {
    day: 23,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 4,
    precision: "month_day",
  };
  const created = await importantDateRequest(
    api,
    owner,
    duplicate,
    "POST",
    birthday,
  );
  assertEquals(created.status, 201);
  const duplicateBirthday = (await created.json() as {
    date: { id: string; updatedAt: string };
  }).date;
  // The same interval on both is nothing to discard.
  await sql`
    insert into crm.stay_in_touch_cadences (person_id, interval_count)
    values (${primary}, 14), (${duplicate}, 14)
  `;

  const read = async () => {
    const response = await preview(owner, primary, duplicate);
    assertEquals(response.status, 200);
    return await response.json() as {
      readonly conflicts: readonly { readonly fact: string }[];
      readonly conflictsDigest: string;
    };
  };
  const confirm = async (conflictsDigest: string) =>
    await api.request(owner, `/api/v1/people/${primary}/merge`, "POST", {
      confirmed: true,
      conflictsDigest,
      duplicateId: duplicate,
      duplicateRevision: await revision(duplicate),
      primaryRevision: await revision(primary),
    });
  const refused = async (response: Response, label: string) => {
    assertEquals(response.status, 409, label);
    assertEquals(
      (await response.json() as { code: string }).code,
      "merge_conflicts_changed",
      label,
    );
    const [state] = await sql<{ readonly deleted: boolean }[]>`
      select deleted_at is not null as deleted from crm.people
      where id = ${duplicate}
    `;
    assertEquals(state?.deleted, false, label);
  };

  // Nothing conflicts at first; then the primary gains a birthday, which
  // moves neither person's revision.
  const first = await read();
  assertEquals(first.conflicts, []);
  const added = await importantDateRequest(api, owner, primary, "POST", {
    ...birthday,
    day: 24,
  });
  assertEquals(added.status, 201);
  await refused(await confirm(first.conflictsDigest), "a birthday was added");

  // Now the birthday conflicts; then the duplicate's is edited.
  const second = await read();
  assertEquals(second.conflicts.map((entry) => entry.fact), ["birthday"]);
  const edited = await importantDateRequest(
    api,
    owner,
    duplicate,
    "PATCH",
    { ...birthday, day: 25, expectedUpdatedAt: duplicateBirthday.updatedAt },
    duplicateBirthday.id,
  );
  assertEquals(edited.status, 200);
  await refused(
    await confirm(second.conflictsDigest),
    "the duplicate's birthday was edited",
  );

  // Confirmed against what is true now, the merge goes through.
  const third = await read();
  assertEquals(third.conflictsDigest === second.conflictsDigest, false);
  const merged = await confirm(third.conflictsDigest);
  assertEquals(merged.status, 200, await merged.clone().text());
});
