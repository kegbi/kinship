/**
 * How a file becomes a gift's attachment.
 *
 * The two ports point in opposite directions and that is the whole design.
 * `GiftAttachmentTarget` is what this module asks: the `gifts` module owns the
 * gift table and already depends on this one, so it fills this port at the
 * composition root instead of `files` reading a table it does not own.
 * `GiftAttachmentBoundary` is what this module answers, and `gifts` consumes
 * through `public.ts` — the link row belongs to files, so validating,
 * attaching, and listing it stay here.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { PersonFileActor, PersonFileTransaction } from "./context.ts";

/** Which of the named gifts a workspace owns. */
export interface GiftAttachmentTarget {
  ownedGiftIds(command: {
    readonly giftIds: readonly string[];
    readonly transaction: PersonFileTransaction;
    readonly workspaceId: string;
  }): Promise<readonly string[]>;
}

export interface GiftAttachmentBoundary {
  validateSettlementPhoto(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly status: "ready"; readonly filename: string }
    | Failure<"not-found">
  >;
  availableSettlementPhotos(
    command: PersonFileActor & {
      readonly fileIds: readonly string[];
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<readonly string[]>;
  attachToGift(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly giftId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly status: "attached" }
    | Failure<"forbidden" | "not-found">
  >;
  validateForGift(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly status: "ready" }
    | Failure<"forbidden" | "not-found">
  >;
  listForGifts(
    command: PersonFileActor & {
      readonly giftIds: readonly string[];
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | {
      readonly links: readonly {
        readonly fileId: string;
        readonly giftId: string;
      }[];
      readonly status: "ready";
    }
    | Failure<"forbidden">
  >;
}
