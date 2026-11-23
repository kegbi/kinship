/**
 * Resetting and deleting a workspace that holds real data (SECT-03, SECT-05).
 *
 * The impact suite beside this one proves what a preview counts; this one
 * runs the destructive half. Each test seeds two workspaces with a row in
 * every table a workspace owns — directly or through a person, a thread, an
 * activity, a debt, or any other parent — including the contact method and
 * relationship whose `RESTRICT` keys used to abort the cascade with a 503.
 * The owner of the first then resets or deletes it over HTTP.
 *
 * A destroyed workspace leaves no row carrying its id, except the lifecycle
 * record that is deliberately kept (and, after a reset, the workspace shell
 * the reset preserves). The second workspace is compared row for row before
 * and after, and a member of both keeps the session they use there: only a
 * user whose sole active membership was the destroyed workspace is signed out.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  openSql,
  requireDatabaseUrl,
  resetDatabase,
  type Sql,
} from "../support/database.ts";
import { apiSupport, PASSWORD, type SignedInFixture } from "../support/api.ts";
import {
  describePlan,
  type PlanNode,
  planNodes,
  withScratchCrm,
} from "../support/query_plan.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { max: 4, prepare: false });
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
const api = apiSupport(configured.app, mail, sql);

/** Instance-wide catalogs the seed references; no workspace owns them. */
const GLOBAL_TABLES = [
  "crm.emotion_options",
  "crm.pet_categories",
  "crm.legal_documents",
] as const;

/**
 * Tables allowed to keep the destroyed workspace's id: the lifecycle record
 * is a snapshot by design and deliberately has no foreign key.
 */
const RETAINED_AFTER_DELETE = new Set([
  "workspace_lifecycle_records",
]);

/** What a reset keeps: the workspace shell, its members, and their settings. */
const RETAINED_AFTER_RESET = new Set([
  ...RETAINED_AFTER_DELETE,
  "audit_events",
  // v15 (REL-120): the kept members keep their preferences, which now carry
  // the workspace.
  "member_preferences",
  "workspace_members",
  "workspace_profile_modules",
  "workspace_settings",
  "workspaces",
]);

/** Tables that carry rows of a workspace although they have no such column. */
const CHILD_TABLES = [
  "activity_emotions",
  "activity_participants",
  "billing_subscription_items",
  "billing_subscriptions",
  "call_emotions",
  "data_import_entities",
  "data_import_reports",
  "gift_file_links",
  "location_weather_cache",
  "member_preferences",
  "messages",
  "person_address_labels",
  "person_addresses",
  "person_avatars",
  "person_contact_method_labels",
  "person_contact_methods",
  "person_dates",
  "person_file_links",
  "person_first_meetings",
  "person_occupations",
  "person_tags",
  "pets",
  "reminder_occurrences",
  "romantic_relationship_details",
  "stay_in_touch_cadences",
] as const;

/** Every base table in `crm` with a `workspace_id` column. */
async function workspaceTables(): Promise<readonly string[]> {
  const rows = await sql<{ readonly table: string }[]>`
    select c.table_name as table from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema
      and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'crm' and c.column_name = 'workspace_id'
    order by 1`;
  return rows.map((row) => row.table);
}

