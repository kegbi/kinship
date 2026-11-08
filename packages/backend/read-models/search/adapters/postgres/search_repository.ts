/**
 * Workspace search in PostgreSQL (GAP-048).
 *
 * The text groups match `to_tsvector('simple', …) @@
 * websearch_to_tsquery('simple', $query)`, and schema v9 indexes each group's
 * `to_tsvector` expression with GIN (REL-061): `notes_search_idx`,
 * `activities_search_idx`, `journal_posts_search_idx`, and `tasks_search_idx`.
 * The planner uses an index only for the identical expression, so each match
 * below is spelled exactly as its index is — `||` with `coalesce` rather than
 * `concat_ws`, which is not immutable and cannot be indexed; both give the
 * same words. The parsed query is read as a scalar subquery, not joined: a
 * join leaves `@@` a join filter evaluated on every row of the workspace,
 * while a subquery is an init-plan value the index condition can use. The
 * planner still chooses by cost, so a workspace with few rows may read them
 * through its workspace index instead.
 *
 * An empty query reads the member's recent people instead (FEQ-05): the ids
 * their interface state lists, each probed by key in the workspace, with the
 * same avatar join as a search.
 *
 * The text groups are still their own statement, after people: people search
 * is the directory's own case-insensitive substring match on the
 * workspace-indexed people rows, widened to the query's spellings across
 * scripts and keyboard layouts (`platform/postgres/name_match.ts`), and a
 * slow text statement can never hold it up. Each statement runs in a
 * read-only transaction under `SEARCH_STATEMENT_TIMEOUT_MS`, opened in one
 * round trip; a cancelled one answers `timed-out`.
 *
 * Visibility is each owning module's own listing rule:
 *
 * - people as the active directory lists them: not deleted, not archived;
 * - notes on a person who is not deleted, as the person workspace and Today
 *   list them, and only while the workspace shows the notes section;
 * - activities attended by at least one person who is not deleted, opened on
 *   the first of them, and only while the activities section is shown;
 * - journal posts at their journal item, as the journal timeline lists them;
 * - tasks that are not deleted, as the tasks page lists them, naming their
 *   person only while that person exists.
 *
 * One statement answers the four text groups, so they read one snapshot over
 * one connection. A query with no positive term (`-fox`, `a or -b`) matches no
 * text: `querytree` reports such a query as `T`, which would match nearly
 * every row. Each text is cut in SQL to a window around its first match, so a
 * match deep in a long note still reaches the snippet.
 */

import { type Kysely, type RawBuilder, sql } from "kysely";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import { storedRecentPersonIds } from "../../../../modules/workspaces/public.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { postgresErrorCode } from "../../../../platform/postgres/errors.ts";
import { nameMatchSql } from "../../../../platform/postgres/name_match.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { readOnlyWithin } from "../../../../platform/postgres/transactions.ts";
import type {
  SearchJournalPostRecord,
  SearchPersonEntityRecord,
  SearchPersonRecord,
  SearchPersonReference,
  SearchRecentPersonRecord,
  SearchRepository,
  SearchTaskRecord,
} from "../../ports/search_repository.ts";

/** The longest either search statement may run before PostgreSQL cancels it. */
export const SEARCH_STATEMENT_TIMEOUT_MS = 1500;

/** `query_canceled`: the statement ran past its timeout. */
const QUERY_CANCELED = "57014";

/** How much stored text a snippet may be cut from. */
const SNIPPET_SOURCE_LIMIT = 2000;
/** How much of that window sits before the first match. */
const SNIPPET_SOURCE_LEAD = 500;

interface PersonRow {
  readonly archived?: boolean;
  readonly avatar_background_color: string | null;
  readonly avatar_file_id: string | null;
  readonly family_name: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly middle_name: string | null;
  readonly nickname: string | null;
}

interface EntityRow {
  readonly id: string;
  readonly journal_item_id?: string | null;
  readonly person_archived?: boolean | null;
  readonly person_id?: string | null;
  readonly person_name?: string | null;
  readonly section_shown?: boolean | null;
  readonly text: string;
  readonly title: string | null;
}

interface TextRow {
  readonly activities: readonly EntityRow[];
  readonly journal_posts: readonly EntityRow[];
  readonly notes: readonly EntityRow[];
  readonly tasks: readonly EntityRow[];
}

/**
 * `text` cut to a window of the stored characters around the first of
 * `terms` it contains, marked with an ellipsis where it was cut. PostgreSQL
 * counts characters, not bytes or UTF-16 units, so nothing is split.
 */
