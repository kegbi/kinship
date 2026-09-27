/**
 * How the module sets the image a person is drawn with (GAP-045).
 *
 * Two ports, for the two owners involved. `PersonAvatarRepository` is the
 * people module's own `person_avatars` row: which avatar the person has now,
 * locked while it changes. `PersonAvatarImages` is the `files` module's upload
 * facade seen from here. People may not depend on files — files already
 * depends on people — so this module names the port it needs and the
 * composition root fills it with the files facade, the same direction the
 * gifts attachment target takes.
 *
 * The images port stores bytes outside any people transaction, because the
 * object store is not in the database's unit of work: a stored image is
 * linked in a transaction of its own afterwards, and an image that never gets
 * linked is discarded again.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { AvatarSource } from "../domain/avatar.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** The avatar a person has now, as `person_avatars` records it. */
export interface PersonAvatarState {
  readonly backgroundColor?: string;
  readonly fileId?: string;
  readonly source: AvatarSource;
}

/** The image bytes an avatar is made from, as the member sent them. */
export interface AvatarImageInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mimeType: string;
}

export interface PersonAvatarImages {
  /**
   * Stores, scans, and files the image. A quarantined image is kept for an
   * administrator to review, and is never linked as the avatar.
   */
  store(
    command: AvatarImageInput & {
      readonly actor: PeopleActor;
      readonly personId: string;
    },
  ): Promise<
    | {
      readonly fileId: string;
      readonly status: "available" | "quarantined";
    }
    | Failure<
      "forbidden" | "not-found" | "unavailable",
      "rejected-media" | "storage-limit" | "validation-error"
    >
  >;
  /** Removes an image that no longer is, or never became, the avatar. */
  discard(command: {
    readonly actor: PeopleActor;
    readonly fileId: string;
    readonly personId: string;
  }): Promise<void>;
}

export interface PersonAvatarRepository {
  /** Locks the person and answers whether they are archived, and their avatar. */
  lock(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly archived: boolean;
      readonly avatar: PersonAvatarState;
      readonly status: "ready";
    }
    | Failure<"not-found">
  >;
  /**
   * Makes the file the person's avatar, or, without one, resets the person to
   * their initials. The stored colour is kept either way.
   */
  save(
    command: PeopleActor & {
      readonly fileId?: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<PersonAvatarState>;
}
