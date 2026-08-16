import type { PeopleActor, PeopleTransaction } from "./create_person.ts";

export type ProfileFactSection =
  | "addresses"
  | "contact-methods"
  | "first-meeting"
  | "food-preferences"
  | "pets"
  | "tags"
  | "work";

export interface ProfileFactOption {
  readonly id: string;
  readonly name: string;
}

export interface ContactMethodFact {
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly notes?: string;
  readonly typeId: string;
  readonly value: string;
}

export interface AddressFact {
  readonly city?: string;
  readonly country?: string;
  readonly displayName?: string;
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly postalCode?: string;
  readonly region?: string;
  readonly street?: string;
}

export interface FirstMeetingFact {
  readonly introducedByPersonId?: string;
  readonly notes?: string;
  readonly placeText?: string;
}

export interface FoodPreferencesFact {
  readonly foodPreferences: string;
}

export interface OccupationFact {
  readonly description?: string;
  readonly endOn?: string;
  readonly isCurrent: boolean;
  readonly organizationId?: string;
  readonly organizationName?: string;
  readonly startOn?: string;
  readonly title: string;
}

export interface PetFact {
  readonly categoryId?: string;
  readonly name?: string;
  readonly notes?: string;
}

export interface TagsFact {
  readonly tagIds: readonly string[];
}

export type ProfileFactValue =
  | AddressFact
  | ContactMethodFact
  | FirstMeetingFact
  | FoodPreferencesFact
  | OccupationFact
  | PetFact
  | TagsFact;

export interface ProfileFactRecord {
  readonly id: string;
  readonly referencesResolved?: boolean;
  readonly section: ProfileFactSection;
  readonly selectedOptions?: readonly ProfileFactOption[];
  readonly updatedAt: string;
  readonly value: ProfileFactValue;
}

export interface ProfileFactWorkspaceInspection {
  readonly hasMore?: boolean;
  readonly nextOptionAnchor?: ProfileFactOptionAnchor;
  readonly options: readonly ProfileFactOption[];
  readonly status: "hidden" | "invalid-reference" | "ready" | "stale-cursor";
}

export interface ProfileFactOptionAnchor {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
}

export interface ProfileFactWorkspaceBoundary {
  inspect(
    command: PeopleActor & {
      readonly includeOptions?: boolean;
      readonly section: ProfileFactSection;
      readonly lock?: boolean;
      readonly optionAfter?: ProfileFactOptionAnchor;
      readonly optionLimit?: number;
      readonly optionSearch?: string;
      readonly selectedOptionIds?: readonly string[];
      readonly selectedOnly?: boolean;
      readonly transaction: PeopleTransaction;
      readonly value?: ProfileFactValue;
    },
  ): Promise<ProfileFactWorkspaceInspection>;
}

export type ProfileFactContextLock =
  | { readonly status: "forbidden" | "not-found" }
  | {
    readonly personUpdatedAt: string;
    readonly status: "archived" | "ready";
  };

