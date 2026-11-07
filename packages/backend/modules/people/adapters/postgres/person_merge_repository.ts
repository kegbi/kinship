import { sql } from "kysely";
import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../domain/person_name.ts";
import type {
  MergeCandidate,
  PersonMergeRepository,
  ReferenceOutcome,
} from "../../public.ts";
import {
  IMPORTANT_DATE_COLUMNS,
  importantDateRecord,
  type ImportantDateRow,
} from "./important_date_repository.ts";

interface CandidateRow {
  readonly archived_at: Date | null;
  readonly deleted_at: Date | null;
  readonly description: string | null;
  readonly family_name: string | null;
  readonly food_preferences: string | null;
  readonly gender_option_id: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly is_deceased: boolean;
  readonly is_partial: boolean;
  readonly is_starred: boolean;
  readonly middle_name: string | null;
  readonly nickname: string | null;
  readonly updated_at: string;
}

const CANDIDATE_COLUMNS = sql`id::text, given_name, middle_name, family_name,
  nickname, description, gender_option_id::text, food_preferences,
  is_starred, is_deceased, is_partial, archived_at, deleted_at,
  ${instantColumn("updated_at")} as updated_at`;

function candidate(row: CandidateRow): MergeCandidate {
  return {
    ...pickDefined({
      description: row.description,
      familyName: row.family_name,
      foodPreferences: row.food_preferences,
      genderOptionId: row.gender_option_id,
    }),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    isStarred: row.is_starred,
    lifecycle: row.deleted_at
      ? "deleted"
      : row.archived_at
      ? "archived"
      : "active",
    ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
    updatedAt: row.updated_at,
  };
}

const AVATAR: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_avatars",
};
const DATES: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_dates",
  touches: true,
};
const MEETING: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_first_meetings",
  touches: true,
};
const INTRODUCER: PersonReferenceSite = {
  column: "introduced_by_person_id",
  table: "crm.person_first_meetings",
  touches: true,
};
const CONTACTS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_contact_methods",
  touches: true,
};
const ADDRESSES: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_addresses",
  touches: true,
};
const OCCUPATIONS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_occupations",
  touches: true,
};
const TAGS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_tags",
};
const PETS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.pets",
  touches: true,
};

const SITES = [
  AVATAR,
  DATES,
  MEETING,
  INTRODUCER,
  CONTACTS,
  ADDRESSES,
  OCCUPATIONS,
  TAGS,
  PETS,
];

/**
 * A dismissed pair names the duplicate on either side, and its two people stay
 * in canonical order, so pointing one column at the primary is not a relink of
 * its own: `relinkDismissals` rewrites both columns at once.
 */
const DISMISSED_LOW: PersonReferenceSite = {
  column: "person_low_id",
  table: "crm.person_duplicate_dismissals",
  workspaceScoped: true,
};
const DISMISSED_HIGH: PersonReferenceSite = {
  column: "person_high_id",
  table: "crm.person_duplicate_dismissals",
  workspaceScoped: true,
};
const DISMISSALS = [DISMISSED_LOW, DISMISSED_HIGH];

type Command = Parameters<
  PersonMergeRepository["ownTables"]["relinkPerson"]
>[0];

function database(command: { readonly transaction: { opaque: unknown } }) {
  return databaseFromSession(command.transaction);
}

/**
 * The people module's own half of a merge (GAP-049): the pair locked, the
 * primary's identity filled in, people's own tables relinked under the rules
 * `application/merge_people.ts` lists, and the duplicate deleted.
 *
 * Each rule that is more than "point it at the primary" is its own statement
 * below, run before the plain relink so the relink never meets a row it would
 * collide with.
 */
export class PostgresPersonMergeRepository implements PersonMergeRepository {
  async lockPair(
    command: Parameters<PersonMergeRepository["lockPair"]>[0],
  ): ReturnType<PersonMergeRepository["lockPair"]> {
    const result = await sql<CandidateRow>`
      select ${CANDIDATE_COLUMNS}
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${command.primaryId}::uuid, ${command.duplicateId}::uuid)
      order by id
      ${command.forUpdate ? sql`for update` : sql``}
    `.execute(database(command));
    const rows = new Map(result.rows.map((row) => [row.id, candidate(row)]));
    const primary = rows.get(command.primaryId);
    const duplicate = rows.get(command.duplicateId);
    return {
      ...(duplicate ? { duplicate } : {}),
      ...(primary ? { primary } : {}),
    };
  }

