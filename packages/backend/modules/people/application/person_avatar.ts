/**
 * Giving a person an avatar, and taking it away again (GAP-045, PEOPLE-007).
 *
 * The bytes belong to `files` and the choice belongs to `people`, so a
 * replacement is three steps across two stores that share no transaction:
 *
 * 1. Lock the person and refuse an archived one before any bytes move.
 * 2. Hand the image to the files facade, which checks, scans, and stores it.
 *    A quarantined image stays with files for an administrator and is never
 *    linked; a refused one never existed.
 * 3. Lock the person again, link the new image, and audit — then discard the
 *    image it replaced. If the link cannot be made (the person was archived
 *    meanwhile, the member was removed, the database failed) the new image is
 *    discarded instead, so nothing is left that no avatar points at.
 *
 * Removal is one transaction that resets the person to their initials and
 * then discards the old image. Discarding is best effort: an image that
 * cannot be removed right now is still no longer anybody's avatar.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { PersonAvatarRecord } from "../domain/avatar.ts";
import type { PersonAvatarAudit } from "../ports/audit.ts";
import type {
  AvatarImageInput,
  PersonAvatarImages,
  PersonAvatarRepository,
  PersonAvatarState,
} from "../ports/avatar.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  PeopleTransactionRunner,
} from "../ports/context.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PersonAvatarDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: PersonAvatarAudit;
  readonly clock: Clock;
  readonly images: PersonAvatarImages;
  readonly repository: PersonAvatarRepository;
  readonly transaction: PeopleTransactionRunner;
}

type AvatarWriteFailure = Failure<
  "archived-write-rejected" | "forbidden" | "not-found" | "unavailable"
>;

export type ReplacePersonAvatarResult =
  | { readonly avatar: PersonAvatarRecord; readonly status: "updated" }
  | AvatarWriteFailure
  | Failure<
    never,
    "quarantined" | "rejected-media" | "storage-limit" | "validation-error"
  >;

export type RemovePersonAvatarResult =
  | { readonly avatar: PersonAvatarRecord; readonly status: "removed" }
  | AvatarWriteFailure;

/** The record a reader is told about, from the row the module keeps. */
function record(state: PersonAvatarState): PersonAvatarRecord {
  return {
    ...(state.backgroundColor
      ? { backgroundColor: state.backgroundColor }
      : {}),
    ...(state.source === "file" && state.fileId
      ? { fileId: state.fileId }
      : {}),
  };
}

export function createPersonAvatarManagement(
  dependencies: PersonAvatarDependencies,
) {
  /** The member's standing, then the person, both under lock. */
  const writable = async (
    actor: PeopleActor,
    personId: string,
    transaction: PeopleTransaction,
  ): Promise<
    | { readonly avatar: PersonAvatarState; readonly status: "ready" }
    | Failure<"archived-write-rejected" | "forbidden" | "not-found">
  > => {
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing !== "active") return { status: "forbidden" };
    const locked = await dependencies.repository.lock({
      ...actor,
      personId,
      transaction,
    });
    if (locked.status !== "ready") return locked;
    if (locked.archived) return { status: "archived-write-rejected" };
    return { avatar: locked.avatar, status: "ready" };
  };

  const discard = async (
    actor: PeopleActor,
    personId: string,
    fileId: string | undefined,
  ): Promise<void> => {
    if (!fileId) return;
    await dependencies.images.discard({ actor, fileId, personId }).catch(
      () => undefined,
    );
  };

  return {
    replace: async (
      actor: PeopleActor,
      personId: string,
      image: AvatarImageInput,
    ): Promise<ReplacePersonAvatarResult> => {
      const checked = await runOrUnavailable(
        dependencies.transaction,
        (transaction) => writable(actor, personId, transaction),
      );
      if (checked.status !== "ready") return checked;

      const stored:
        | Awaited<ReturnType<PersonAvatarImages["store"]>>
        | Failure<"unavailable"> = await dependencies.images.store({
          ...image,
          actor,
          personId,
        }).catch(() => ({ status: "unavailable" as const }));
      if (stored.status === "quarantined") return { status: "quarantined" };
      if (stored.status !== "available") return { status: stored.status };

      const occurredAt = dependencies.clock.now();
      const linked = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          const current = await writable(actor, personId, transaction);
          if (current.status !== "ready") return current;
          const avatar = await dependencies.repository.save({
            ...actor,
            fileId: stored.fileId,
            occurredAt,
            personId,
            transaction,
          });
          await dependencies.audit.record({
            action: "updated",
            actor,
            occurredAt,
            personId,
            transaction,
          });
          return {
            avatar,
            previous: current.avatar.fileId,
            status: "updated" as const,
          };
        },
      );
      if (linked.status !== "updated") {
        await discard(actor, personId, stored.fileId);
        return linked;
      }
      if (linked.previous !== stored.fileId) {
        await discard(actor, personId, linked.previous);
      }
      return { avatar: record(linked.avatar), status: "updated" };
    },

    remove: async (
      actor: PeopleActor,
      personId: string,
    ): Promise<RemovePersonAvatarResult> => {
      const occurredAt = dependencies.clock.now();
      const reset = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          const current = await writable(actor, personId, transaction);
          if (current.status !== "ready") return current;
          if (current.avatar.source === "default" && !current.avatar.fileId) {
            return {
              avatar: current.avatar,
              previous: undefined,
              status: "removed" as const,
            };
          }
          const avatar = await dependencies.repository.save({
            ...actor,
            occurredAt,
            personId,
            transaction,
          });
          await dependencies.audit.record({
            action: "removed",
            actor,
            occurredAt,
            personId,
            transaction,
          });
          return {
            avatar,
            previous: current.avatar.fileId,
            status: "removed" as const,
          };
        },
      );
      if (reset.status !== "removed") return reset;
      await discard(actor, personId, reset.previous);
      return { avatar: record(reset.avatar), status: "removed" };
    },
  };
}

export type PersonAvatarManagement = ReturnType<
  typeof createPersonAvatarManagement
>;