/** How many rows of each workspace-scoped table carry the workspace id. */
async function rowsCarrying(
  workspaceId: string,
): Promise<Readonly<Record<string, number>>> {
  const counts: Record<string, number> = {};
  for (const table of await workspaceTables()) {
    const [row] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from ${sql("crm." + table)}
      where workspace_id = ${workspaceId}::uuid`;
    counts[table] = row?.count ?? 0;
  }
  const [workspace] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.workspaces
    where id = ${workspaceId}::uuid`;
  counts.workspaces = workspace?.count ?? 0;
  return counts;
}

/**
 * A digest of everything a workspace owns, so a mutation of its neighbour can
 * be shown to have changed nothing here. Child rows are reached through the
 * people, members, and parents the workspace owns.
 */
async function digest(workspaceId: string): Promise<string> {
  const parts: string[] = [];
  for (const table of await workspaceTables()) {
    if (table === "api_request_logs") continue;
    const [row] = await sql<{ readonly digest: string }[]>`
      select md5(coalesce(string_agg(to_jsonb(t)::text, '|'
        order by to_jsonb(t)::text), '')) as digest
      from ${
      sql("crm." + table)
    } t where t.workspace_id = ${workspaceId}::uuid`;
    parts.push(`${table}:${row?.digest}`);
  }
  const [children] = await sql<{ readonly digest: string }[]>`
    select md5(concat_ws('|',
      (select string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text)
        from crm.person_contact_methods t join crm.people p on p.id = t.person_id
        where p.workspace_id = ${workspaceId}::uuid),
      (select string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text)
        from crm.person_dates t join crm.people p on p.id = t.person_id
        where p.workspace_id = ${workspaceId}::uuid),
      (select string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text)
        from crm.member_preferences t
        join crm.workspace_members m on m.id = t.member_id
        where m.workspace_id = ${workspaceId}::uuid),
      (select string_agg(to_jsonb(t)::text, ',' order by to_jsonb(t)::text)
        from crm.messages t
        join crm.conversation_threads c on c.id = t.conversation_id
        where c.workspace_id = ${workspaceId}::uuid)
    )) as digest`;
  parts.push(`children:${children?.digest}`);
  return parts.join("\n");
}

/** The instance catalogs every seeded workspace shares. */
async function seedCatalogs(): Promise<{
  readonly emotionId: string;
  readonly legalDocumentId: string;
  readonly petCategoryId: string;
}> {
  const [emotion] = await sql<{ readonly id: string }[]>`
    insert into crm.emotion_options (name) values ('Joy') returning id::text`;
  const [pet] = await sql<{ readonly id: string }[]>`
    insert into crm.pet_categories (name) values ('Cat') returning id::text`;
  const [legal] = await sql<{ readonly id: string }[]>`
    insert into crm.legal_documents (document_type, version, content)
    values ('terms', 'erasure-test', 'Terms') returning id::text`;
  assert(emotion && pet && legal, "the shared catalogs are seeded");
  return {
    emotionId: emotion.id,
    legalDocumentId: legal.id,
    petCategoryId: pet.id,
  };
}

/** One row in every table the workspace owns, with every optional link set. */
async function seedEverything(
  db: Sql,
  catalogs: Awaited<ReturnType<typeof seedCatalogs>>,
  fixture: SignedInFixture,
): Promise<void> {
  const w = fixture.workspaceId;
  const m = fixture.memberId;
  const u = fixture.userId;
  const id = async (
    query: Promise<readonly { readonly id: string }[]>,
  ): Promise<string> => {
    const [row] = await query;
    assert(row, "the seed row is inserted");
    return row.id;
  };
  await db.begin(async (tx) => {
    // Vocabularies, each reached by a person-owned row below.
    const gender = await id(
      tx`insert into crm.gender_options (workspace_id, name)
      values (${w}, 'Erasure gender') returning id::text`,
    );
    await tx`update crm.workspace_settings set default_gender_option_id = ${gender}
      where workspace_id = ${w}`;
    const methodType = await id(tx`insert into crm.contact_method_types
      (workspace_id, name) values (${w}, 'Erasure phone') returning id::text`);
    const label = await id(
      tx`insert into crm.contact_labels (workspace_id, label)
      values (${w}, 'Erasure home') returning id::text`,
    );
    const activityCategory = await id(
      tx`insert into crm.activity_type_categories
      (workspace_id, name) values (${w}, 'Erasure outings') returning id::text`,
    );
    const activityType = await id(tx`insert into crm.activity_types
      (workspace_id, category_id, name)
      values (${w}, ${activityCategory}, 'Erasure walk') returning id::text`);
    const eventCategory = await id(tx`insert into crm.life_event_categories
      (workspace_id, name) values (${w}, 'Erasure milestones') returning id::text`);
    const eventType = await id(tx`insert into crm.life_event_types
      (workspace_id, category_id, name)
      values (${w}, ${eventCategory}, 'Erasure move') returning id::text`);
    const relationshipGroup = await id(
      tx`insert into crm.relationship_type_groups
      (workspace_id, name) values (${w}, 'Erasure kin') returning id::text`,
    );
    const relationshipType = await id(tx`insert into crm.relationship_types
      (workspace_id, group_id, forward_label, reverse_label)
      values (${w}, ${relationshipGroup}, 'partner of', 'partner of')
      returning id::text`);
    const tag = await id(tx`insert into crm.tags (workspace_id, name, slug)
      values (${w}, 'Erasure', 'erasure') returning id::text`);
    const organization = await id(tx`insert into crm.organizations
      (workspace_id, name) values (${w}, 'Erasure Ltd') returning id::text`);
    const location = await id(tx`insert into crm.locations (workspace_id, city)
      values (${w}, 'Erasureville') returning id::text`);
    await tx`insert into crm.location_weather_cache
      (location_id, provider, payload, workspace_id)
      values (${location}, 'test', '{}'::jsonb, ${w})`;
    await tx`insert into crm.reminder_rules (workspace_id, days_before)
      values (${w}, 3)`;
    await tx`insert into crm.workspace_profile_modules (workspace_id, key)
      values (${w}, 'erasure')`;

    // People and everything a person owns.
    const ada = await id(tx`insert into crm.people
      (workspace_id, given_name, gender_option_id, created_by_member_id)
      values (${w}, 'Ada', ${gender}, ${m}) returning id::text`);
    const grace = await id(tx`insert into crm.people
      (workspace_id, given_name, created_by_member_id)
      values (${w}, 'Grace', ${m}) returning id::text`);
    await tx`update crm.workspace_members set self_person_id = ${ada}
      where id = ${m}`;
    const [low, high] = ada < grace ? [ada, grace] : [grace, ada];
    await tx`insert into crm.person_duplicate_dismissals
      (workspace_id, person_low_id, person_high_id, dismissed_by_member_id)
      values (${w}, ${low}, ${high}, ${m})`;
    const method = await id(tx`insert into crm.person_contact_methods
      (person_id, type_id, value, workspace_id) values (${ada}, ${methodType}, '555-0101', (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))
      returning id::text`);
    await tx`insert into crm.person_contact_method_labels
      (contact_method_id, label_id, workspace_id) values (${method}, ${label}, (select scope.workspace_id from crm.person_contact_methods scope where scope.id = ${method}::uuid))`;
    const address = await id(tx`insert into crm.person_addresses
      (person_id, location_id, workspace_id) values (${ada}, ${location}, (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid)) returning id::text`);
    await tx`insert into crm.person_address_labels (address_id, label_id, workspace_id)
      values (${address}, ${label}, (select scope.workspace_id from crm.person_addresses scope where scope.id = ${address}::uuid))`;
    const birthday = await id(tx`insert into crm.person_dates
      (person_id, kind, year, month, day, precision, workspace_id)
      values (${ada}, 'birthday', 1815, 12, 10, 'full', (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid)) returning id::text`);
    await tx`insert into crm.person_first_meetings
      (person_id, introduced_by_person_id, location_id, workspace_id)
      values (${ada}, ${grace}, ${location}, (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))`;
    await tx`insert into crm.person_occupations
      (person_id, organization_id, title, workspace_id)
      values (${ada}, ${organization}, 'Analyst', (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))`;
    await tx`insert into crm.person_tags (person_id, tag_id, workspace_id)
      values (${ada}, ${tag}, (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))`;
    await tx`insert into crm.pets (person_id, category_id, name, workspace_id)
      values (${ada}, ${catalogs.petCategoryId}, 'Tabby', ${w})`;

    // Relationships, including the RESTRICT key on the type.
    const relationship = await id(tx`insert into crm.relationships
      (workspace_id, from_person_id, to_person_id, relationship_type_id)
      values (${w}, ${ada}, ${grace}, ${relationshipType}) returning id::text`);
    await tx`insert into crm.romantic_relationship_details
      (relationship_id, workspace_id) values (${relationship}, ${w})`;

    // Files and what links to them.
    const file = await id(tx`insert into crm.files
      (workspace_id, uploaded_by_member_id, storage_key, original_filename)
      values (${w}, ${m}, ${`workspaces/${w}/erasure.png`}, 'erasure.png')
      returning id::text`);
    await tx`insert into crm.person_avatars (person_id, source, file_id, workspace_id)
      values (${ada}, 'file', ${file}, (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))`;
    await tx`insert into crm.person_file_links (person_id, file_id, kind, workspace_id)
      values (${ada}, ${file}, 'document', (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid))`;

    // Interactions.
    const activity = await id(tx`insert into crm.activities
      (workspace_id, activity_type_id, summary, happened_at, created_by_member_id)
      values (${w}, ${activityType}, 'Walk', now(), ${m}) returning id::text`);
    await tx`insert into crm.activity_participants (activity_id, person_id, workspace_id)
      values (${activity}, ${ada}, (select scope.workspace_id from crm.activities scope where scope.id = ${activity}::uuid))`;
    await tx`insert into crm.activity_emotions (activity_id, emotion_id, workspace_id)
      values (${activity}, ${catalogs.emotionId}, ${w})`;
    const call = await id(tx`insert into crm.calls
      (workspace_id, person_id, called_at, created_by_member_id)
      values (${w}, ${ada}, now(), ${m}) returning id::text`);
    await tx`insert into crm.call_emotions (call_id, emotion_id, workspace_id)
      values (${call}, ${catalogs.emotionId}, ${w})`;
    const thread = await id(tx`insert into crm.conversation_threads
      (workspace_id, person_id, channel_type_id, contact_method_id, happened_at)
      values (${w}, ${ada}, ${methodType}, ${method}, now()) returning id::text`);
    await tx`insert into crm.messages
      (conversation_id, author_member_id, content, written_at, direction, workspace_id)
      values (${thread}, ${m}, 'Hello', now(), 'outbound', (select scope.workspace_id from crm.conversation_threads scope where scope.id = ${thread}::uuid))`;
    await tx`insert into crm.notes (workspace_id, person_id, body, created_by_member_id)
      values (${w}, ${ada}, 'A note', ${m})`;

    // Journal.
    const post = await id(tx`insert into crm.journal_posts
      (workspace_id, body, created_by_member_id)
      values (${w}, 'Dear diary', ${m}) returning id::text`);
    const rating = await id(tx`insert into crm.journal_day_ratings
      (workspace_id, rated_on, rating, created_by_member_id)
      values (${w}, current_date, 3, ${m}) returning id::text`);
    await tx`insert into crm.journal_items
      (workspace_id, occurred_at, journal_post_id, created_by_member_id)
      values (${w}, now(), ${post}, ${m})`;
    await tx`insert into crm.journal_items (workspace_id, occurred_at, day_rating_id)
      values (${w}, now(), ${rating})`;
    await tx`insert into crm.journal_items (workspace_id, occurred_at, activity_id)
      values (${w}, now(), ${activity})`;

    // Life events and planning.
    const lifeEvent = await id(tx`insert into crm.life_events
      (workspace_id, person_id, life_event_type_id, name)
      values (${w}, ${ada}, ${eventType}, 'Moved') returning id::text`);
    const task = await id(tx`insert into crm.tasks
      (workspace_id, person_id, title, created_by_member_id)
      values (${w}, ${ada}, 'Call Ada', ${m}) returning id::text`);
    const reminder = await id(tx`insert into crm.reminders
      (workspace_id, person_id, person_date_id, target_kind, title, anchor_on,
        created_by_member_id)
      values (${w}, ${ada}, ${birthday}, 'person_date', 'Birthday',
        current_date, ${m}) returning id::text`);
    await tx`insert into crm.reminders
      (workspace_id, life_event_id, target_kind, title, anchor_on)
      values (${w}, ${lifeEvent}, 'life_event', 'Anniversary', current_date)`;
    await tx`insert into crm.reminders
      (workspace_id, task_id, target_kind, title, anchor_on)
      values (${w}, ${task}, 'task', 'Task due', current_date)`;
    await tx`insert into crm.reminder_occurrences
      (reminder_id, member_id, occurs_on, deliver_at, workspace_id)
      values (${reminder}, ${m}, current_date, now(), (select scope.workspace_id from crm.reminders scope where scope.id = ${reminder}::uuid))`;
    const cadence = await id(tx`insert into crm.stay_in_touch_cadences
      (person_id, interval_count, reminder_id, workspace_id)
      values (${ada}, 2, ${reminder}, (select scope.workspace_id from crm.people scope where scope.id = ${ada}::uuid)) returning id::text`);
    await tx`insert into crm.stay_in_touch_cadence_requests
      (workspace_id, request_id, cadence_id, request_fingerprint)
      values (${w}, ${crypto.randomUUID()}, ${cadence}, ${"a".repeat(64)})`;

    // Gifts and debts.
    const gift = await id(tx`insert into crm.gifts
      (workspace_id, person_id, recipient_person_id, name)
      values (${w}, ${ada}, ${grace}, 'Book') returning id::text`);
    await tx`insert into crm.gift_file_links (gift_id, file_id, workspace_id)
      values (${gift}, ${file}, (select scope.workspace_id from crm.gifts scope where scope.id = ${gift}::uuid))`;
    const recurring = await id(tx`insert into crm.recurring_debts
      (workspace_id, person_id, direction, amount, currency_code,
        day_of_month, starts_on, created_by_member_id)
      values (${w}, ${ada}, 'they_owe', 10, 'USD', 1, current_date, ${m})
      returning id::text`);
    const debt = await id(tx`insert into crm.debts
      (workspace_id, person_id, direction, amount, currency_code,
        recurring_debt_id, occurrence_on)
      values (${w}, ${ada}, 'they_owe', 10, 'USD', ${recurring}, current_date)
      returning id::text`);
    await tx`insert into crm.debt_settlements
      (workspace_id, debt_id, settled_at, photo_file_id, created_by_member_id)
      values (${w}, ${debt}, now(), ${file}, ${m})`;

    // Integrations.
    const book = await id(tx`insert into crm.dav_address_books
      (workspace_id, owner_member_id, name)
      values (${w}, ${m}, 'Erasure book') returning id::text`);
    const subscription = await id(
      tx`insert into crm.dav_address_book_subscriptions
      (workspace_id, owner_member_id, local_address_book_id, name, remote_url)
      values (${w}, ${m}, ${book}, 'Remote', 'https://dav.example.test/')
      returning id::text`,
    );
    await tx`insert into crm.dav_objects
      (workspace_id, address_book_id, subscription_id, object_kind, person_id)
      values (${w}, ${book}, ${subscription}, 'person', ${ada})`;
    await tx`insert into crm.dav_objects
      (workspace_id, address_book_id, object_kind, task_id)
      values (${w}, ${book}, 'task', ${task})`;
    await tx`insert into crm.dav_sync_tokens (workspace_id, member_id, sync_token)
      values (${w}, ${m}, ${`sync-${w}`})`;

    // Import and export.
    const dataImport = await id(tx`insert into crm.data_imports
      (workspace_id, requested_by_member_id, source_system, artifact_file_id)
      values (${w}, ${m}, 'monica', ${file}) returning id::text`);
    const entity = await id(tx`insert into crm.data_import_entities
      (import_id, source_table, status, workspace_id)
      values (${dataImport}, 'contacts', 'mapped', ${w}) returning id::text`);
    await tx`insert into crm.data_import_reports
      (import_id, entity_id, severity, message, workspace_id)
      values (${dataImport}, ${entity}, 'info', 'Imported', ${w})`;
    await tx`insert into crm.data_exports
      (workspace_id, requested_by_member_id, format, file_id)
      values (${w}, ${m}, 'json', ${file})`;

    // Governance, operations, access, and billing.
    await tx`insert into crm.audit_events
      (workspace_id, actor_member_id, person_id, action)
      values (${w}, ${m}, ${ada}, 'erasure.seeded')`;
    // v16 (MCP-E3): a reset or a delete removes the request tombstones with
    // the workspace, so a key may create its record again after a reset.
    await tx`insert into crm.request_tombstones
      (workspace_id, record_id, record_type)
      values (${w}, ${crypto.randomUUID()}, 'note')`;
    await tx`insert into crm.statistics_snapshots (workspace_id, scope, counters)
      values (${w}, 'workspace', '{}'::jsonb)`;
    await tx`insert into crm.api_tokens (user_id, workspace_id, name, token_hash)
      values (${u}, ${w}, 'Erasure token', ${`hash-${w}`})`;
    await tx`insert into crm.legal_acceptances
      (workspace_id, user_id, legal_document_id)
      values (${w}, ${u}, ${catalogs.legalDocumentId})`;
    await tx`insert into crm.workspace_invitations
      (workspace_id, invited_by_member_id, email, token_hash, role)
      values (${w}, ${m}, ${`invitee-${w}@example.test`}, ${`invite-${w}`},
        'member')`;
    const customer = await id(tx`insert into crm.billing_customers
      (workspace_id, provider_customer_id)
      values (${w}, ${`cus-${w}`}) returning id::text`);
    const billing = await id(tx`insert into crm.billing_subscriptions
      (billing_customer_id, provider_subscription_id, status, workspace_id)
      values (${customer}, 'sub-1', 'active', ${w}) returning id::text`);
    await tx`insert into crm.billing_subscription_items
      (subscription_id, provider_item_id, provider_price_id, workspace_id)
      values (${billing}, 'item-1', 'price-1', ${w})`;
  });
}

/** Two owners, a member of both, and every table seeded in both workspaces. */
async function seededPair(prefix: string): Promise<{
  readonly member: SignedInFixture;
  readonly owner: SignedInFixture;
}> {
  await resetDatabase(sql, [...GLOBAL_TABLES]);
  const owner = await api.register(`${prefix}-owner@example.test`, "Erased");
  // The member's own workspace is kept; they also belong to the erased one.
  const member = await api.register(`${prefix}-member@example.test`, "Kept");
  await addMembership(sql, member.userId, owner.workspaceId, "admin");
  const catalogs = await seedCatalogs();
  await seedEverything(sql, catalogs, owner);
  await seedEverything(sql, catalogs, member);

  const seeded = await rowsCarrying(owner.workspaceId);
  const empty = Object.entries(seeded)
    .filter(([table, count]) =>
      count === 0 && table !== "workspace_lifecycle_records" &&
      table !== "api_request_logs"
    )
    .map(([table]) => table);
  assert(
    empty.length === 0,
    `the seed reaches every workspace table, missing ${empty.join(", ")}`,
  );
  for (const table of CHILD_TABLES) {
    const [row] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from ${sql("crm." + table)}`;
    assert(
      (row?.count ?? 0) >= 2,
      `the seed reaches ${table} in both workspaces`,
    );
  }
  return { member, owner };
}

async function preview(owner: SignedInFixture): Promise<{
  readonly confirmations: {
    readonly deleteWorkspace: string;
    readonly resetWorkspace: string;
  };
  readonly impactToken: string;
}> {
  const response = await api.request(
    owner,
    "/api/v1/settings/workspace-lifecycle",
  );
  assert(response.status === 200, `preview answered ${response.status}`);
  return await response.json();
}

async function sessionStatus(
  fixture: SignedInFixture,
  workspaceId: string,
): Promise<number> {
  const response = await api.request(
    fixture,
    "/api/v1/session",
    "GET",
    undefined,
    workspaceId,
  );
  await response.body?.cancel();
  return response.status;
}

function leftovers(
  counts: Readonly<Record<string, number>>,
  retained: ReadonlySet<string>,
): readonly string[] {
  return Object.entries(counts)
    .filter(([table, count]) => count > 0 && !retained.has(table))
    .map(([table, count]) => `${table}=${count}`);
}

Deno.test({
  name:
    "WORKSPACE-002 deleting a workspace with every module seeded removes only its rows",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { member, owner } = await seededPair("erasure-delete");
    const memberWorkspaceBefore = await digest(member.workspaceId);
    const shown = await preview(owner);

    const response = await api.request(
      owner,
      "/api/v1/settings/workspace-lifecycle",
      "DELETE",
      {
        confirmation: shown.confirmations.deleteWorkspace,
        impactToken: shown.impactToken,
        password: PASSWORD,
      },
    );
    const body = await response.text();
    assert(
      response.status === 200,
      `delete answered ${response.status}: ${body}`,
    );

    const remaining = leftovers(
      await rowsCarrying(owner.workspaceId),
      RETAINED_AFTER_DELETE,
    );
    assert(
      remaining.length === 0,
      `the deleted workspace left ${remaining.join(", ")}`,
    );
    assert(
      await digest(member.workspaceId) === memberWorkspaceBefore,
      "deleting one workspace changed a row of another",
    );
    assert(
      await sessionStatus(member, member.workspaceId) === 200,
      "a member of both workspaces keeps the session they use elsewhere",
    );
    assert(
      await sessionStatus(owner, owner.workspaceId) === 401,
      "the owner whose only workspace was deleted is signed out",
    );
  },
});

Deno.test({
  name:
    "WORKSPACE-002 resetting a workspace with every module seeded keeps only its shell",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const { member, owner } = await seededPair("erasure-reset");
    const memberWorkspaceBefore = await digest(member.workspaceId);
    const shown = await preview(owner);

    const response = await api.request(
      owner,
      "/api/v1/settings/workspace-lifecycle/reset",
      "POST",
      {
        confirmation: shown.confirmations.resetWorkspace,
        impactToken: shown.impactToken,
        password: PASSWORD,
      },
    );
    const body = await response.text();
    assert(
      response.status === 200,
      `reset answered ${response.status}: ${body}`,
    );

    const after = await rowsCarrying(owner.workspaceId);
    const remaining = leftovers(after, RETAINED_AFTER_RESET);
    assert(
      remaining.length === 0,
      `the reset workspace kept ${remaining.join(", ")}`,
    );
    assert(after.workspaces === 1, "the reset keeps the workspace row");
    assert(
      after.workspace_members === 2,
      `the reset keeps both members, found ${after.workspace_members}`,
    );
    const [seededAudit] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.audit_events
      where workspace_id = ${owner.workspaceId}::uuid
        and action = 'erasure.seeded'`;
    assert(seededAudit?.count === 0, "the reset clears the audit trail");
    assert(
      await digest(member.workspaceId) === memberWorkspaceBefore,
      "resetting one workspace changed a row of another",
    );
    assert(
      await sessionStatus(member, member.workspaceId) === 200,
      "a member of both workspaces keeps the session they use elsewhere",
    );
    assert(
      await sessionStatus(owner, owner.workspaceId) === 401,
      "the owner whose only workspace was reset is signed out",
    );
  },
});