  async listFacts(
    command: Parameters<PersonMergeRepository["listFacts"]>[0],
  ): ReturnType<PersonMergeRepository["listFacts"]> {
    const db = database(command);
    // Every read below proves the person is in the actor's workspace, and the
    // introducer and place are joined only from that workspace (SECT-09).
    const owned = sql`exists (
      select 1 from crm.people owner
      where owner.id = ${command.personId}::uuid
        and owner.workspace_id = ${command.workspaceId}::uuid
    )`;
    const dates = await sql<ImportantDateRow>`
      select ${IMPORTANT_DATE_COLUMNS}
      from crm.person_dates
      where person_id = ${command.personId}::uuid and ${owned}
      order by created_at, id
    `.execute(db);
    // The first meeting as the confirmation names it: where, through whom,
    // and the saved place, by the ids the audit history keeps.
    const meeting = await sql<{
      readonly introducer_id: string | null;
      readonly introducer_name: string | null;
      readonly location_id: string | null;
      readonly location_text: string | null;
      readonly notes: string | null;
      readonly place_text: string | null;
    }>`
      select meeting.place_text, meeting.notes,
        introducer.id::text as introducer_id,
        case when introducer.id is not null then ${
      sql.raw(personDisplayNameSql(UNNAMED_PERSON, "introducer"))
    } end as introducer_name,
        place.id::text as location_id,
        coalesce(
          nullif(trim(place.label), ''),
          nullif(concat_ws(', ', nullif(trim(place.street), ''),
            nullif(trim(place.city), ''), nullif(trim(place.region), ''),
            nullif(trim(place.country), '')), ''),
          'a saved place'
        ) as location_text
      from crm.person_first_meetings meeting
      left join crm.people introducer
        on introducer.id = meeting.introduced_by_person_id
        and introducer.workspace_id = ${command.workspaceId}::uuid
      left join crm.locations place
        on place.id = meeting.location_id
        and place.workspace_id = ${command.workspaceId}::uuid
      where meeting.person_id = ${command.personId}::uuid and ${owned}
    `.execute(db);
    const avatar = await sql<{
      readonly external_url: string | null;
      readonly file_id: string | null;
      readonly source: string;
    }>`
      select source, file_id::text, external_url from crm.person_avatars
      where person_id = ${command.personId}::uuid and ${owned}
    `.execute(db);
    const meetingRow = meeting.rows[0];
    const avatarRow = avatar.rows[0];
    return {
      ...(avatarRow
        ? {
          avatar: {
            ...pickDefined({
              externalUrl: avatarRow.external_url,
              fileId: avatarRow.file_id,
            }),
            source: avatarRow.source,
          },
        }
        : {}),
      dates: dates.rows.map(importantDateRecord),
      ...(meetingRow
        ? {
          firstMeeting: {
            ...(meetingRow.introducer_id
              ? {
                introducedBy: {
                  id: meetingRow.introducer_id,
                  name: meetingRow.introducer_name ?? UNNAMED_PERSON,
                },
              }
              : {}),
            ...(meetingRow.location_id
              ? {
                location: {
                  id: meetingRow.location_id,
                  text: meetingRow.location_text ?? "a saved place",
                },
              }
              : {}),
            ...pickDefined({
              notes: meetingRow.notes,
              placeText: meetingRow.place_text,
            }),
          },
        }
        : {}),
    };
  }

  readonly ownTables: PersonMergeRepository["ownTables"] = {
    countReferences: (command) =>
      countPersonReferences([...SITES, ...DISMISSALS], command),
    module: "people",
    references: [...SITES, ...DISMISSALS].map(referenceName),
    relinkPerson: (command) => relinkOwnTables(command),
  };

