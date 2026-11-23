/**
 * What a brand-new workspace starts with, and how registration can fail.
 *
 * The relationship vocabulary is the substantial part. Every workspace is
 * provisioned with the same twenty-six pairs, in the same order, and each pair
 * names both directions — `parent`/`child` rather than one label and a rule
 * for inverting it — because a reciprocal relationship has two names and only
 * the workspace gets to rename either. The order is the display order, so the
 * list is written in the order people expect to see it rather than
 * alphabetically, and `sortOrder` is derived from the position so the two can
 * never drift apart.
 *
 * The two error classes are here because their codes are part of what the
 * delivery layer answers. There is no "duplicate address" error any more
 * (SECA-02): a registration for an address that already has an account
 * answers exactly as a new one does, and the mailbox is told instead. A
 * verification email that could not be sent after the workspace was committed
 * is a different thing from a failed registration — the account exists, so it
 * must not look like a failed one.
 */

/** How long a verification link, from either flow, works for. */
export const VERIFICATION_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Registration mail one address may be sent in a rolling day (SECA-03,
 * AUD-M3): a verification link or the "you already have an account" notice,
 * from registering, from asking for another link, or from registering through
 * an invitation. Every request that could send one counts, whatever the
 * address turns out to be, so reaching the ceiling says nothing about whether
 * the address has an account.
 */
export const REGISTRATION_MAIL_DAILY_CEILING = 10;

/** When a verification link issued now stops working. */
export function verificationExpiry(now: Date): Date {
  return new Date(now.getTime() + VERIFICATION_WINDOW_MS);
}

/** The seeds already paired with a workspace id in an advisory lock key. */
export const WORKSPACE_LOCK_SEEDS_IN_USE: readonly number[] = [
  2, // member administration
  7, // workspace lifecycle
  23, // contact method types and personalization
  29, // tags
  31, // reminder rules
];

/**
 * The relationship vocabulary every workspace is provisioned with.
 *
 * Provisioning serialises on an advisory lock keyed by the workspace id with
 * `version` as its seed. Other workspace locks use the same key with the
 * seeds in `WORKSPACE_LOCK_SEEDS_IN_USE`, so a new version must avoid them:
 * sharing a seed with member administration or the workspace lifecycle would
 * make provisioning wait on, or deadlock with, a reset.
 */
export const DEFAULT_RELATIONSHIP_TYPE_VOCABULARY = {
  version: 1,
  types: [
    ["partner", "partner"],
    ["spouse", "spouse"],
    ["date", "date"],
    ["lover", "lover"],
    ["inlovewith", "lovedby"],
    ["lovedby", "inlovewith"],
    ["ex", "ex"],
    ["parent", "child"],
    ["child", "parent"],
    ["sibling", "sibling"],
    ["grandparent", "grandchild"],
    ["grandchild", "grandparent"],
    ["uncle", "nephew"],
    ["nephew", "uncle"],
    ["cousin", "cousin"],
    ["godfather", "godson"],
    ["godson", "godfather"],
    ["stepparent", "stepchild"],
    ["stepchild", "stepparent"],
    ["friend", "friend"],
    ["bestfriend", "bestfriend"],
    ["colleague", "colleague"],
    ["boss", "subordinate"],
    ["subordinate", "boss"],
    ["mentor", "protege"],
    ["protege", "mentor"],
  ].map(([forwardLabel, reverseLabel], sortOrder) => ({
    forwardLabel: forwardLabel!,
    reverseLabel: reverseLabel!,
    sortOrder,
  })),
} as const;

export type DefaultRelationshipType =
  (typeof DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types)[number];

/** What somebody sends to register themselves and their first workspace. */
export interface FirstWorkspaceRegistrationCommand {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  /**
   * The secret the registering browser keeps in its cookie (SECA-01). Only a
   * verification that presents it keeps `passwordHash`.
   */
  readonly registrantVerifier: string;
  readonly workspaceName: string;
}

/** Registration never signs anybody in; it asks them to prove the address. */
export interface FirstWorkspaceRegistrationResult {
  readonly status: "verification-required";
}

/** Registration did not happen; nothing was written. */
export class RegistrationError extends Error {
  readonly code = "registration_failed";

  constructor() {
    super("Registration could not be completed.");
    this.name = "RegistrationError";
  }
}

/**
 * Registration happened and the email did not.
 *
 * This is deliberately not a `RegistrationError`: the pending account is
 * committed, so the person has to be told to ask for another link rather than
 * to register again. Its workspace is provisioned when the address is proved.
 */
export class VerificationDeliveryError extends Error {
  readonly code = "verification_delivery_failed";

  constructor() {
    super("Verification delivery failed after registration committed.");
    this.name = "VerificationDeliveryError";
  }
}
