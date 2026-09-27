/**
 * What a workspace may rename, reorder, disable, or delete in its own
 * vocabularies.
 *
 * Eleven sections share one repository and one mutation shape, and almost none
 * of them allow the same things. `normalizedMutation` is where that is
 * decided, and it is written as a whitelist in both directions: a mutation
 * naming a field the section does not have is refused, and an update naming
 * none of the fields it does have is refused too, so a request cannot silently
 * do nothing or silently do something else. Emotions and pet categories are
 * fixed vocabularies and take no creations or deletions at all.
 *
 * The section-specific quirks are each a product rule rather than a
 * shortcoming. Contact labels and tags are unordered, so a creation must ask
 * for position zero rather than pretend to choose. Gender options are the only
 * section with a default, and a default may only be set, never cleared, so the
 * section always has one. A relationship type is two labels and both move
 * together or neither does, because a half-renamed reciprocal pair reads
 * wrongly from one side. And a reminder rule is a number of days, bounded at
 * ten years, because a rule further out than that is a mistake rather than a
 * plan.
 */

import type { Failure } from "../../../shared-kernel/result.ts";

/** Every vocabulary a workspace may personalize. */
export const PERSONALIZATION_SECTIONS = [
  "profile-modules",
  "gender-options",
  "contact-method-types",
  "contact-labels",
  "activity-types",
  "emotion-options",
  "life-event-types",
  "relationship-types",
  "pet-categories",
  "reminder-rules",
  "tags",
] as const;

export type PersonalizationSection = typeof PERSONALIZATION_SECTIONS[number];

/**
 * The person-workspace sections a workspace may switch off or reorder
 * (GAP-047), in the order the workspace shows them: each one's
 * `workspace_profile_modules.key` and the name it is listed under. A section
 * with no row of its own is visible, in this order, and cannot be deleted; its
 * first change writes the row. The person workspace's section registry keys
 * the same sections (`apps/web/src/features/person/sections.ts`).
 */
export const PROFILE_MODULE_DEFAULTS = [
  { key: "contact-methods", name: "Contact methods" },
  { key: "addresses", name: "Addresses" },
  { key: "relationships", name: "Relationships" },
  { key: "first-meeting", name: "First meeting" },
  { key: "work", name: "Work" },
  { key: "food-preferences", name: "Food preferences" },
  { key: "pets", name: "Pets" },
  { key: "life-events", name: "Life events" },
  { key: "notes", name: "Notes" },
  { key: "conversations", name: "Conversations" },
  { key: "calls", name: "Calls" },
  { key: "activities", name: "Activities" },
  { key: "tasks", name: "Tasks" },
] as const;

/** The sections that are fixed: nothing is created in or deleted from them. */
const FIXED_SECTIONS: readonly PersonalizationSection[] = [
  "emotion-options",
  "pet-categories",
];

/** The sections with no order of their own, where a creation goes first. */
const UNORDERED_SECTIONS: readonly PersonalizationSection[] = [
  "contact-labels",
  "tags",
];

/** The furthest ahead a reminder rule may look, in days. */
const MAX_REMINDER_DAYS = 3_650;

/** The furthest a caller may push an entry down a list. */
const MAX_SORT_ORDER = 10_000;

/** The longest a name or a relationship label may be. */
const MAX_LABEL_LENGTH = 200;

