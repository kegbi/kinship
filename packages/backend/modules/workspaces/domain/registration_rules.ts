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
 * delivery layer answers: a duplicate address and a failed registration are
 * told apart by `code`, and a verification email that could not be sent after
 * the workspace was committed is a third thing again — the account exists, so
 * it must not look like a failed registration.
 */

/** How long a verification link, from either flow, works for. */
export const VERIFICATION_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** When a verification link issued now stops working. */
export function verificationExpiry(now: Date): Date {
  return new Date(now.getTime() + VERIFICATION_WINDOW_MS);
}

/** The relationship vocabulary every workspace is provisioned with. */
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
  readonly workspaceName: string;
}

/** Registration never signs anybody in; it asks them to prove the address. */
export interface FirstWorkspaceRegistrationResult {
  readonly status: "verification-required";
}

/** Registration did not happen, and the code says whether to say why. */
export class RegistrationError extends Error {
  readonly code: "duplicate_email" | "registration_failed";

  constructor(
    code: "duplicate_email" | "registration_failed" = "registration_failed",
  ) {
    super(
      code === "duplicate_email"
        ? "Email is already registered."
        : "Registration could not be completed.",
    );
    this.name = "RegistrationError";
    this.code = code;
  }
}

/**
 * Registration happened and the email did not.
 *
 * This is deliberately not a `RegistrationError`: the account and workspace
 * are committed, so the person has to be told to ask for another link rather
 * than to register again.
 */
export class VerificationDeliveryError extends Error {
  readonly code = "verification_delivery_failed";

  constructor() {
    super("Verification delivery failed after registration committed.");
    this.name = "VerificationDeliveryError";
  }
}