export interface ProfileFactRepository {
  inspectContext(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactContextLock>;
  inspectPersonReference?(
    command: PeopleActor & {
      readonly personId: string;
      readonly referencedPersonId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<boolean>;
  lockContext(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactContextLock>;
  inspectPageAnchor?(
    command: PeopleActor & {
      readonly after: ProfileFactPageAnchor;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<boolean>;
  list(
    command: PeopleActor & {
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
      readonly after?: ProfileFactPageAnchor;
      readonly factId?: string;
      readonly limit?: number;
    },
  ): Promise<readonly ProfileFactRecord[]>;
  listTagDescriptors?(
    command: PeopleActor & {
      readonly tagIds: readonly string[];
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly ProfileFactOption[]>;
  lockFact(
    command: PeopleActor & {
      readonly factId: string;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactRecord | undefined>;
  save(
    command: PeopleActor & {
      readonly expectedUpdatedAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
      readonly value: ProfileFactValue;
    },
  ): Promise<
    {
      readonly personUpdatedAt: string;
      readonly record: ProfileFactRecord;
    } | undefined
  >;
  delete(
    command: PeopleActor & {
      readonly expectedUpdatedAt: string;
      readonly factId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    {
      readonly before: ProfileFactRecord;
      readonly personUpdatedAt: string;
    } | undefined
  >;
  assertPostcondition(
    command: PeopleActor & {
      readonly action: "delete" | "save";
      readonly after?: ProfileFactRecord;
      readonly before?: ProfileFactRecord;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface ProfileFactAudit {
  record(command: {
    readonly action: "delete" | "save";
    readonly actor: PeopleActor;
    readonly after?: ProfileFactRecord;
    readonly before?: ProfileFactRecord;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: "delete" | "save";
    readonly actor: PeopleActor;
    readonly after?: ProfileFactRecord;
    readonly auditId: string;
    readonly before?: ProfileFactRecord;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ProfileFactDependencies {
  readonly audit: ProfileFactAudit;
  readonly clock: { now(): Date };
  readonly ids: { create(): string };
  readonly repository: ProfileFactRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: ProfileFactWorkspaceBoundary;
}

export type ProfileFactListResult =
  | { readonly status: "forbidden" | "not-found" | "stale-cursor" }
  | {
    readonly nextCursor?: string;
    readonly nextOptionsCursor?: string;
    readonly options: readonly ProfileFactOption[];
    readonly personUpdatedAt: string;
    readonly records: readonly ProfileFactRecord[];
    readonly status: "archived" | "hidden" | "ready";
  };

export type ProfileFactListInput =
  & {
    readonly cursor?: string;
    readonly optionSearch?: string;
  }
  & (
    | {
      readonly includeOptions: true;
      readonly optionCursor?: string;
    }
    | {
      readonly includeOptions?: never;
      readonly optionCursor?: never;
    }
  );

export type ProfileFactFailureResult =
  | {
    readonly status:
      | "archived-write-rejected"
      | "forbidden"
      | "hidden"
      | "invalid-reference"
      | "not-found"
      | "stale";
  }
  | {
    readonly errors: Readonly<Record<string, string>>;
    readonly status: "validation-error";
  };
export type ProfileFactMutationResult =
  | ProfileFactFailureResult
  | {
    readonly personUpdatedAt: string;
    readonly record: ProfileFactRecord;
    readonly status: "saved";
  }
  | {
    readonly factId: string;
    readonly personUpdatedAt: string;
    readonly status: "deleted";
  };

export type ProfileFactCreateInput = ProfileFactValue & {
  readonly expectedPersonUpdatedAt: string;
};

export type ProfileFactUpdateInput = ProfileFactValue & {
  readonly expectedPersonUpdatedAt: string;
  readonly expectedUpdatedAt: string;
  readonly id: string;
};

export const PROFILE_FACT_PAGE_SIZE = 50;
const PROFILE_FACT_SELECTED_OPTION_LIMIT = PROFILE_FACT_PAGE_SIZE * 21;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export interface ProfileFactPageAnchor {
  readonly id: string;
  readonly updatedAt: string;
}

interface ProfileFactCursor extends ProfileFactPageAnchor {
  readonly limit: typeof PROFILE_FACT_PAGE_SIZE;
  readonly personId: string;
  readonly personUpdatedAt: string;
  readonly section: ProfileFactSection;
  readonly version: 2;
}
interface ProfileFactOptionCursor extends ProfileFactOptionAnchor {
  readonly limit: 50;
  readonly personId: string;
  readonly search: string;
  readonly section: ProfileFactSection;
  readonly version: 2;
}

function encodeCursor(cursor: ProfileFactCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeCursor(value: string): ProfileFactCursor | undefined {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(normalized.padEnd(
      normalized.length + (4 - normalized.length % 4) % 4,
      "=",
    ))) as Partial<ProfileFactCursor>;
    return parsed.version === 2 && parsed.limit === PROFILE_FACT_PAGE_SIZE &&
        UUID_PATTERN.test(parsed.id ?? "") &&
        UUID_PATTERN.test(parsed.personId ?? "") &&
        REVISION_PATTERN.test(parsed.updatedAt ?? "") &&
        REVISION_PATTERN.test(parsed.personUpdatedAt ?? "") &&
        typeof parsed.section === "string"
      ? parsed as ProfileFactCursor
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeOptionCursor(cursor: ProfileFactOptionCursor): string {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeOptionCursor(
  value: string,
): ProfileFactOptionCursor | undefined {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed = JSON.parse(atob(normalized.padEnd(
      normalized.length + (4 - normalized.length % 4) % 4,
      "=",
    ))) as Partial<ProfileFactOptionCursor>;
    return parsed.version === 2 && parsed.limit === 50 &&
        UUID_PATTERN.test(parsed.id ?? "") &&
        UUID_PATTERN.test(parsed.personId ?? "") &&
        typeof parsed.primary === "string" &&
        typeof parsed.secondary === "string" &&
        typeof parsed.search === "string" &&
        typeof parsed.section === "string"
      ? parsed as ProfileFactOptionCursor
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalize(
  section: ProfileFactSection,
  input: ProfileFactValue,
): ProfileFactValue {
  if (section === "food-preferences") {
    const fact = input as FoodPreferencesFact;
    const foodPreferences = text(fact.foodPreferences);
    return { foodPreferences: foodPreferences ?? "" };
  }
  if (section === "first-meeting") {
    const fact = input as FirstMeetingFact;
    const notes = text(fact.notes);
    const placeText = text(fact.placeText);
    return {
      ...(fact.introducedByPersonId
        ? { introducedByPersonId: fact.introducedByPersonId }
        : {}),
      ...(notes ? { notes } : {}),
      ...(placeText ? { placeText } : {}),
    };
  }
  if (section === "tags") {
    return { tagIds: [...new Set((input as TagsFact).tagIds)] };
  }
  if (section === "contact-methods") {
    const fact = input as ContactMethodFact;
    return {
      isPrimary: fact.isPrimary,
      labelIds: [...new Set(fact.labelIds)],
      ...(text(fact.notes) ? { notes: text(fact.notes) } : {}),
      typeId: fact.typeId,
      value: fact.value.trim(),
    };
  }
  if (section === "addresses") {
    const fact = input as AddressFact;
    const city = text(fact.city);
    const country = text(fact.country);
    const displayName = text(fact.displayName);
    const postalCode = text(fact.postalCode);
    const region = text(fact.region);
    const street = text(fact.street);
    return {
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
      ...(displayName ? { displayName } : {}),
      isPrimary: fact.isPrimary,
      labelIds: [...new Set(fact.labelIds)],
      ...(postalCode ? { postalCode } : {}),
      ...(region ? { region } : {}),
      ...(street ? { street } : {}),
    };
  }
  if (section === "work") {
    const fact = input as OccupationFact;
    const description = text(fact.description);
    const organizationName = text(fact.organizationName);
    return {
      ...(description ? { description } : {}),
      ...(fact.endOn ? { endOn: fact.endOn } : {}),
      isCurrent: fact.isCurrent,
      ...(fact.organizationId ? { organizationId: fact.organizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
      ...(fact.startOn ? { startOn: fact.startOn } : {}),
      title: fact.title.trim(),
    };
  }
  const fact = input as PetFact;
  const name = text(fact.name);
  const notes = text(fact.notes);
  return {
    ...(fact.categoryId ? { categoryId: fact.categoryId } : {}),
    ...(name ? { name } : {}),
    ...(notes ? { notes } : {}),
  };
}

function validate(
  section: ProfileFactSection,
  value: ProfileFactValue,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  if (section === "contact-methods" && !(value as ContactMethodFact).value) {
    errors.value = "Enter a contact value.";
  }
  if (
    section === "food-preferences" &&
    !(value as FoodPreferencesFact).foodPreferences
  ) {
    errors.foodPreferences = "Enter a food preference or use Clear.";
  }
  if (section === "work" && !(value as OccupationFact).title) {
    errors.title = "Enter a role or title.";
  }
  if (section === "work") {
    const work = value as OccupationFact;
    if (work.startOn && work.endOn && work.endOn < work.startOn) {
      errors.endOn = "End date must be on or after the start date.";
    }
  }
  if (section === "addresses") {
    const address = value as AddressFact;
    if (
      ![
        address.displayName,
        address.street,
        address.city,
        address.region,
        address.postalCode,
        address.country,
      ].some(Boolean)
    ) {
      errors.address = "Enter an address name or location detail.";
    }
  }
  if (section === "pets") {
    const pet = value as PetFact;
    if (!pet.name && !pet.categoryId) {
      errors.pet = "Enter a pet name or select a category.";
    }
  }
  return errors;
}

function contextFailure(
  status: ProfileFactContextLock["status"],
): ProfileFactFailureResult {
  if (status === "archived") return { status: "archived-write-rejected" };
  return { status: status === "forbidden" ? "forbidden" : "not-found" };
}

export function createProfileFactManagement(
  dependencies: ProfileFactDependencies,
) {
  const mutate = async (
    actor: PeopleActor,
    personId: string,
    section: ProfileFactSection,
    input: ProfileFactCreateInput | ProfileFactUpdateInput,
    operation: "create" | "update",
  ): Promise<Exclude<ProfileFactMutationResult, { status: "deleted" }>> => {
    const { expectedPersonUpdatedAt, ...mutationInput } = input;
    const expectedUpdatedAt = "expectedUpdatedAt" in mutationInput
      ? mutationInput.expectedUpdatedAt
      : undefined;
    const id = "id" in mutationInput ? mutationInput.id : undefined;
    const { expectedUpdatedAt: _expected, id: _id, ...raw } = mutationInput as
      & ProfileFactValue
      & { readonly expectedUpdatedAt?: string; readonly id?: string };
    if (
      !Number.isFinite(Date.parse(expectedPersonUpdatedAt)) ||
      (operation === "update" &&
        (!id || !expectedUpdatedAt ||
          !Number.isFinite(Date.parse(expectedUpdatedAt))))
    ) {
      return {
        errors: {
          expectedPersonUpdatedAt: "Refresh this profile before saving.",
        },
        status: "validation-error",
      };
    }
    const value = normalize(section, raw as ProfileFactValue);
    const errors = validate(section, value);
    if (
      section === "first-meeting" &&
      (value as FirstMeetingFact).introducedByPersonId === personId
    ) {
      return {
        errors: { introducedByPersonId: "Choose another person." },
        status: "validation-error",
      };
    }
    if (Object.keys(errors).length) {
      return { errors, status: "validation-error" };
    }
    return await dependencies.transaction.run(async (transaction) => {
      const context = await dependencies.repository.lockContext({
        ...actor,
        personId,
        transaction,
      });
      if (context.status !== "ready") return contextFailure(context.status);
      if (context.personUpdatedAt !== expectedPersonUpdatedAt) {
        return { status: "stale" };
      }
      let targetId = dependencies.ids.create();
      if (
        operation === "create" &&
        ["first-meeting", "food-preferences", "tags"].includes(section)
      ) {
        const existing = await dependencies.repository.lockFact({
          ...actor,
          factId: personId,
          personId,
          section,
          transaction,
        });
        if (existing) return { status: "stale" };
        targetId = personId;
      } else if (operation === "update") {
        const target = await dependencies.repository.lockFact({
          ...actor,
          factId: id!,
          personId,
          section,
          transaction,
        });
        if (!target) return { status: "not-found" };
        if (target.updatedAt !== expectedUpdatedAt) return { status: "stale" };
        targetId = target.id;
      }
      const introducedByPersonId = section === "first-meeting"
        ? (value as FirstMeetingFact).introducedByPersonId
        : undefined;
      if (
        introducedByPersonId &&
        (!dependencies.repository.inspectPersonReference ||
          !await dependencies.repository.inspectPersonReference({
            ...actor,
            personId,
            referencedPersonId: introducedByPersonId,
            transaction,
          }))
      ) return { status: "invalid-reference" };
      const configuration = await dependencies.workspace.inspect({
        ...actor,
        lock: true,
        section,
        transaction,
        value,
      });
      if (configuration.status !== "ready") {
        return {
          status: configuration.status === "stale-cursor"
            ? "invalid-reference"
            : configuration.status,
        };
      }
      const occurredAt = dependencies.clock.now();
      const saved = await dependencies.repository.save({
        ...actor,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        id: targetId,
        occurredAt,
        personId,
        section,
        transaction,
        value,
      });
      if (!saved) return { status: "stale" };
      const { personUpdatedAt, record } = saved;
      const auditCommand = {
        action: "save" as const,
        actor,
        after: record,
        occurredAt,
        personId,
        transaction,
      };
      const auditId = await dependencies.audit.record(auditCommand);
      await dependencies.repository.assertPostcondition({
        action: "save",
        ...actor,
        after: record,
        personId,
        transaction,
      });
      await dependencies.audit.assertPostcondition({
        ...auditCommand,
        auditId,
      });
      return { personUpdatedAt, record, status: "saved" };
    });
  };
  return {
    list: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      input: ProfileFactListInput = {},
    ): Promise<ProfileFactListResult> => {
      const received = input as {
        readonly includeOptions?: boolean;
        readonly optionCursor?: string;
      };
      if (received.optionCursor && received.includeOptions !== true) {
        return Promise.resolve({ status: "stale-cursor" });
      }
      return dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.inspectContext({
          ...actor,
          personId,
          transaction,
        });
        if (!("personUpdatedAt" in context)) {
          return { status: context.status };
        }
        const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
        const optionSearch = input.optionSearch?.trim().toLowerCase() ?? "";
        const optionCursor = input.optionCursor
          ? decodeOptionCursor(input.optionCursor)
          : undefined;
        if (
          input.cursor &&
          (!cursor || cursor.section !== section ||
            cursor.personId !== personId ||
            cursor.personUpdatedAt !== context.personUpdatedAt)
        ) return { status: "stale-cursor" };
        if (
          input.optionCursor &&
          (!optionCursor || optionCursor.section !== section ||
            optionCursor.personId !== personId ||
            optionCursor.search !== optionSearch)
        ) return { status: "stale-cursor" };
        if (
          cursor && dependencies.repository.inspectPageAnchor &&
          !await dependencies.repository.inspectPageAnchor({
            ...actor,
            after: { id: cursor.id, updatedAt: cursor.updatedAt },
            personId,
            section,
            transaction,
          })
        ) return { status: "stale-cursor" };
        const configuration = await dependencies.workspace.inspect({
          ...actor,
          includeOptions: input.includeOptions === true,
          lock: false,
          ...(optionCursor
            ? {
              optionAfter: {
                id: optionCursor.id,
                primary: optionCursor.primary,
                secondary: optionCursor.secondary,
              },
            }
            : {}),
          optionLimit: 50,
          optionSearch,
          section,
          transaction,
        });
        if (configuration.status === "hidden") {
          return {
            options: configuration.options,
            personUpdatedAt: context.personUpdatedAt,
            records: [],
            status: "hidden",
          };
        }
        if (configuration.status === "stale-cursor") {
          return { status: "stale-cursor" };
        }
        const records = await dependencies.repository.list({
          ...actor,
          ...(cursor
            ? { after: { id: cursor.id, updatedAt: cursor.updatedAt } }
            : {}),
          limit: PROFILE_FACT_PAGE_SIZE + 1,
          personId,
          section,
          transaction,
        });
        const page = records.slice(0, PROFILE_FACT_PAGE_SIZE);
        const selectedOptionIds = [
          ...new Set(page.flatMap((record) => {
            const value = record.value as {
              readonly categoryId?: string;
              readonly labelIds?: readonly string[];
              readonly typeId?: string;
            };
            return [
              ...(value.typeId ? [value.typeId] : []),
              ...(value.categoryId ? [value.categoryId] : []),
              ...(value.labelIds ?? []).slice(0, 20),
            ];
          })),
        ];
        const selectedInspection = selectedOptionIds.length
          ? await dependencies.workspace.inspect({
            ...actor,
            includeOptions: true,
            lock: false,
            optionLimit: Math.min(
              selectedOptionIds.length + 1,
              PROFILE_FACT_SELECTED_OPTION_LIMIT + 1,
            ),
            optionSearch: "",
            section,
            selectedOptionIds,
            selectedOnly: true,
            transaction,
          })
          : { options: [], status: "ready" as const };
        const selectedById = new Map(
          selectedInspection.options.map((option) => [option.id, option]),
        );
        const hydratedPage = page.map((record) => {
          const value = record.value as {
            readonly categoryId?: string;
            readonly labelIds?: readonly string[];
            readonly typeId?: string;
          };
          const referenceIds = [
            ...(value.typeId ? [value.typeId] : []),
            ...(value.categoryId ? [value.categoryId] : []),
            ...(value.labelIds ?? []).slice(0, 20),
          ];
          const selectedOptions = referenceIds.flatMap((id) => {
            const option = selectedById.get(id);
            return option ? [option] : [];
          });
          return referenceIds.length || (value.labelIds?.length ?? 0) > 20
            ? {
              ...record,
              referencesResolved: (value.labelIds?.length ?? 0) <= 20 &&
                selectedOptions.length === referenceIds.length,
              selectedOptions,
            }
            : record;
        });
        const rawOptions =
          section === "tags" && dependencies.repository.listTagDescriptors
            ? await dependencies.repository.listTagDescriptors({
              ...actor,
              tagIds: page.flatMap((record) =>
                record.section === "tags"
                  ? (record.value as TagsFact).tagIds
                  : []
              ),
              transaction,
            })
            : section === "tags"
            ? []
            : input.includeOptions === true
            ? configuration.options.slice(0, 50)
            : [];
        const options = [...new Map(
          rawOptions.map((option) => [option.id, option]),
        ).values()];
        const responseRecords = section === "tags"
          ? hydratedPage.map((record) => ({
            ...record,
            referencesResolved: options.length ===
              (record.value as TagsFact).tagIds.length,
            selectedOptions: options,
          }))
          : hydratedPage;
        const hasMore = records.length > PROFILE_FACT_PAGE_SIZE;
        const finalRecord = page.at(-1);
        return {
          ...(hasMore && finalRecord
            ? {
              nextCursor: encodeCursor({
                id: finalRecord.id,
                limit: PROFILE_FACT_PAGE_SIZE,
                personId,
                personUpdatedAt: context.personUpdatedAt,
                section,
                updatedAt: finalRecord.updatedAt,
                version: 2,
              }),
            }
            : {}),
          ...(input.includeOptions === true && configuration.hasMore &&
              configuration.nextOptionAnchor
            ? {
              nextOptionsCursor: encodeOptionCursor({
                ...configuration.nextOptionAnchor,
                limit: 50,
                personId,
                search: optionSearch,
                section,
                version: 2,
              }),
            }
            : {}),
          options,
          personUpdatedAt: context.personUpdatedAt,
          records: responseRecords,
          status: context.status,
        };
      });
    },
    create: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      input: ProfileFactCreateInput,
    ) => mutate(actor, personId, section, input, "create"),
    update: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      input: ProfileFactUpdateInput,
    ) => mutate(actor, personId, section, input, "update"),
    delete: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      factId: string,
      expectedUpdatedAt: string,
      expectedPersonUpdatedAt: string,
    ): Promise<Exclude<ProfileFactMutationResult, { status: "saved" }>> =>
      dependencies.transaction.run(async (transaction) => {
        const context = await dependencies.repository.lockContext({
          ...actor,
          personId,
          transaction,
        });
        if (context.status !== "ready") return contextFailure(context.status);
        if (context.personUpdatedAt !== expectedPersonUpdatedAt) {
          return { status: "stale" };
        }
        const configuration = await dependencies.workspace.inspect({
          ...actor,
          lock: true,
          section,
          transaction,
        });
        if (configuration.status !== "ready") {
          return {
            status: configuration.status === "stale-cursor"
              ? "invalid-reference"
              : configuration.status,
          };
        }
        const occurredAt = dependencies.clock.now();
        const deleted = await dependencies.repository.delete({
          ...actor,
          expectedUpdatedAt,
          factId,
          occurredAt,
          personId,
          section,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        const { before, personUpdatedAt } = deleted;
        const auditCommand = {
          action: "delete" as const,
          actor,
          before,
          occurredAt,
          personId,
          transaction,
        };
        const auditId = await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertPostcondition({
          action: "delete",
          ...actor,
          before,
          personId,
          transaction,
        });
        await dependencies.audit.assertPostcondition({
          ...auditCommand,
          auditId,
        });
        return { factId, personUpdatedAt, status: "deleted" };
      }),
  };
}

export type ProfileFactManagement = ReturnType<
  typeof createProfileFactManagement
>;