  async applyIdentity(
    command: Parameters<PersonMergeRepository["applyIdentity"]>[0],
  ): ReturnType<PersonMergeRepository["applyIdentity"]> {
    const identity = command.identity;
    const result = await sql<CandidateRow>`
      update crm.people set
        given_name = ${identity.givenName},
        middle_name = ${identity.middleName ?? null},
        family_name = ${identity.familyName ?? null},
        nickname = ${identity.nickname ?? null},
        description = ${identity.description ?? null},
        gender_option_id = ${identity.genderOptionId ?? null}::uuid,
        food_preferences = ${identity.foodPreferences ?? null},
        is_starred = ${identity.isStarred},
        is_deceased = ${identity.isDeceased},
        is_partial = ${identity.isPartial},
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )
      where id = ${command.primaryId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null and archived_at is null
      returning ${CANDIDATE_COLUMNS}
    `.execute(database(command));
    const row = result.rows[0];
    if (!row) throw new Error("Person merge could not update the primary.");
    return candidate(row);
  }

  async removeDuplicate(
    command: Parameters<PersonMergeRepository["removeDuplicate"]>[0],
  ): Promise<boolean> {
    const result = await sql`
      update crm.people set
        deleted_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        ),
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )
      where id = ${command.duplicateId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null
      returning 1
    `.execute(database(command));
    return result.rows.length === 1;
  }
}

async function relinkOwnTables(command: Command): Promise<ReferenceOutcome> {
  const db = database(command);
  const { duplicateId: duplicate, primaryId: primary } = command;
  const removed: Record<string, number> = {};
  const drop = async (
    site: PersonReferenceSite,
    query: ReturnType<typeof sql>,
  ) => {
    const result = await query.execute(db);
    removed[referenceName(site)] = (removed[referenceName(site)] ?? 0) +
      result.rows.length;
  };

  // The avatar: the primary's stays unless it is the default and the
  // duplicate's is not, in which case the duplicate's becomes the primary's.
  await sql`
    delete from crm.person_avatars kept
    where kept.person_id = ${primary}::uuid and kept.source = 'default'
      and exists (
        select 1 from crm.person_avatars taken
        where taken.person_id = ${duplicate}::uuid
          and taken.source <> 'default'
      )
  `.execute(db);
  await drop(
    AVATAR,
    sql`
      delete from crm.person_avatars
      where person_id = ${duplicate}::uuid
        and exists (
          select 1 from crm.person_avatars where person_id = ${primary}::uuid
        )
      returning 1
    `,
  );

  // Dates: the single-valued ones the primary already has were retired.
  await drop(
    DATES,
    sql`
      delete from crm.person_dates
      where person_id = ${duplicate}::uuid
        and id = any(${[...command.removedDateIds]}::uuid[])
      returning 1
    `,
  );

  // First meeting: one per person, and never introduced by themselves.
  await drop(
    MEETING,
    sql`
      delete from crm.person_first_meetings
      where person_id = ${duplicate}::uuid
        and exists (
          select 1 from crm.person_first_meetings
          where person_id = ${primary}::uuid
        )
      returning 1
    `,
  );
  await sql`
    update crm.person_first_meetings set introduced_by_person_id = null
    where person_id = ${duplicate}::uuid
      and introduced_by_person_id = ${primary}::uuid
  `.execute(db);
  await drop(
    INTRODUCER,
    sql`
      update crm.person_first_meetings set introduced_by_person_id = null,
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )
      where person_id = ${primary}::uuid
        and introduced_by_person_id = ${duplicate}::uuid
      returning 1
    `,
  );

  // Contact methods: an exact copy of one the primary has is dropped, and a
  // primary flag the primary already holds for that type is given up.
  await drop(
    CONTACTS,
    sql`
      delete from crm.person_contact_methods copy
      where copy.person_id = ${duplicate}::uuid
        and exists (
          select 1 from crm.person_contact_methods kept
          where kept.person_id = ${primary}::uuid
            and kept.type_id = copy.type_id
            and lower(btrim(kept.value)) = lower(btrim(copy.value))
        )
      returning 1
    `,
  );
  await sql`
    update crm.person_contact_methods moved set is_primary = false
    where moved.person_id = ${duplicate}::uuid and moved.is_primary
      and exists (
        select 1 from crm.person_contact_methods kept
        where kept.person_id = ${primary}::uuid
          and kept.type_id = moved.type_id and kept.is_primary
      )
  `.execute(db);

  // Addresses: an exact copy (same name and place) is dropped, and only one
  // address can stay primary.
  await drop(
    ADDRESSES,
    sql`
      delete from crm.person_addresses copy
      where copy.person_id = ${duplicate}::uuid
        and exists (
          select 1
          from crm.person_addresses kept
          left join crm.locations kept_place
            on kept_place.id = kept.location_id
            and kept_place.workspace_id = ${command.workspaceId}::uuid
          left join crm.locations copy_place
            on copy_place.id = copy.location_id
            and copy_place.workspace_id = ${command.workspaceId}::uuid
          where kept.person_id = ${primary}::uuid
            and kept.display_name is not distinct from copy.display_name
            and kept_place.street is not distinct from copy_place.street
            and kept_place.city is not distinct from copy_place.city
            and kept_place.region is not distinct from copy_place.region
            and kept_place.postal_code
              is not distinct from copy_place.postal_code
            and kept_place.country is not distinct from copy_place.country
        )
      returning 1
    `,
  );
  await sql`
    update crm.person_addresses moved set is_primary = false
    where moved.person_id = ${duplicate}::uuid and moved.is_primary
      and exists (
        select 1 from crm.person_addresses kept
        where kept.person_id = ${primary}::uuid and kept.is_primary
      )
  `.execute(db);

  // Tags: a tag the primary has is not linked twice.
  await drop(
    TAGS,
    sql`
      delete from crm.person_tags copy
      where copy.person_id = ${duplicate}::uuid
        and exists (
          select 1 from crm.person_tags kept
          where kept.person_id = ${primary}::uuid
            and kept.tag_id = copy.tag_id
        )
      returning 1
    `,
  );

  const dismissals = await relinkDismissals(command);
  const relinked = await relinkPersonReferences(SITES, command);
  return {
    relinked: { ...relinked, ...dismissals.relinked },
    removed: { ...removed, ...dismissals.removed },
  };
}

