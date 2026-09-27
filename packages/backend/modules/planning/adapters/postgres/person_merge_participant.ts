import { sql } from "kysely";
import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PersonMergeInspection,
  PersonMergePairScope,
  PersonMergeParticipant,
} from "../../../people/public.ts";
import { cadenceIntervalText, type CadenceUnit } from "../../domain/cadence.ts";
import { mergeStayInTouchCadences } from "./reminder_repository.ts";

const WORK: readonly PersonReferenceSite[] = [
  {
    column: "person_id",
    table: "crm.tasks",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "person_id",
    table: "crm.reminders",
    touches: true,
    workspaceScoped: true,
  },
];
const CADENCE: PersonReferenceSite = {
  column: "person_id",
  table: "crm.stay_in_touch_cadences",
  touches: true,
};

/**
 * Planning's side of a person merge (GAP-049).
 *
 * The duplicate's tasks and reminders become the primary's. An occurrence
 * belongs to its reminder, not to a person, so relinking a reminder can never
 * produce a second occurrence under the unique delivery key; the reminders a
 * moved or dropped important date drives are regenerated or retired by the
 * people merge through the important-date publisher, as editing the date
 * would. A person has one stay-in-touch cadence: the primary keeps its own
 * interval, taking the later last contact and the due date that follows from
 * it, and otherwise inherits the duplicate's. `inspect` names a discarded
 * interval before the merge, so the member sees it and the audit keeps it.
 */
export class PostgresPlanningPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "planning";
  readonly references = [...WORK, CADENCE].map(referenceName);

  countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    return countPersonReferences([...WORK, CADENCE], command);
  }

  async inspect(
    scope: PersonMergePairScope,
  ): Promise<PersonMergeInspection> {
    const result = await sql<{
      readonly kept_count: number;
      readonly kept_unit: CadenceUnit;
      readonly count: number;
      readonly unit: CadenceUnit;
    }>`
      select kept.interval_count as kept_count, kept.interval_unit as kept_unit,
        duplicate.interval_count as count, duplicate.interval_unit as unit
      from crm.stay_in_touch_cadences kept
      join crm.stay_in_touch_cadences duplicate
        on duplicate.person_id = ${scope.duplicateId}::uuid
      where kept.person_id = ${scope.primaryId}::uuid
    `.execute(databaseFromSession(scope.transaction));
    const row = result.rows[0];
    // The same interval on both loses nothing; the later last contact is
    // kept either way, so only the interval can be discarded.
    if (!row || (row.count === row.kept_count && row.unit === row.kept_unit)) {
      return {};
    }
    return {
      conflicts: [{
        discarded: cadenceIntervalText(row.count, row.unit),
        fact: "stay-in-touch",
        kept: cadenceIntervalText(row.kept_count, row.kept_unit),
        keptSnapshot: {
          intervalCount: row.kept_count,
          intervalUnit: row.kept_unit,
        },
        snapshot: { intervalCount: row.count, intervalUnit: row.unit },
      }],
    };
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    const database = databaseFromSession(command.transaction);
    await mergeStayInTouchCadences(command);
    const dropped = await sql`
      delete from crm.stay_in_touch_cadences
      where person_id = ${command.duplicateId}::uuid
        and exists (
          select 1 from crm.stay_in_touch_cadences
          where person_id = ${command.primaryId}::uuid
        )
      returning 1
    `.execute(database);
    return {
      relinked: {
        ...(await relinkPersonReferences(WORK, command)),
        ...(await relinkPersonReferences([CADENCE], command)),
      },
      removed: { [referenceName(CADENCE)]: dropped.rows.length },
    };
  }
}
