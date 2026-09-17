/**
 * The task facade.
 *
 * Tasks are read two ways and written three, and the two halves share only the
 * context they both establish first. They are assembled here so a composition
 * root still builds a single object with `get`, `create`, `list`, `change`, and
 * `setCompletion` on it, and so the split between `task_listing.ts` and
 * `task_writes.ts` stays an internal matter rather than something every caller
 * has to know about.
 *
 * `TaskManagement` stays narrower than what this builds: the API router and the
 * DAV synchronizer are given only the four verbs they use, so neither can grow
 * a dependency on the single-task read that belongs to the person profile.
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
  };
}

export type TaskManagement = Pick<
  ReturnType<typeof createTaskManagement>,
  "change" | "create" | "list" | "setCompletion"
>;
