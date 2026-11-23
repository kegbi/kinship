/**
 * Who a person is, before anything is stored about them.
 *
 * A person enters the system as a handful of name parts and a flag saying the
 * record is deliberately incomplete. Three questions about that input are
 * decisions, not orchestration: which spelling of it is canonical, whether it
 * says enough to name somebody at all, and whether an identity already stored
 * is the same one a retry is asking for. They are answered here so the use
 * case is left with the transaction, the lock, and the audit.
 *
 * The derived identifier belongs here for the same reason: what makes a
 * creation idempotent is the rule that the workspace and the caller's request
 * identifier name exactly one person, not the SHA-256 the kernel computes.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { optionalText } from "../../../shared-kernel/validation.ts";

/** The namespace that makes a person creation idempotent across retries. */
export const PERSON_ID_NAMESPACE = "kinship.people.external-id.v1";

/** The name parts a caller offers when a person is first recorded. */
export interface CreatePersonInput {
  readonly duplicateOverride?: boolean;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/**
 * A person as the module identifies them, before the row that stores them is
 * written.
 */
export interface NewPersonIdentity {
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/**
 * A stored person as the module identifies them: the names, and the revision
 * (`updatedAt`, six fractional digits in UTC) every later edit, archive,
 * restore, and delete of them is decided against, so a caller that has just
 * read or created a person can change them without a second read.
 */
export interface PersonIdentity extends NewPersonIdentity {
  readonly updatedAt: string;
}

/** A person already in the workspace who may be the one being created. */
export interface PossibleDuplicate {
  readonly displayName: string;
  readonly id: string;
}

/**
 * The identifier a request identifier names inside a workspace.
 *
 * Two retries of one creation derive the same identifier, so the second lands
 * on the row the first wrote instead of creating a twin.
 */
export function derivePersonId(
  workspaceId: string,
  requestId: string,
): Promise<string> {
  return deterministicId(PERSON_ID_NAMESPACE, [workspaceId, requestId]);
}

/**
 * True when a stored identity is the one the input describes.
 *
 * A retry that reuses a request identifier with different names is a client
 * mistake, not the same creation, which is why every part is compared.
 */
export function sameIdentity(
  left: NewPersonIdentity,
  right: CreatePersonInput,
): boolean {
  return left.givenName === right.givenName &&
    left.familyName === right.familyName &&
    left.middleName === right.middleName && left.nickname === right.nickname &&
    left.isPartial === right.isPartial;
}

/**
 * The canonical spelling of the input: parts trimmed, blank-only parts
 * dropped entirely rather than stored as empty text.
 */
export function normalizeCreatePersonInput(
  input: CreatePersonInput,
): CreatePersonInput {
  const familyName = optionalText(input.familyName);
  const middleName = optionalText(input.middleName);
  const nickname = optionalText(input.nickname);
  return {
    ...(input.duplicateOverride ? { duplicateOverride: true } : {}),
    ...(familyName ? { familyName } : {}),
    givenName: input.givenName.trim(),
    isPartial: input.isPartial,
    ...(middleName ? { middleName } : {}),
    ...(nickname ? { nickname } : {}),
  };
}

/**
 * The field errors a normalized input carries.
 *
 * A person needs one usable name part, and a record with no given name has to
 * admit it is partial rather than pretend the name is known.
 */
export function validateCreatePersonInput(
  input: CreatePersonInput,
): ValidationErrors {
  if (!input.givenName && !input.familyName && !input.nickname) {
    return {
      givenName: "Enter a given name, family name, or nickname.",
    };
  }
  if (!input.givenName && !input.isPartial) {
    return {
      isPartial: "Mark the person as partial when their given name is unknown.",
    };
  }
  return {};
}

/** The identity a normalized input and a fresh identifier describe. */
export function personIdentityFrom(
  id: string,
  input: CreatePersonInput,
): NewPersonIdentity {
  return {
    ...(input.familyName ? { familyName: input.familyName } : {}),
    givenName: input.givenName,
    id,
    isPartial: input.isPartial,
    ...(input.middleName ? { middleName: input.middleName } : {}),
    ...(input.nickname ? { nickname: input.nickname } : {}),
  };
}
