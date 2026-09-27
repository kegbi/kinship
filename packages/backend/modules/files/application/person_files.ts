/**
 * The person-files facade.
 *
 * `uploadAvatar` is the `avatar` upload kind (GAP-045): the same staged,
 * scanned upload with the avatar's own limit and allowlist, filed under the
 * avatar kind so a person's photo and document listing never shows it. Which
 * avatar a person is drawn with is the `people` module's record; this module
 * only keeps the bytes.
 *
 * A person's files are read two ways and written two, and all four share only
 * the context they establish inside each of their own transactions. They are
 * assembled here so a composition root still builds a single object with
 * `upload`, `list`, `download`, and `remove` on it, and so the split between
 * `person_file_reads.ts` and `person_file_writes.ts` stays an internal matter
 * rather than something every caller has to know about.
 */

import type { PersonFileActor } from "../ports/context.ts";
import { createPersonFileReads } from "./person_file_reads.ts";
import { createPersonFileWrites } from "./person_file_writes.ts";
import type { PersonFileManagementDependencies } from "./person_file_context.ts";

/** The title every stored avatar carries; the filename stays the member's. */
export const AVATAR_TITLE = "Avatar";

export function createPersonFileManagement(
  dependencies: PersonFileManagementDependencies,
) {
  const reads = createPersonFileReads(dependencies);
  const writes = createPersonFileWrites(dependencies);
  return {
    upload: writes.upload,
    uploadAvatar: (
      actor: PersonFileActor,
      personId: string,
      input: {
        readonly bytes: Uint8Array;
        readonly filename: string;
        readonly mimeType: string;
      },
    ) =>
      writes.upload(actor, personId, {
        ...input,
        kind: "avatar",
        title: AVATAR_TITLE,
      }),
    list: reads.list,
    download: reads.download,
    remove: writes.remove,
  };
}

export type PersonFileManagement = ReturnType<
  typeof createPersonFileManagement
>;
