/**
 * Where a fact editor's choices come from (GAP-029).
 *
 * Four sections choose from a workspace vocabulary the fact read answers
 * with (contact types and labels, organizations, pet categories), first
 * meeting chooses an introducer from the people directory, and tags choose
 * from the workspace's tags. Each list is bounded, so an editor loads one
 * page when it first opens and offers a search and a "load more" for the
 * rest. A lookup here says how to ask for a page and how to say that the
 * asking failed; the editor keeps what the reader already chose visible
 * across every page it loads.
 *
 * An editor never opens on choices it could not verify: a record whose
 * references the read could not resolve, an introducer or a tag that cannot
 * be found again, or a vocabulary that did not load leaves the editor closed
 * and says so, and a failed search blocks saving rather than dropping a
 * choice.
 */

import {
  listPeople,
  listPeopleTagOptions,
  listProfileFacts,
  type ProfileFactOption,
  type ProfileFactRecord,
  type ProfileFactSectionId,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { settle } from "../../../islands/core/index.ts";
import type { OptionSearchLabels } from "./fact-form.tsx";

/** One page of choices; `next` continues it. */
export interface LookupPage {
  readonly options: readonly ProfileFactOption[];
  readonly next?: string | undefined;
}

export interface LookupRequest {
  readonly search?: string | undefined;
  readonly cursor?: string | undefined;
  /**
   * The choice an existing record already holds, which the first page must
   * find again (the introducer).
   */
  readonly selected?: string | undefined;
}

/** Who and what a lookup asks about. */
export interface LookupContext {
  readonly personId: string;
  readonly section: ProfileFactSectionId;
  readonly workspaceId: string;
}

export interface FactLookup {
  readonly labels: OptionSearchLabels;
  /**
   * The kind of option each choice field offers, by field name; `undefined`
   * offers every option the lookup loads.
   */
  readonly fields: Readonly<
    Record<string, ProfileFactOption["kind"] | undefined>
  >;
  /** Loads one page, or answers `undefined` when none came back. */
  readonly page: (
    context: LookupContext,
    request: LookupRequest,
  ) => Promise<LookupPage | undefined>;
  /**
   * Checks what the editor about to open on `record` already holds, given
   * the options the section knows; answers why it cannot open, if it cannot.
   */
  readonly refuse?: (
    record: ProfileFactRecord | undefined,
    known: ReadonlyMap<string, ProfileFactOption>,
  ) => string | undefined;
  /** The choice the first page must find again, if any. */
  readonly selected?: (record: ProfileFactRecord | undefined) =>
    | string
    | undefined;
  /** What the status line says when the first page fails. */
  readonly unverified: string;
  /** What the status line says when a search or a later page fails. */
  readonly unavailable: string;
}

const OPTIONS_UNAVAILABLE =
  "Profile options are temporarily unavailable. No changes were saved.";

/**
 * Choices from the section's own vocabulary, which the fact read answers
 * with when asked to include options.
 */
export function profileOptionLookup(
  labels: { readonly label: string; readonly more: string },
  fields: Readonly<Record<string, ProfileFactOption["kind"]>>,
): FactLookup {
  return {
    fields,
    labels: {
      ...labels,
      markers: { more: "profile-option-more", search: "profile-option-search" },
      name: "profileOptionSearch",
    },
    page: async (context, request) => {
      const answer = await settle(() =>
        listProfileFacts(context.personId, context.section, {
          includeOptions: true,
          ...(request.cursor ? { optionCursor: request.cursor } : {}),
          ...(request.search ? { optionSearch: request.search } : {}),
        }, context.workspaceId)
      );
      return answer.data
        ? { next: answer.data.nextOptionsCursor, options: answer.data.options }
        : undefined;
    },
    refuse: (record) =>
      record?.referencesResolved === false
        ? "Current profile references could not be verified. No changes were saved."
        : undefined,
    unavailable: OPTIONS_UNAVAILABLE,
    unverified: OPTIONS_UNAVAILABLE,
  };
}

const INTRODUCER_UNVERIFIED =
  "Current introducer could not be verified. No changes were saved.";

/**
 * People who might have made the introduction: the directory, without the
 * person themselves. The first page also finds the introducer already saved,
 * wherever the directory lists them.
 */
export const introducerLookup: FactLookup = {
  fields: { introducedByPersonId: undefined },
  labels: {
    label: "Search people",
    markers: { more: "people-more", search: "people-search" },
    more: "Load more people",
    name: "introducedBySearch",
  },
  page: async (context, request) => {
    const answer = await settle(() =>
      listPeople({
        ...(request.cursor ? { cursor: request.cursor } : {}),
        excludePersonId: context.personId,
        limit: 20,
        ...(request.search ? { search: request.search } : {}),
        ...(request.selected ? { selectedPersonId: request.selected } : {}),
      }, context.workspaceId)
    );
    const found = answer.data;
    if (!found) return undefined;
    if (
      request.selected &&
      (found.selected?.id !== request.selected ||
        request.selected === context.personId)
    ) return undefined;
    return {
      next: found.nextCursor,
      options: [
        ...(found.selected ? [found.selected] : []),
        ...found.people,
      ].filter((person) => person.id !== context.personId).map((person) => ({
        id: person.id,
        name: [person.givenName, person.familyName].filter(Boolean).join(" "),
      })),
    };
  },
  selected: (record) =>
    record?.section === "first-meeting"
      ? record.value.introducedByPersonId
      : undefined,
  unavailable: INTRODUCER_UNVERIFIED,
  unverified: INTRODUCER_UNVERIFIED,
};

const TAGS_UNVERIFIED =
  "Current tag assignments could not be verified. No assignments can be changed.";

/** The workspace's tags. An assignment naming a tag no answer found is kept. */
export const tagLookup: FactLookup = {
  fields: { tagIds: undefined },
  labels: {
    label: "Search tags",
    markers: { more: "tag-more", search: "tag-search" },
    more: "Load more tags",
    name: "tagSearch",
  },
  page: async (context, request) => {
    const answer = await settle(() =>
      listPeopleTagOptions({
        ...(request.cursor ? { cursor: request.cursor } : {}),
        ...(request.search ? { search: request.search } : {}),
      }, context.workspaceId)
    );
    return answer.data
      ? { next: answer.data.nextCursor, options: answer.data.options }
      : undefined;
  },
  refuse: (record, known) =>
    record?.section === "tags" &&
      record.value.tagIds.some((id) => !known.has(id))
      ? TAGS_UNVERIFIED
      : undefined,
  unavailable:
    "Tag options are temporarily unavailable. No assignments can be changed.",
  unverified: TAGS_UNVERIFIED,
};
