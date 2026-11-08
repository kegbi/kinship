/**
 * Reading one page of one profile section.
 *
 * The listing does more than page rows. It resolves the workspace vocabulary
 * each fact points at, so a caller sees "Mobile" rather than a label
 * identifier, and it says whether that resolution was complete — a fact
 * carrying more labels than the page resolves is reported as unresolved rather
 * than silently shown short. Tags are the exception the shape has to carry:
 * the descriptors come from the repository rather than from the section's
 * vocabulary, because a tag is the workspace's own row.
 *
 * Every cursor is re-checked against the question it was minted for, and a
 * cursor that no longer matches — a different section, a different person, a
 * person edited since — is stale rather than merely empty.
 */

import {
  decodeFactCursor,
  decodeOptionCursor,
  encodeFactCursor,
  encodeOptionCursor,
  factCursorMatches,
  optionCursorMatches,
  PROFILE_FACT_OPTION_PAGE_SIZE,
  PROFILE_FACT_PAGE_SIZE,
} from "../domain/profile_facts/cursors.ts";
import type {
  ProfileFactOption,
  ProfileFactRecord,
  ProfileFactSection,
  TagsFact,
} from "../domain/profile_facts/values.ts";
import type { PeopleActor } from "../ports/context.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  inspectConfiguration,
  profileFactContext,
  type ProfileFactDependencies,
} from "./profile_fact_context.ts";

/**
 * How many selected options one page may resolve.
 *
 * A page of fifty facts can reference one type, one category, one
 * organization, and twenty labels each, so this is the ceiling that keeps a
 * resolution query bounded no matter how many references a page carries.
 */
const PROFILE_FACT_SELECTED_OPTION_LIMIT = PROFILE_FACT_PAGE_SIZE * 21;

export type ProfileFactListResult =
  | Failure<"forbidden" | "not-found", "stale-cursor">
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

/** The vocabulary references one stored value points at. */
interface ProfileFactReferences {
  readonly categoryId?: string;
  readonly labelIds?: readonly string[];
  readonly organizationId?: string;
  readonly typeId?: string;
}

/** How many labels of one fact a page resolves before giving up. */
const RESOLVED_LABEL_LIMIT = 20;

function referenceIdsOf(record: ProfileFactRecord): string[] {
  const value = record.value as ProfileFactReferences;
  return [
    ...(value.typeId ? [value.typeId] : []),
    ...(value.categoryId ? [value.categoryId] : []),
    ...(value.organizationId ? [value.organizationId] : []),
    ...(value.labelIds ?? []).slice(0, RESOLVED_LABEL_LIMIT),
  ];
}

export function createProfileFactListing(
  dependencies: ProfileFactDependencies,
) {
  return (
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
      const context = await profileFactContext(
        dependencies,
        actor,
        personId,
        transaction,
        false,
      );
      if (!("personUpdatedAt" in context)) {
        return { status: context.status };
      }
      const cursor = input.cursor ? decodeFactCursor(input.cursor) : undefined;
      const optionSearch = input.optionSearch?.trim().toLowerCase() ?? "";
      const optionCursor = input.optionCursor
        ? decodeOptionCursor(input.optionCursor)
        : undefined;
      if (
        input.cursor && !factCursorMatches(cursor, {
          personId,
          personUpdatedAt: context.personUpdatedAt,
          section,
        })
      ) return { status: "stale-cursor" };
      if (
        input.optionCursor &&
        !optionCursorMatches(optionCursor, {
          personId,
          search: optionSearch,
          section,
        })
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
      const configuration = await inspectConfiguration(dependencies, {
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
        optionLimit: PROFILE_FACT_OPTION_PAGE_SIZE,
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
        ...new Set(page.flatMap(referenceIdsOf)),
      ];
      const selectedInspection = selectedOptionIds.length
        ? await inspectConfiguration(dependencies, {
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
        const labelIds = (record.value as ProfileFactReferences).labelIds;
        const referenceIds = referenceIdsOf(record);
        const selectedOptions = referenceIds.flatMap((id) => {
          const option = selectedById.get(id);
          return option ? [option] : [];
        });
        return referenceIds.length ||
            (labelIds?.length ?? 0) > RESOLVED_LABEL_LIMIT
          ? {
            ...record,
            referencesResolved: (labelIds?.length ?? 0) <=
                RESOLVED_LABEL_LIMIT &&
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
              record.section === "tags" ? (record.value as TagsFact).tagIds : []
            ),
            transaction,
          })
          : section === "tags"
          ? []
          : input.includeOptions === true
          ? configuration.options.slice(0, PROFILE_FACT_OPTION_PAGE_SIZE)
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
            nextCursor: encodeFactCursor({
              anchor: finalRecord,
              personId,
              personUpdatedAt: context.personUpdatedAt,
              section,
            }),
          }
          : {}),
        ...(input.includeOptions === true && configuration.hasMore &&
            configuration.nextOptionAnchor
          ? {
            nextOptionsCursor: encodeOptionCursor({
              anchor: configuration.nextOptionAnchor,
              personId,
              search: optionSearch,
              section,
            }),
          }
          : {}),
        options,
        personUpdatedAt: context.personUpdatedAt,
        records: responseRecords,
        status: context.status,
      };
    }, { workspaceId: actor.workspaceId });
  };
}