/**
 * The duplicate's not-duplicate decisions become the primary's: the merged
 * pair itself and a pair the primary already has are dropped, and every other
 * pair is rewritten in canonical order. Each row is counted under the column
 * that named the duplicate.
 */
async function relinkDismissals(command: Command): Promise<ReferenceOutcome> {
  const db = database(command);
  const { duplicateId: duplicate, primaryId: primary } = command;
  const tally = (rows: readonly { readonly from_low: boolean }[]) => ({
    [referenceName(DISMISSED_LOW)]: rows.filter((row) => row.from_low).length,
    [referenceName(DISMISSED_HIGH)]: rows.filter((row) => !row.from_low)
      .length,
  });
  const removed = await sql<{ readonly from_low: boolean }>`
    delete from crm.person_duplicate_dismissals dismissal
    where dismissal.workspace_id = ${command.workspaceId}::uuid
      and ${duplicate}::uuid in (dismissal.person_low_id,
        dismissal.person_high_id)
      and (
        ${primary}::uuid in (dismissal.person_low_id, dismissal.person_high_id)
        or exists (
          select 1 from crm.person_duplicate_dismissals kept
          where kept.workspace_id = dismissal.workspace_id
            and ${primary}::uuid in (kept.person_low_id, kept.person_high_id)
            and (case when dismissal.person_low_id = ${duplicate}::uuid
              then dismissal.person_high_id else dismissal.person_low_id end)
              in (kept.person_low_id, kept.person_high_id)
        )
      )
    returning dismissal.person_low_id = ${duplicate}::uuid as from_low
  `.execute(db);
  const relinked = await sql<{ readonly from_low: boolean }>`
    with moved as (
      select person_low_id, person_high_id,
        person_low_id = ${duplicate}::uuid as from_low,
        case when person_low_id = ${duplicate}::uuid
          then person_high_id else person_low_id end as other_id
      from crm.person_duplicate_dismissals
      where workspace_id = ${command.workspaceId}::uuid
        and ${duplicate}::uuid in (person_low_id, person_high_id)
    )
    update crm.person_duplicate_dismissals dismissal
    set person_low_id = least(${primary}::uuid, moved.other_id),
      person_high_id = greatest(${primary}::uuid, moved.other_id)
    from moved
    where dismissal.workspace_id = ${command.workspaceId}::uuid
      and dismissal.person_low_id = moved.person_low_id
      and dismissal.person_high_id = moved.person_high_id
    returning moved.from_low
  `.execute(db);
  return { relinked: tally(relinked.rows), removed: tally(removed.rows) };
}
