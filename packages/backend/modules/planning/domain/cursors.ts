/**
 * How a task listing is paged.
 *
 * The cursor carries the keyset anchor the next page resumes from and the
 * question it was minted for: the workspace, the person filter, the status
 * filter, and the due-before bound. Those filters live inside the cursor, so
 * a forged one would widen the query the caller is served — which is why this
 * codec signs rather than merely encodes, using the kernel's HMAC pair.
 *
 * Minting and reading a cursor is arithmetic over the anchor, not a database
 * concern, so both sides live beside the tasks they page. Reading never
 * throws: a cursor that is unreadable, signed for another listing, or minted
 * for a different question is `undefined`, which the use case reports as a
 * stale cursor.
 */

import type { CursorKeyset } from "../../../shared-kernel/pagination.ts";
import { signCursor, verifyCursor } from "../../../shared-kernel/pagination.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";
import type { TaskListAnchor, TaskStatus } from "./task_rules.ts";

/** The signing domain that keeps a task cursor usable only for task listing. */
export const TASK_CURSOR_DOMAIN = "kinship.planning.task-cursor.v1";

/** The keys task cursors are sealed with. */
export type TaskCursorKeyset = CursorKeyset;

/** The question a cursor was minted for; a different one makes it stale. */
export interface TaskCursorScope {
  readonly dueBefore: string | null;
  readonly personId: string | null;
  readonly statusFilter: TaskStatus | null;
  readonly workspaceId: string;
}

/** The signed body: the question, plus the anchor to resume after. */
export interface TaskCursorBody
  extends TaskCursorScope, Omit<TaskListAnchor, "dueAt"> {
  readonly dueAt: string | null;
  readonly version: 1;
}

/** The cursor that resumes this listing after the given anchor. */
export function encodeTaskCursor(
  scope: TaskCursorScope,
  anchor: TaskListAnchor,
  keyset: TaskCursorKeyset,
): Promise<string> {
  return signCursor(
    TASK_CURSOR_DOMAIN,
    {
      ...scope,
      dueAt: anchor.dueAt ?? null,
      id: anchor.id,
      status: anchor.status,
      updatedAt: anchor.updatedAt,
      version: 1,
    } satisfies TaskCursorBody,
    keyset,
  );
}

/**
 * Reads a signed task cursor. The signature proves the anchor is one this
 * service minted; the checks below prove it belongs to the listing being
 * continued, so a cursor cannot carry a caller into another workspace's rows
 * or past a filter they did not ask for.
 */
export async function decodeTaskCursor(
  cursor: string,
  expected: TaskCursorScope,
  keyset: TaskCursorKeyset,
): Promise<TaskListAnchor | undefined> {
  const verified = await verifyCursor(TASK_CURSOR_DOMAIN, cursor, keyset);
  if (verified === null || typeof verified !== "object") return undefined;
  const body = verified as Record<string, unknown>;
  const id = typeof body.id === "string" ? uuid(body.id) : undefined;
  if (
    body.version !== 1 || body.workspaceId !== expected.workspaceId ||
    body.personId !== expected.personId ||
    body.statusFilter !== expected.statusFilter ||
    body.dueBefore !== expected.dueBefore || id === undefined ||
    !["cancelled", "completed", "open"].includes(String(body.status)) ||
    typeof body.updatedAt !== "string" || !isInstant(body.updatedAt) ||
    !(body.dueAt === null ||
      (typeof body.dueAt === "string" && isInstant(body.dueAt)))
  ) return undefined;
  return {
    ...(typeof body.dueAt === "string" ? { dueAt: body.dueAt } : {}),
    id,
    status: body.status as TaskStatus,
    updatedAt: body.updatedAt,
  };
}
