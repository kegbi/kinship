import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

const SELF = "crm.workspace_members.self_person_id";

interface MergeScope {
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

/**
 * The membership side of a person merge (GAP-049).
 *
 * A member may be represented in the address book by one person, and a
 * person represents at most one member. When the duplicate represented a
 * member, the primary represents them afterwards. When both people represent
 * a member, one member would silently lose their record, so `inspect`
 * refuses the merge instead and the member is asked to resolve it first.
 *
 * Workspaces does not depend on people, so this answers the people module's
 * merge-participant port by shape alone; the API composition root registers
 * it beside the other modules' participants.
 */
export class PostgresSelfPersonMergeParticipant {
  readonly module = "workspaces";
  readonly references = [SELF];

  async countReferences(command: MergeScope & { readonly personId: string }) {
    const result = await sql<{ readonly count: number }>`
      select count(*)::int as count
      from crm.workspace_members
      where workspace_id = ${command.workspaceId}::uuid
        and self_person_id = ${command.personId}::uuid
    `.execute(databaseFromSession(command.transaction));
    return { [SELF]: result.rows[0]?.count ?? 0 };
  }

  async inspect(
    command: MergeScope & {
      readonly duplicateId: string;
      readonly primaryId: string;
    },
  ): Promise<{ readonly blocked?: "both-members" }> {
    const result = await sql<{ readonly represented: number }>`
      select count(distinct self_person_id)::int as represented
      from crm.workspace_members
      where workspace_id = ${command.workspaceId}::uuid
        and self_person_id in (
          ${command.primaryId}::uuid, ${command.duplicateId}::uuid
        )
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.represented === 2 ? { blocked: "both-members" } : {};
  }

  async relinkPerson(
    command: MergeScope & {
      readonly duplicateId: string;
      readonly occurredAt: Date;
      readonly primaryId: string;
    },
  ) {
    const relinked = await sql`
      update crm.workspace_members
      set self_person_id = ${command.primaryId}::uuid,
        updated_at = greatest(
          ${command.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )
      where workspace_id = ${command.workspaceId}::uuid
        and self_person_id = ${command.duplicateId}::uuid
      returning 1
    `.execute(databaseFromSession(command.transaction));
    return { relinked: { [SELF]: relinked.rows.length }, removed: {} };
  }
}