function clipped(
  text: RawBuilder<unknown>,
  terms: readonly string[],
): RawBuilder<string> {
  return sql<string>`(
    select case when char_length(source.value) <= ${SNIPPET_SOURCE_LIMIT}
      then source.value
      else case when window_start.value > 1 then '…' else '' end ||
        substr(source.value, window_start.value, ${SNIPPET_SOURCE_LIMIT}) ||
        case when window_start.value + ${SNIPPET_SOURCE_LIMIT}
            <= char_length(source.value)
          then '…' else '' end
      end
    from (select ${text} as value) source
    cross join lateral (
      select greatest(1, coalesce((
        select min(nullif(strpos(lower(source.value), term), 0))
        from unnest(${terms}::text[]) term
      ), 1) - ${SNIPPET_SOURCE_LEAD}) as value
    ) window_start
  )`;
}

/**
 * A person's stored avatar colour, and its image file only while that file
 * can be drawn, as the directory offers it.
 */
const avatarColumns = sql`avatar.background_color as avatar_background_color,
  case when avatar.source = 'file' then avatar_file.id::text end
    as avatar_file_id`;
const avatarJoins = sql`left join crm.person_avatars avatar
    on avatar.person_id = person.id
  left join crm.files avatar_file on avatar_file.id = avatar.file_id
    and avatar_file.workspace_id = person.workspace_id
    and avatar_file.status = 'available'
    and avatar_file.deleted_at is null`;

/** A person row as the people group answers it. */
function personRecord(found: PersonRow): SearchPersonRecord {
  return {
    avatar: pickDefined({
      backgroundColor: found.avatar_background_color,
      fileId: found.avatar_file_id,
    }),
    ...pickDefined({ familyName: found.family_name }),
    givenName: found.given_name,
    id: found.id,
    ...pickDefined({
      middleName: found.middle_name,
      nickname: found.nickname,
    }),
  };
}

const displayName = (alias: string) =>
  sql.raw(personDisplayNameSql(UNNAMED_PERSON, alias));

/** The person a row names; the query names one with its id and name both. */
function person(row: EntityRow): SearchPersonReference {
  return {
    archived: row.person_archived === true,
    id: row.person_id!,
    name: row.person_name!,
  };
}

function base(row: EntityRow) {
  return { id: row.id, text: row.text, ...pickDefined({ title: row.title }) };
}

