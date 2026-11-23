/**
 * Orders two writes of one workspace deterministically (MCP-E3).
 *
 * Every write use case revalidates its actor first, inside its transaction,
 * with `for no key update` of the account, member, and workspace rows
 * (`PostgresActorRevalidation`). Two writes of one workspace therefore queue
 * on the workspace row, whichever members make them, and the one that gets it
 * second runs only after the first commits. Holding that row from a fixture
 * session lets a test queue the writes in a chosen order and then let them
 * run: PostgreSQL grants a row lock to its waiters first come, first served.
 */

import type { Sql } from "./database.ts";

/** The revalidation statement's lock clause, which a queued write waits in. */
const REVALIDATION = "%for no key update of account, member, workspace%";

export interface WorkspaceWriteQueue {
  /** Resolves once `count` writes wait behind the held row. */
  queued(count: number): Promise<void>;
  /** Lets the queued writes run, in the order they queued. */
  release(): Promise<void>;
}

/**
 * Locks `workspaceId`'s row on a reserved fixture connection, as the
 * superuser, until `release`. Writes started meanwhile wait in their actor
 * revalidation.
 */
export async function holdWorkspaceWrites(
  sql: Sql,
  workspaceId: string,
): Promise<WorkspaceWriteQueue> {
  const holder = await sql.reserve();
  await holder`begin`;
  await holder`
    select 1 from crm.workspaces where id = ${workspaceId}::uuid
    for no key update
  `;
  let released = false;
  return {
    async queued(count) {
      for (let attempt = 0; attempt < 400; attempt++) {
        const [row] = await sql<{ readonly waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query ilike ${REVALIDATION}
        `;
        if ((row?.waiting ?? 0) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`${count} writes never queued on the workspace row`);
    },
    async release() {
      if (released) return;
      released = true;
      try {
        await holder`commit`;
      } finally {
        holder.release();
      }
    },
  };
}
