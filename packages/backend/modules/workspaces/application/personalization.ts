import type { SettingsActor, SettingsAudit } from "./settings_management.ts";

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

export interface PersonalizationTransaction {
  readonly opaque: unknown;
}

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
  | { readonly status: "forbidden" | "unavailable" };

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
  | {
    readonly status:
      | "conflict"
      | "forbidden"
      | "invalid"
      | "not-found"
      | "replacement-conflict"
      | "required-default"
      | "stale"
      | "unavailable";
  };

export interface PersonalizationRepository {
  inspect(
    command: SettingsActor & {
      readonly id: string;
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<
    | { readonly entry: PersonalizationEntry; readonly status: "ready" }
    | { readonly status: "forbidden" | "not-found" | "unavailable" }
  >;
  list(
    command: SettingsActor & {
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<PersonalizationResult>;
  mutate(
    command: SettingsActor & PersonalizationMutation & {
      readonly section: PersonalizationSection;
      readonly transaction: PersonalizationTransaction;
    },
  ): Promise<PersonalizationMutationResult>;
}

export type WorkspacePersonalizationDeleteCommand = SettingsActor & {
  readonly action: "delete";
  readonly expectedUpdatedAt: string;
  readonly id: string;
  readonly replacementId?: string;
  readonly section: PersonalizationSection;
  readonly transaction: PersonalizationTransaction;
};

export interface WorkspacePersonalizationRepository
  extends PersonalizationRepository {
  authorize(
    command: Parameters<PersonalizationRepository["list"]>[0],
  ): Promise<boolean>;
  prepareDelete(command: WorkspacePersonalizationDeleteCommand): Promise<
    | { readonly entry: PersonalizationEntry; readonly status: "ready" }
    | {
      readonly status:
        | "forbidden"
        | "invalid"
        | "not-found"
        | "required-default"
        | "stale"
        | "unavailable";
    }
  >;
  deletePrepared(
    command: WorkspacePersonalizationDeleteCommand,
  ): Promise<{ readonly id: string; readonly status: "deleted" }>;
}

export interface PersonalizationDependencies {
  readonly audit: SettingsAudit;
  readonly clock: { now(): Date };
  readonly repository: PersonalizationRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: PersonalizationTransaction) => Promise<T>,
    ): Promise<T>;
  };
}

function normalizedMutation(
  section: PersonalizationSection,
  input: PersonalizationMutation,
): PersonalizationMutation | undefined {
  const hasOnly = (allowed: readonly string[]): boolean =>
    Object.keys(input).every((key) => allowed.includes(key));
  if (input.action === "delete") {
    if (
      section === "emotion-options" || section === "pet-categories" ||
      !hasOnly(["action", "expectedUpdatedAt", "id", "replacementId"])
    ) return undefined;
    return input;
  }
  const sortOrder = input.sortOrder;
  if (
    (input.action === "create" || sortOrder !== undefined) &&
    (sortOrder === undefined || !Number.isSafeInteger(sortOrder) ||
      sortOrder < 0 || sortOrder > 10_000)
  ) return undefined;
  const common = input.action === "create"
    ? ["action", "sortOrder"]
    : ["action", "expectedUpdatedAt", "id"];
  const hasUpdate = (...keys: readonly string[]): boolean =>
    input.action === "update" && keys.some((key) => key in input);
  if (input.action === "create") {
    if (section === "emotion-options" || section === "pet-categories") {
      return undefined;
    }
    if (section === "reminder-rules") {
      if (!hasOnly([...common, "daysBefore"])) return undefined;
    } else if (section === "relationship-types") {
      if (!hasOnly([...common, "forwardLabel", "reverseLabel"])) {
        return undefined;
      }
    } else if (!hasOnly([...common, "name"])) return undefined;
    if (
      (section === "contact-labels" || section === "tags") &&
      input.sortOrder !== 0
    ) return undefined;
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
          input.daysBefore > 3650))
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
      !forwardLabel || !reverseLabel || forwardLabel.length > 200 ||
      reverseLabel.length > 200
    ) return undefined;
    return { ...input, forwardLabel, reverseLabel };
  }
  const name = input.name?.trim();
  if (input.action === "create") {
    if (!name || name.length > 200) return undefined;
    return { ...input, name };
  }
  if (input.name !== undefined && (!name || name.length > 200)) {
    return undefined;
  }
  return name === undefined ? input : { ...input, name };
}

export function createPersonalizationManagement(
  dependencies: PersonalizationDependencies,
) {
  const isSection = (value: string): value is PersonalizationSection =>
    (PERSONALIZATION_SECTIONS as readonly string[]).includes(value);
  const allowed = (actor: SettingsActor): boolean =>
    actor.role === "owner" || actor.role === "admin";
  return {
    isSection,
    list(actor: SettingsActor, section: PersonalizationSection) {
      if (!allowed(actor)) {
        return Promise.resolve({ status: "forbidden" as const });
      }
      return dependencies.transaction.run((transaction) =>
        dependencies.repository.list({ ...actor, section, transaction })
      );
    },
    mutate(
      actor: SettingsActor,
      section: PersonalizationSection,
      input: PersonalizationMutation,
    ): Promise<PersonalizationMutationResult> {
      if (!allowed(actor)) {
        return Promise.resolve({ status: "forbidden" });
      }
      const normalized = normalizedMutation(section, input);
      if (!normalized) return Promise.resolve({ status: "invalid" });
      return dependencies.transaction.run(async (transaction) => {
        if (
          normalized.action === "delete" && !normalized.replacementId
        ) {
          const preview = await dependencies.repository.inspect({
            ...actor,
            id: normalized.id,
            section,
            transaction,
          });
          if (preview.status !== "ready") return preview;
          if (!preview.entry.canDelete) return { status: "required-default" };
          if (preview.entry.referenceCount > 0) {
            return {
              referenceCount: preview.entry.referenceCount,
              status: "replacement-required",
            };
          }
        }
        const result = await dependencies.repository.mutate({
          ...actor,
          ...normalized,
          section,
          transaction,
        });
        if (result.status !== "saved" && result.status !== "deleted") {
          return result;
        }
        await dependencies.audit.record({
          action: "workspace-personalization-updated",
          actor,
          occurredAt: dependencies.clock.now(),
          payload: { action: normalized.action, section },
          subjectId: actor.workspaceId,
          subjectType: "workspace",
          transaction,
        });
        return result;
      });
    },
  };
}

export type PersonalizationManagement = ReturnType<
  typeof createPersonalizationManagement
>;
