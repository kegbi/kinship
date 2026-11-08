/**
 * Taking away an avatar image nobody draws any more (REL-056, REL-063).
 *
 * People decides which image a person is drawn with; this module only keeps
 * the bytes, so people calls here once an image has stopped being, or never
 * became, anybody's avatar: the one a replacement or a removal left behind,
 * a replacement that could not be linked, the duplicate's image a merge did
 * not keep, and the images held in quarantine for review.
 *
 * A discard is cleanup, not a member's request. The member who caused it may
 * have been removed and the person archived since the image was stored, and
 * the image must go all the same, so nothing here asks for the actor's
 * standing or the person's state. What bounds it instead is the workspace and
 * the person: only an avatar-kind image linked to that person in the actor's
 * own workspace is ever touched, and the generic removal cannot reach one.
 * The actor is still who the audit history names, as for any removal.
 *
 * The staging is the removal's: lock the rows, delete the objects, and record
 * them deleted in one transaction, so an object store that fails leaves every
 * row as it was, to be discarded again.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { PersonFileActor } from "../ports/context.ts";
import type { PersonFileManagementDependencies } from "./person_file_context.ts";

export type DiscardAvatarImagesResult =
  | { readonly fileIds: readonly string[]; readonly status: "discarded" }
  | Failure<"unavailable">;

export function createAvatarDiscards(
  dependencies: PersonFileManagementDependencies,
) {
  const discard = (
    actor: PersonFileActor,
    personId: string,
    fileId?: string,
  ): Promise<DiscardAvatarImagesResult> => {
    const occurredAt = dependencies.clock.now();
    const scope = { personId, workspaceId: actor.workspaceId };
    return runOrUnavailable(dependencies.transaction, async (transaction) => {
      const images = await dependencies.repository.lockAvatarImages({
        ...scope,
        ...(fileId ? { fileId } : {}),
        transaction,
      });
      for (const image of images) {
        await dependencies.storage.remove({ key: image.storageKey });
      }
      if (images.length > 0) {
        await dependencies.repository.discardAvatarImages({
          ...scope,
          fileIds: images.map((image) => image.fileId),
          occurredAt,
          transaction,
        });
      }
      for (const image of images) {
        await dependencies.audit.record({
          action: "removed",
          actor,
          file: image,
          occurredAt,
          transaction,
        });
      }
      return {
        fileIds: images.map((image) => image.fileId),
        status: "discarded" as const,
      };
    }, { workspaceId: actor.workspaceId });
  };

  return {
    /** Removes the person's named avatar image. */
    discardAvatar: (actor: PersonFileActor, personId: string, fileId: string) =>
      discard(actor, personId, fileId),
    /** Removes every avatar image of the person's held in quarantine. */
    discardHeldAvatars: (actor: PersonFileActor, personId: string) =>
      discard(actor, personId),
  };
}