export class PostgresSearchRepository implements SearchRepository {
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    options: { readonly statementTimeoutMs?: number } = {},
  ) {
    this.statementTimeoutMs = options.statementTimeoutMs ??
      SEARCH_STATEMENT_TIMEOUT_MS;
  }

  /**
   * Runs `work` in a read-only transaction whose statements PostgreSQL
   * cancels past the timeout, opened in one round trip (`readOnlyWithin`).
   */
  private async bounded<T>(
    work: (transaction: Kysely<ApplicationDatabase>) => Promise<T>,
  ): Promise<T | { readonly status: "timed-out" }> {
    try {
      return await readOnlyWithin(this.database, this.statementTimeoutMs, work);
    } catch (error) {
      if (postgresErrorCode(error) === QUERY_CANCELED) {
        return { status: "timed-out" };
      }
      throw error;
    }
  }

  /**
   * The member's recent people (FEQ-05), read as Today's recent people reads
   * them: the ids the member's interface state lists, then each person by
   * key in this workspace, not deleted, archived ones included, in the order
   * the member viewed them, with the avatar and name parts a search answers.
   */
  recentPeople(
    command: Parameters<SearchRepository["recentPeople"]>[0],
  ): ReturnType<SearchRepository["recentPeople"]> {
    return this.bounded(async (transaction) => {
      const stored = await sql<{ readonly ui_state: unknown }>`
        select preference.ui_state
        from crm.member_preferences preference
        where preference.member_id = ${command.memberId}::uuid
      `.execute(transaction);
      const ids = storedRecentPersonIds(stored.rows[0]?.ui_state);
      if (ids.length === 0) return { people: [], status: "ready" as const };
      // The ids are typed, not the column, so each is one probe of the
      // people key (BEQ-13).
      const result = await sql<PersonRow>`
        select person.id::text as id, person.given_name, person.middle_name,
          person.family_name, person.nickname,
          person.archived_at is not null as archived,
          ${avatarColumns}
        from unnest(array[${
        sql.join(ids.map((id) => sql`${id}`))
      }]::uuid[]) with ordinality as recent(person_id, position)
        join crm.people person on person.id = recent.person_id
          and person.workspace_id = ${command.workspaceId}::uuid
        ${avatarJoins}
        where person.deleted_at is null
        order by recent.position
        limit ${command.limit}
      `.execute(transaction);
      return {
        people: result.rows.map((found): SearchRecentPersonRecord => ({
          archived: found.archived === true,
          ...personRecord(found),
        })),
        status: "ready" as const,
      };
    });
  }

  searchPeople(
    command: Parameters<SearchRepository["searchPeople"]>[0],
  ): ReturnType<SearchRepository["searchPeople"]> {
    const primary = command.sort === "family-name"
      ? sql`lower(coalesce(nullif(btrim(person.family_name), ''),
          nullif(btrim(person.nickname), ''),
          nullif(btrim(person.given_name), ''), ''))`
      : sql`lower(coalesce(nullif(btrim(person.given_name), ''),
          nullif(btrim(person.nickname), ''),
          nullif(btrim(person.family_name), ''), ''))`;
    const secondary = command.sort === "family-name"
      ? sql`lower(coalesce(person.given_name, ''))`
      : sql`lower(coalesce(person.family_name, ''))`;
    return this.bounded(async (transaction) => {
      const result = await sql<PersonRow>`
        select person.id::text as id, person.given_name, person.middle_name,
          person.family_name, person.nickname, ${avatarColumns}
        from crm.people person
        ${avatarJoins}
        where person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null
          and person.archived_at is null
          and ${
        nameMatchSql(
          sql`concat_ws(' ', person.given_name, person.middle_name,
            person.family_name, person.nickname)`,
          command.query,
          command.nameForms,
          command.nameFold,
        )
      }
        order by ${primary}, ${secondary}, person.id
        limit ${command.limit}
      `.execute(transaction);
      return {
        people: result.rows.map(personRecord),
        status: "ready" as const,
      };
    });
  }

  searchText(
    command: Parameters<SearchRepository["searchText"]>[0],
  ): ReturnType<SearchRepository["searchText"]> {
    const workspace = sql`${command.workspaceId}::uuid`;
    const limit = command.limit;
    const terms = command.terms;
    return this.bounded(async (transaction) => {
      const result = await sql<TextRow>`
      with parsed as (
        -- A query the parser finds no word in ("!!!", "<b>") would make
        -- websearch_to_tsquery raise a notice; it matches no text instead.
        select case when to_tsvector('simple', ${command.query}::text)
            <> ''::tsvector
          then websearch_to_tsquery('simple', ${command.query}::text)
        end as terms
      ),
      criteria as (
        select case when querytree(parsed.terms) <> 'T' then parsed.terms end
          as terms
        from parsed
      )
      select
        -- Each group first takes its own top rows by its listing order from
        -- the matching rows alone; only those are cut to a snippet, named,
        -- and, for an activity, given its first attendee, so a common word's
        -- thousands of matches are never looked up one by one.
        (select coalesce(jsonb_agg(found order by found.rank), '[]'::jsonb)
          from (
            select top.id::text as id, null::text as title,
              ${clipped(sql`top.body`, terms)} as text,
              person.id::text as person_id,
              ${displayName("person")} as person_name,
              person.archived_at is not null as person_archived,
              row_number() over (order by top.created_at desc, top.id desc)
                as rank
            from (
              select note.id, note.body, note.person_id, note.created_at
              from crm.notes note
              left join crm.workspace_profile_modules profile_module
                on profile_module.workspace_id = note.workspace_id
                and profile_module.key = 'notes'
              where note.workspace_id = ${workspace}
                and coalesce(profile_module.is_active, true)
                and to_tsvector('simple', note.body)
                  @@ (select terms from criteria)
                and exists (select 1 from crm.people person
                  where person.id = note.person_id
                    and person.workspace_id = note.workspace_id
                    and person.deleted_at is null)
              order by note.created_at desc, note.id desc
              limit ${limit}
            ) top
            join crm.people person on person.id = top.person_id
              and person.workspace_id = ${workspace}
          ) found) as notes,
        (select coalesce(jsonb_agg(found order by found.rank), '[]'::jsonb)
          from (
            select top.id::text as id, top.summary as title,
              ${
        clipped(
          sql`coalesce(nullif(btrim(top.description), ''), top.summary)`,
          terms,
        )
      } as text,
              attendee.id::text as person_id, attendee.name as person_name,
              attendee.archived as person_archived,
              row_number() over (
                order by top.happened_at desc, top.id desc
              ) as rank
            from (
              select activity.id, activity.summary, activity.description,
                activity.happened_at
              from crm.activities activity
              left join crm.workspace_profile_modules profile_module
                on profile_module.workspace_id = activity.workspace_id
                and profile_module.key = 'activities'
              where activity.workspace_id = ${workspace}
                and coalesce(profile_module.is_active, true)
                and to_tsvector('simple', activity.summary || ' ' ||
                  coalesce(activity.description, ''))
                  @@ (select terms from criteria)
                and exists (select 1 from crm.activity_participants link
                  join crm.people person on person.id = link.person_id
                    and person.workspace_id = activity.workspace_id
                    and person.deleted_at is null
                  where link.activity_id = activity.id)
              order by activity.happened_at desc, activity.id desc
              limit ${limit}
            ) top
            join lateral (
              select person.id, ${displayName("person")} as name,
                person.archived_at is not null as archived
              from crm.activity_participants link
              join crm.people person on person.id = link.person_id
                and person.workspace_id = ${workspace}
                and person.deleted_at is null
              where link.activity_id = top.id
              order by person.archived_at is not null,
                lower(${displayName("person")}), person.id
              limit 1
            ) attendee on true
          ) found) as activities,
        (select coalesce(jsonb_agg(found order by found.rank), '[]'::jsonb)
          from (
            select top.id::text as id, top.title,
              ${clipped(sql`top.body`, terms)} as text,
              top.journal_item_id::text as journal_item_id,
              row_number() over (
                order by top.occurred_at desc, top.created_at desc,
                  top.journal_item_id desc
              ) as rank
            from (
              select post.id, post.title, post.body,
                item.id as journal_item_id, item.occurred_at, item.created_at
              from crm.journal_posts post
              join crm.journal_items item on item.journal_post_id = post.id
                and item.workspace_id = post.workspace_id
              where post.workspace_id = ${workspace}
                and to_tsvector('simple', coalesce(post.title, '') || ' ' ||
                  post.body) @@ (select terms from criteria)
              order by item.occurred_at desc, item.created_at desc,
                item.id desc
              limit ${limit}
            ) top
          ) found) as journal_posts,
        (select coalesce(jsonb_agg(found order by found.rank), '[]'::jsonb)
          from (
            select top.id::text as id, top.title,
              ${
        clipped(
          sql`coalesce(nullif(btrim(top.description), ''), top.title)`,
          terms,
        )
      } as text,
              person.id::text as person_id,
              case when person.id is not null
                then ${displayName("person")} end as person_name,
              person.archived_at is not null as person_archived,
              top.section_shown,
              row_number() over (order by top.status_order,
                top.updated_at desc, top.id desc) as rank
            from (
              select task.id, task.title, task.description, task.person_id,
                case task.status when 'open' then 0 when 'completed' then 1
                  else 2 end as status_order,
                task.updated_at,
                coalesce(profile_module.is_active, true) as section_shown
              from crm.tasks task
              left join crm.workspace_profile_modules profile_module
                on profile_module.workspace_id = task.workspace_id
                and profile_module.key = 'tasks'
              where task.workspace_id = ${workspace}
                and task.deleted_at is null
                and to_tsvector('simple', task.title || ' ' ||
                  coalesce(task.description, ''))
                  @@ (select terms from criteria)
              order by status_order, task.updated_at desc, task.id desc
              limit ${limit}
            ) top
            left join crm.people person on person.id = top.person_id
              and person.workspace_id = ${workspace}
              and person.deleted_at is null
          ) found) as tasks
      from criteria
    `.execute(transaction);
      const row = result.rows[0]!;
      return {
        activities: row.activities.map(owned),
        journalPosts: row.journal_posts.map((
          post,
        ): SearchJournalPostRecord => ({
          ...base(post),
          journalItemId: post.journal_item_id!,
        })),
        notes: row.notes.map(owned),
        status: "ready" as const,
        tasks: row.tasks.map((task): SearchTaskRecord => ({
          ...base(task),
          ...(task.person_id ? { person: person(task) } : {}),
          sectionShown: task.section_shown !== false,
        })),
      };
    });
  }
}

/** A note or activity row, which the query only answers with its person. */
function owned(row: EntityRow): SearchPersonEntityRecord {
  return { ...base(row), person: person(row) };
}