export interface PersonalizationEntry {
  readonly capabilities: PersonalizationItemCapabilities;
  readonly canDelete: boolean;
  readonly daysBefore?: number;
  readonly forwardLabel?: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly kind: "named" | "relationship-type" | "reminder-rule";
  readonly name: string;
  readonly readOnly: boolean;
  readonly referenceCount: number;
  readonly reverseLabel?: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

export interface PersonalizationItemCapabilities {
  readonly delete: boolean;
  readonly disable: boolean;
  readonly editValue: boolean;
  readonly rename: boolean;
  readonly reorder: boolean;
  readonly replace: boolean;
  readonly setDefault: boolean;
}

export interface PersonalizationSectionCapabilities {
  readonly create: boolean;
  readonly editValue: boolean;
}

export type PersonalizationResult =
  | {
    readonly capabilities: PersonalizationSectionCapabilities;
    readonly entries: readonly PersonalizationEntry[];
    readonly readOnly: boolean;
    readonly status: "ready";
  }
  | Failure<"forbidden" | "unavailable">;

export type PersonalizationMutation =
  | {
    readonly action: "create";
    readonly daysBefore?: number;
    readonly forwardLabel?: string;
    readonly name?: string;
    readonly reverseLabel?: string;
    readonly sortOrder: number;
  }
  | {
    readonly action: "update";
    readonly expectedUpdatedAt: string;
    readonly daysBefore?: number;
    readonly forwardLabel?: string;
    readonly id: string;
    readonly isActive?: boolean;
    readonly isDefault?: true;
    readonly name?: string;
    readonly reverseLabel?: string;
    readonly sortOrder?: number;
  }
  | {
    readonly action: "delete";
    readonly expectedUpdatedAt: string;
    readonly id: string;
    readonly replacementId?: string;
  };

export type PersonalizationMutationResult =
  | { readonly entry: PersonalizationEntry; readonly status: "saved" }
  | { readonly id: string; readonly status: "deleted" }
  | { readonly referenceCount: number; readonly status: "replacement-required" }
  | Failure<
    "conflict" | "forbidden" | "not-found" | "unavailable",
    "invalid" | "replacement-conflict" | "required-default" | "stale"
  >;

/** True when the text names a section this module personalizes. */
export function isSection(value: string): value is PersonalizationSection {
  return (PERSONALIZATION_SECTIONS as readonly string[]).includes(value);
}

/**
 * The mutation as it will be applied, or nothing when the section does not
 * allow it.
 */
export function normalizedMutation(
  section: PersonalizationSection,
  input: PersonalizationMutation,
): PersonalizationMutation | undefined {
  const hasOnly = (allowed: readonly string[]): boolean =>
    Object.keys(input).every((key) => allowed.includes(key));
  if (input.action === "delete") {
    if (
      FIXED_SECTIONS.includes(section) ||
      !hasOnly(["action", "expectedUpdatedAt", "id", "replacementId"])
    ) return undefined;
    return input;
  }
  const sortOrder = input.sortOrder;
  if (
    (input.action === "create" || sortOrder !== undefined) &&
    (sortOrder === undefined || !Number.isSafeInteger(sortOrder) ||
      sortOrder < 0 || sortOrder > MAX_SORT_ORDER)
  ) return undefined;
  const common = input.action === "create"
    ? ["action", "sortOrder"]
    : ["action", "expectedUpdatedAt", "id"];
  const hasUpdate = (...keys: readonly string[]): boolean =>
    input.action === "update" && keys.some((key) => key in input);
  if (input.action === "create") {
    if (FIXED_SECTIONS.includes(section)) return undefined;
    if (section === "reminder-rules") {
      if (!hasOnly([...common, "daysBefore"])) return undefined;
    } else if (section === "relationship-types") {
      if (!hasOnly([...common, "forwardLabel", "reverseLabel"])) {
        return undefined;
      }
    } else if (!hasOnly([...common, "name"])) return undefined;
    if (UNORDERED_SECTIONS.includes(section) && input.sortOrder !== 0) {
      return undefined;
    }
  } else {
    const allowed = section === "profile-modules"
      ? ["isActive", "name", "sortOrder"]
      : section === "gender-options"
      ? ["isActive", "isDefault", "name", "sortOrder"]
      : section === "contact-method-types" || section === "activity-types" ||
          section === "life-event-types"
      ? ["isActive", "name", "sortOrder"]
      : section === "contact-labels"
      ? ["name"]
      : section === "relationship-types"
      ? ["forwardLabel", "isActive", "reverseLabel", "sortOrder"]
      : section === "reminder-rules"
      ? ["daysBefore", "isActive"]
      : section === "tags"
      ? ["name"]
      : [];
    if (
      allowed.length === 0 || !hasOnly([...common, ...allowed]) ||
      !hasUpdate(...allowed)
    ) return undefined;
    if (
      section === "gender-options" && input.isDefault !== undefined &&
      input.isDefault !== true
    ) return undefined;
    if (
      section === "relationship-types" &&
      ((input.forwardLabel === undefined) !==
        (input.reverseLabel === undefined))
    ) return undefined;
  }
  if (section === "reminder-rules") {
    if (
      (input.action === "create" && input.daysBefore === undefined) ||
      (input.daysBefore !== undefined &&
        (!Number.isInteger(input.daysBefore) || input.daysBefore < 0 ||
          input.daysBefore > MAX_REMINDER_DAYS))
    ) return undefined;
    return input;
  }
  if (section === "relationship-types") {
    const forwardLabel = input.forwardLabel?.trim();
    const reverseLabel = input.reverseLabel?.trim();
    if (input.action === "update" && input.forwardLabel === undefined) {
      return input;
    }
    if (
      !forwardLabel || !reverseLabel ||
      forwardLabel.length > MAX_LABEL_LENGTH ||
      reverseLabel.length > MAX_LABEL_LENGTH
    ) return undefined;
    return { ...input, forwardLabel, reverseLabel };
  }
  const name = input.name?.trim();
  if (input.action === "create") {
    if (!name || name.length > MAX_LABEL_LENGTH) return undefined;
    return { ...input, name };
  }
  if (input.name !== undefined && (!name || name.length > MAX_LABEL_LENGTH)) {
    return undefined;
  }
  return name === undefined ? input : { ...input, name };
}