Deno.test({
  name:
    "WORKSPACE-002 AUD-V1 a removed member's reminder occurrences cascade through a member index",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withScratchCrm(sql, databaseUrl, async ({ sql: scratch }) => {
      // Forty workspaces of two members, each member with two years of a
      // monthly reminder for fifty people: D5 keeps the sent history, so
      // nearly every occurrence is outside both partial member indexes.
      await scratch`
        insert into crm.users (id, email)
        select md5('user' || n)::uuid, 'cascade-' || n || '@example.test'
        from generate_series(1, 80) n
      `;
      await scratch`
        insert into crm.workspaces (id, name, created_by_user_id)
        select md5('workspace' || w)::uuid, 'Workspace ' || w,
          md5('user' || 2 * w - 1)::uuid
        from generate_series(1, 40) w
      `;
      await scratch`
        insert into crm.workspace_members (id, workspace_id, user_id, role,
          status, joined_at)
        select md5('member' || n)::uuid, md5('workspace' || (n + 1) / 2)::uuid,
          md5('user' || n)::uuid,
          case when n % 2 = 1 then 'owner' else 'member' end, 'active', now()
        from generate_series(1, 80) n
      `;
      await scratch`
        insert into crm.people (id, workspace_id, given_name)
        select md5('person' || p)::uuid,
          md5('workspace' || (p - 1) / 50 + 1)::uuid, 'Person ' || p
        from generate_series(1, 2000) p
      `;
      await scratch`
        insert into crm.reminders (id, workspace_id, person_id, target_kind,
          title, anchor_on, recurrence_unit, created_by_member_id)
        select md5('reminder' || p)::uuid,
          md5('workspace' || (p - 1) / 50 + 1)::uuid,
          md5('person' || p)::uuid, 'person', 'Check in', current_date,
          'month', md5('member' || 2 * ((p - 1) / 50) + 1)::uuid
        from generate_series(1, 2000) p
      `;
      await scratch`
        insert into crm.reminder_occurrences (reminder_id, member_id,
          occurs_on, deliver_at, channel, status, sent_at,
          provider_result_state, provider_receipt, provider_effect_at,
          visible_at, workspace_id)
        select md5('reminder' || p)::uuid,
          md5('member' || 2 * ((p - 1) / 50) + 1 + k)::uuid,
          current_date - months.n * 30,
          now() - months.n * interval '30 days', 'in_app', 'sent',
          now() - months.n * interval '30 days', 'confirmed', 'in-app',
          now() - months.n * interval '30 days',
          now() - months.n * interval '30 days',
          (select scope.workspace_id from crm.reminders scope
            where scope.id = md5('reminder' || p)::uuid)
        from generate_series(1, 2000) p
        cross join (values (0), (1)) member(k)
        cross join generate_series(1, 24) months(n)
      `;
      await scratch`analyze`;

      const memberLeading = new Set(
        (await scratch<{ readonly name: string }[]>`
          select index_class.relname as name
          from pg_catalog.pg_index i
          join pg_catalog.pg_class index_class on index_class.oid = i.indexrelid
          join pg_catalog.pg_attribute a
            on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
          where i.indrelid = 'crm.reminder_occurrences'::regclass
            and a.attname = 'member_id' and i.indpred is null
        `).map((row) => row.name),
      );
      // The exact statement the member foreign key's cascade runs, planned
      // both the way a first execution and a cached execution plan it.
      await scratch.unsafe(
        `prepare member_cascade(uuid) as
          delete from only crm.reminder_occurrences
          where $1 operator(pg_catalog.=) member_id`,
      );
      for (const mode of ["force_custom_plan", "force_generic_plan"]) {
        await scratch.unsafe(`set plan_cache_mode = ${mode}`);
        const [row] = await scratch.unsafe(
          `explain (format json) execute member_cascade(md5('member1')::uuid)`,
        );
        const plan = (row?.["QUERY PLAN"] as
          | readonly { readonly Plan: PlanNode }[]
          | undefined)?.[0]?.Plan;
        assert(plan !== undefined, "the cascade statement was not explained");
        const nodes = planNodes(plan);
        const indexes = nodes.flatMap((node) =>
          node["Index Name"] ? [node["Index Name"]] : []
        );
        assert(
          nodes.every((node) => node["Node Type"] !== "Seq Scan") &&
            indexes.length > 0 &&
            indexes.every((name) => memberLeading.has(name)),
          `${mode}: deleting one member reads every tenant's occurrences: ${
            describePlan(plan)
          }`,
        );
      }
    });
  },
});

Deno.test({
  name: "WORKSPACE-002 PostgreSQL erasure resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql, [...GLOBAL_TABLES]);
    await Promise.all([sql.end(), configured.close()]);
  },
});
