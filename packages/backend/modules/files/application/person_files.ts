/**
 * The person-files facade.
 *
 * A person's files are read two ways and written two, and all four share only
 * the context they establish inside each of their own transactions. They are
 * assembled here so a composition root still builds a single object with
 * `upload`, `list`, `download`, and `remove` on it, and so the split between
 * `person_file_reads.ts` and `person_file_writes.ts` stays an internal matter
 * rather than something every caller has to know about.
 */

import { createPersonFileReads } from "./person_file_reads.ts";
import { createPersonFileWrites } from "./person_file_writes.ts";
import type { PersonFileManagementDependencies } from "./person_file_context.ts";

export function createPersonFileManagement(
  dependencies: PersonFileManagementDependencies,
) {
  const reads = createPersonFileReads(dependencies);
  const writes = createPersonFileWrites(dependencies);
  return {
    upload: writes.upload,
    list: reads.list,
    download: reads.download,
    remove: writes.remove,
  };
}

export type PersonFileManagement = ReturnType<
  typeof createPersonFileManagement
>;
