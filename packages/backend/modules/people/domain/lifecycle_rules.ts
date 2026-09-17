/**
 * What may happen to a person, and when.
 *
 * A person is active, archived, or deleted, and four actions move them
 * between those states. Which action a person in a given state may accept, and
 * what a caller must say before the destructive one is allowed, are rules —
 * they do not depend on a database, a lock, or a clock. The use case reads the
 * row under lock, asks the question here, and then writes; every branch it
 * used to spell out inline is one of the decisions below.
 *
 * The delete confirmation phrase is part of the rule rather than of the
 * transport, because the same phrase has to be previewed and then matched.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { isInstant, optionalText } from "../../../shared-kernel/validation.ts";
import { displayName } from "./person_name.ts";

export type PersonLifecycleState = "active" | "archived" | "deleted";
export type PersonLifecycleAction = "archive" | "delete" | "edit" | "restore";
/** The two actions that only move a person between active and archived. */
export type PersonTransition = "archive" | "restore";

/** A person as the lifecycle rules read them. */
export interface PersonLifecycleRecord {
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly lifecycle: PersonLifecycleState;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly updatedAt: string;
}

/** The names an edit proposes, with the revision it was composed against. */
export interface EditPersonInput {
  readonly expectedUpdatedAt: string;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/** A state change that carries nothing but the revision it expects. */
export interface PersonTransitionInput {
  readonly expectedUpdatedAt: string;
}

/** A deletion, which also has to repeat the confirmation phrase back. */
export interface DeletePersonInput extends PersonTransitionInput {
  readonly confirmation: string;
}

/** Whether an edit may proceed against the person that was locked. */
export type EditDecision =
  | { readonly status: "archived-write-rejected" }
  | { readonly status: "not-found" }
  | { readonly status: "proceed" }
  | { readonly status: "stale" };

/** Whether an archive or restore may proceed, or is already true. */
export type TransitionDecision =
  | { readonly status: "not-found" }
  | { readonly status: "proceed" }
  | { readonly status: "stale" }
  | { readonly status: "unchanged" };

/** Whether a deletion may proceed, or has already happened. */
export type DeletionDecision =
  | { readonly status: "already-deleted" }
  | { readonly status: "confirmation-required" }
  | { readonly status: "proceed" }
  | { readonly status: "stale" };

/**
 * The canonical spelling of an edit: parts trimmed, blank-only parts dropped,
 * and the expected revision carried through exactly as it was received.
 */
export function normalizeEditPersonInput(
  input: EditPersonInput,
): EditPersonInput {
  const familyName = optionalText(input.familyName);
  const middleName = optionalText(input.middleName);
  const nickname = optionalText(input.nickname);
  return {
    expectedUpdatedAt: input.expectedUpdatedAt,
    ...(familyName ? { familyName } : {}),
    givenName: input.givenName.trim(),
    isPartial: input.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

/** The field errors a normalized edit carries. */
export function validateEditPersonInput(
  input: EditPersonInput,
): ValidationErrors {
  if (!input.givenName && !input.familyName && !input.nickname) {
    return { givenName: "Enter a given name, family name, or nickname." };
  }
  if (!input.givenName && !input.isPartial) {
    return {
      isPartial: "Mark the person as partial when their given name is unknown.",
    };
  }
  if (!isInstant(input.expectedUpdatedAt)) {
    return { expectedUpdatedAt: "Refresh this person before saving." };
  }
  return {};
}

/**
 * The phrase a member types to delete this person.
 *
 * It names the person as the product shows them, so confirming a deletion
 * means having read who is about to be deleted.
 */
export function deletionConfirmation(person: PersonLifecycleRecord): string {
  return `DELETE ${displayName(person)}`;
}

/**
 * Whether the locked person may be edited.
 *
 * A deleted person is gone, an archived one is read-only, and an edit composed
 * against an older revision is refused rather than silently applied.
 */
export function editDecision(
  person: PersonLifecycleRecord,
  expectedUpdatedAt: string,
): EditDecision {
  if (person.lifecycle === "deleted") return { status: "not-found" };
  if (person.lifecycle === "archived") {
    return { status: "archived-write-rejected" };
  }
  if (person.updatedAt !== expectedUpdatedAt) return { status: "stale" };
  return { status: "proceed" };
}

/**
 * Whether archiving or restoring the locked person changes anything.
 *
 * Asking for the state a person is already in succeeds without a write, and
 * without demanding a fresh revision: the caller wanted the end state, and it
 * already holds.
 */
export function transitionDecision(
  action: PersonTransition,
  person: PersonLifecycleRecord,
  expectedUpdatedAt: string,
): TransitionDecision {
  if (person.lifecycle === "deleted") return { status: "not-found" };
  if (
    action === "archive" && person.lifecycle === "archived" ||
    action === "restore" && person.lifecycle === "active"
  ) return { status: "unchanged" };
  if (person.updatedAt !== expectedUpdatedAt) return { status: "stale" };
  return { status: "proceed" };
}

/** The state a completed transition leaves the person in. */
export function transitionState(
  action: PersonTransition,
): "archived" | "restored" {
  return action === "archive" ? "archived" : "restored";
}

/**
 * Whether the locked person may be deleted.
 *
 * Deleting an already-deleted person is the outcome the caller asked for, so
 * it is reported as done rather than as a conflict. Otherwise the confirmation
 * phrase is checked before the revision, so a member who typed the wrong
 * phrase is told that first.
 */
export function deletionDecision(
  person: PersonLifecycleRecord,
  input: DeletePersonInput,
): DeletionDecision {
  if (person.lifecycle === "deleted") return { status: "already-deleted" };
  if (input.confirmation !== deletionConfirmation(person)) {
    return { status: "confirmation-required" };
  }
  if (person.updatedAt !== input.expectedUpdatedAt) return { status: "stale" };
  return { status: "proceed" };
}
