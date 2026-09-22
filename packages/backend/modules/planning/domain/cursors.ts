/**
 * How a task listing and a person's reminder section are paged.
 *
 * The cursor carries the keyset anchor the next page resumes from and the
 * question it was minted for: the workspace, the person filter, the status
 * filter, and the due-before bound. Those filters live inside the cursor, so
 * a forged one would widen the query the caller is served — which is why this
 * codec signs rather than merely encodes, using the kernel's HMAC pair.
 *
 * The reminder cursor below is the plain pair instead. A person's reminders
 * are read with no filter beyond the person, the anchor is re-validated
 * against rows the caller is already allowed to see, and the workspace and the
 * person travel in the body and are checked on the way in — so there is
 * nothing a forged one could widen.
 *
 * Minting and reading a cursor is arithmetic over the anchor, not a database
 * concern, so both sides live beside the work they page. Reading never throws:
 * a cursor that is unreadable, signed for another listing, or minted for a
 * different question is `undefined`, which the use case reports as a stale
 * cursor or a rejected query.
 */

import type { CursorKeyset } from "../../../shared-kernel/pagination.ts";
import {
  decodeCursor,
  encodeCursor,
  signCursor,
  verifyCursor,
} from "../../../shared-kernel/pagination.ts";
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

/** The cursor body shape a reminder page currently mints. */
export const REMINDER_CURSOR_VERSION = 1;

/**
 * Where a page of one person's reminders resumes.
 *
 * Active reminders sort ahead of disabled ones, so the anchor carries that
 * state as well as the `updated_at desc, id` pair underneath it.
 */
export interface ReminderPageAnchor {
  readonly id: string;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

interface EncodedReminderCursor extends ReminderPageAnchor {
  readonly personId: string;
  readonly version: 1;
  readonly workspaceId: string;
}

/** The cursor that resumes this person's reminders after the given anchor. */
export function encodeReminderCursor(
  anchor: ReminderPageAnchor,
  workspaceId: string,
  personId: string,
): string {
  return encodeCursor(
    {
      id: anchor.id,
      isActive: anchor.isActive,
      personId,
      updatedAt: anchor.updatedAt,
      version: REMINDER_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedReminderCursor,
  );
}

/** The anchor a reminder cursor decodes to, or `undefined`. */
export function decodeReminderCursor(
  value: string,
  workspaceId: string,
  personId: string,
): ReminderPageAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedReminderCursor>
    | undefined;
  if (
    parsed?.version !== REMINDER_CURSOR_VERSION ||
    parsed.workspaceId !== workspaceId || parsed.personId !== personId ||
    uuid(parsed.id) === undefined || typeof parsed.isActive !== "boolean" ||
    !isInstant(parsed.updatedAt)
  ) return undefined;
  return {
    id: parsed.id!,
    isActive: parsed.isActive,
    updatedAt: parsed.updatedAt,
  };
}
