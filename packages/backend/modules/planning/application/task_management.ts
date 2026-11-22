/**
 * The task facade.
 *
 * Tasks are read two ways and written four, and the two halves share only the
 * context they both establish first. They are assembled here so a composition
 * root still builds a single object with `get`, `create`, `list`, `change`,
 * `setCompletion`, and `delete` on it, and so the split between `task_listing.ts` and
 * `task_writes.ts` stays an internal matter rather than something every caller
 * has to know about.
 *
 * The HTTP router also uses the single-task read for scoped task automation;
 * it shares the profile's public use case and its workspace checks.
 */

import { createTaskListing } from "./task_listing.ts";
import { createTaskWrites } from "./task_writes.ts";
import type { TaskManagementDependencies } from "./task_context.ts";

export function createTaskManagement(dependencies: TaskManagementDependencies) {
  const listing = createTaskListing(dependencies);
  const writes = createTaskWrites(dependencies);
  return {
    get: listing.get,
    create: writes.create,
    list: listing.list,
    change: writes.change,
    setCompletion: writes.setCompletion,
    delete: writes.delete,
  };
}

export type TaskManagement = Pick<
  ReturnType<typeof createTaskManagement>,
  "change" | "create" | "delete" | "get" | "list" | "setCompletion"
>;
