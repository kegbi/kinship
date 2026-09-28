/**
 * The directory's last-contact rule (GAP-053): a person was last in contact
 * at their newest call, or at their newest conversation, a conversation
 * counting from its newest message. The three tables belong to
 * `interactions`, which this read model declares among its sources.
 *
 * The rule is DUPLICATED in the person profile's adapter
 * (`read-models/person-profile/adapters/postgres/person_profile_repository.ts`,
 * the `last_contact` join) for the hero's one person. The two must change
 * together; `tests/integration/people_favorites_postgres_test.ts` asserts that
 * the directory's order and each profile's `lastContactAt` agree.
 *
 * It is one aggregate per person over a workspace's history rather than a
 * per-person subquery: the directory orders a whole workspace by it, and a
 * correlated subquery did a person's worth of work for every person before
 * the page's limit. A thread's newest message and its own time fold into one
 * maximum, the same answer as each thread's greater time and then the newest
 * thread. Each arm is filtered by the workspace and, for a cursor's anchor,
 * by its one person, on the existing indexes.
 */

import { type RawBuilder, sql } from "kysely";

/**
 * A derived table `(person_id uuid, contacted_at timestamptz)` of every
 * person of `workspaceId` with any history, or only `personId` when given.
 * Embed it in a `sql` template as a `from` or `join` source with an alias.
 */
export function lastContactByPerson(
  workspaceId: string,
  personId?: string,
): RawBuilder<unknown> {
  const call = personId ? sql`and call.person_id = ${personId}::uuid` : sql``;
  const thread = personId
    ? sql`and thread.person_id = ${personId}::uuid`
    : sql``;
  return sql`(
    select contact.person_id, max(contact.contacted_at) as contacted_at
    from (
      select call.person_id, max(call.called_at) as contacted_at
      from crm.calls call
      where call.workspace_id = ${workspaceId}::uuid ${call}
      group by call.person_id
      union all
      select thread.person_id, max(thread.happened_at)
      from crm.conversation_threads thread
      where thread.workspace_id = ${workspaceId}::uuid ${thread}
      group by thread.person_id
      union all
      select thread.person_id, max(message.written_at)
      from crm.conversation_threads thread
      join crm.messages message on message.conversation_id = thread.id
      where thread.workspace_id = ${workspaceId}::uuid ${thread}
      group by thread.person_id
    ) contact
    group by contact.person_id
  )`;
}
