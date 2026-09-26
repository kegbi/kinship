/**
 * What a profile fact section shows, as pure functions of its records
 * (GAP-029).
 *
 * The rules are the ones `lib/profile-facts.ts` carried before the seven fact
 * sections became islands: how a record reads in its row and in the
 * accessible names of its controls, which details sit under it, which row a
 * collapsed block keeps in view, and what the status line and the rail's
 * count chip say about a page of records.
 */

import type {
  ProfileFactOption,
  ProfileFactRecord,
  ProfileFactSectionId,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

/** A record of one section, narrowed by its `section`. */
export type FactRecord<Section extends ProfileFactSectionId> = Extract<
  ProfileFactRecord,
  { readonly section: Section }
>;

/** The options of several answers, each id once, the latest name winning. */
export function mergeOptions(
  ...groups: readonly (readonly ProfileFactOption[])[]
): readonly ProfileFactOption[] {
  return [
    ...new Map(groups.flat().map((option) => [option.id, option])).values(),
  ];
}

/** The option `id` names, when the section knows it. */
export function optionName(
  options: readonly ProfileFactOption[],
  id: string | undefined,
): string | undefined {
  return id === undefined
    ? undefined
    : options.find((option) => option.id === id)?.name;
}

/**
 * One line that names a record: its row's summary and the context the edit
 * and delete controls announce after their verb.
 */
export function factSummary(
  record: ProfileFactRecord,
  options: readonly ProfileFactOption[],
): string {
  switch (record.section) {
    case "contact-methods":
      return `${optionName(options, record.value.typeId) ?? "Contact"}: ${
        record.value.value ?? ""
      }`;
    case "addresses":
      return [
        record.value.displayName,
        record.value.street,
        record.value.city,
        record.value.country,
      ].filter(Boolean).join(", ");
    case "first-meeting":
      return [record.value.placeText, record.value.notes].filter(Boolean)
        .join(" — ") || "No first-meeting context saved";
    case "work":
      return [record.value.title, record.value.organizationName].filter(
        Boolean,
      ).join(" at ");
    case "food-preferences":
      return record.value.foodPreferences ?? "No food preferences saved";
    case "pets":
      return [record.value.name, optionName(options, record.value.categoryId)]
        .filter(Boolean).join(" · ");
    case "tags":
      return "Tag assignments";
  }
}

/**
 * An address as up to three lines: its name (or its first label), its
 * street, and its locality.
 */
export function addressLines(
  record: FactRecord<"addresses">,
  options: readonly ProfileFactOption[],
): readonly string[] {
  const label = record.value.displayName ??
    options.find((option) => record.value.labelIds.includes(option.id))?.name;
  const locality = [
    record.value.city,
    record.value.region,
    record.value.postalCode,
    record.value.country,
  ].filter(Boolean).join(", ");
  return [label, record.value.street, locality].filter(
    (line): line is string => Boolean(line),
  );
}

/**
 * The work role the collapsed block keeps in view: the most recently started
 * role that has not ended, or else the most recently ended one, ties going to
 * the lower id so the choice never flickers between reads.
 */
export function workSummaryRecord(
  records: readonly ProfileFactRecord[],
): FactRecord<"work"> | undefined {
  const work = records.filter((record): record is FactRecord<"work"> =>
    record.section === "work"
  );
  const current = work.filter((record) => record.value.endOn === undefined);
  const candidates = current.length > 0 ? current : work;
  const date = (record: FactRecord<"work">) =>
    (current.length > 0 ? record.value.startOn : record.value.endOn) ?? "";
  return [...candidates].sort((left, right) => {
    const leftDate = date(left);
    const rightDate = date(right);
    if (leftDate !== rightDate) return leftDate > rightDate ? -1 : 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  })[0];
}

/** One row of the details under a record; `href` makes its value a link. */
export interface FactDetail {
  readonly label: string;
  readonly value: string;
  readonly href?: string;
}

function calendarDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

/** The details a record shows under its summary, in reading order. */
export function factDetails(
  record: ProfileFactRecord,
  options: readonly ProfileFactOption[],
): readonly FactDetail[] {
  const rows: FactDetail[] = [];
  const add = (label: string, value: string | undefined, href?: string) => {
    if (value) rows.push(href ? { href, label, value } : { label, value });
  };
  switch (record.section) {
    case "work":
      if (record.value.startOn) {
        add("Started", calendarDate(record.value.startOn));
      }
      if (record.value.endOn) add("Ended", calendarDate(record.value.endOn));
      add("Current role", record.value.isCurrent ? "Yes" : "No");
      add("Details", record.value.description);
      break;
    case "pets":
      add("Notes", record.value.notes);
      break;
    case "contact-methods":
    case "addresses":
      add(
        "Labels",
        record.value.labelIds.map((id) => optionName(options, id)).filter(
          Boolean,
        ).join(", "),
      );
      add("Primary", record.value.isPrimary ? "Yes" : "No");
      if (record.section === "contact-methods") {
        add("Notes", record.value.notes);
      }
      break;
    case "first-meeting":
      if (record.value.introducedByPersonId) {
        add(
          "Introduced by",
          "View person",
          `/app/people/${record.value.introducedByPersonId}`,
        );
      }
      break;
  }
  return rows;
}

/** The names of a tag assignment's tags, an unknown one said to be so. */
export function tagNames(
  record: FactRecord<"tags">,
  options: readonly ProfileFactOption[],
): readonly string[] {
  return record.value.tagIds.map((id) =>
    optionName(options, id) ?? "Unavailable tag"
  );
}

/**
 * Whether `candidate` is a later person revision than `current`. Only the
 * canonical microsecond form the API answers with is trusted, so a stale or
 * malformed answer can never move a section's revision backwards.
 */
export function isLaterRevision(candidate: string, current: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(candidate) &&
    candidate > current;
}

/** A loaded page of a section's records. */
export interface FactPage {
  readonly records: readonly ProfileFactRecord[];
  readonly options: readonly ProfileFactOption[];
  readonly nextCursor?: string | undefined;
  /** True when the read answered the section as read-only. */
  readonly archived: boolean;
  /** The page's index and the cursor that reached each page so far. */
  readonly index: number;
  readonly cursors: readonly (string | undefined)[];
  /** The profile summary's count, kept until the section is read again. */
  readonly total?: number | undefined;
}

/** What one page of a section's records says about the whole list. */
export interface PageShape {
  readonly count: number;
  /** True when the records continue on another page, before or after. */
  readonly paged: boolean;
  /** How many records there are in all, when that is known. */
  readonly total?: number | undefined;
}

/** How a page's records describe the whole list. */
export function pageShape(page: FactPage): PageShape {
  const paged = page.index > 0 || page.nextCursor !== undefined;
  return {
    count: page.records.length,
    paged,
    total: paged ? page.total : page.records.length,
  };
}

/** The status line a section shows over a page of its records. */
export function pageSummary(noun: string, shape: PageShape): string {
  if (shape.paged) {
    return shape.total === undefined
      ? `Showing ${shape.count} on this page.`
      : `Showing ${shape.count} of ${shape.total} saved.`;
  }
  return shape.count ? `${shape.count} saved.` : `No ${noun} saved.`;
}

/** Text a field holds, or `undefined` when it holds only white space. */
export function filled(value: string | undefined): string | undefined {
  return value?.trim() ? value : undefined;
}

/** The status line of a tag assignment: how many tags it holds. */
export function tagSummary(count: number): string {
  return count
    ? `${count} tag${count === 1 ? "" : "s"} saved.`
    : "No tags saved.";
}

/** The rail's count chip and collapsed state for a page of records. */
export function railPresentation(shape: PageShape): {
  readonly count: number;
  readonly scope: "total" | "page";
  readonly empty: boolean;
} {
  return {
    count: shape.total ?? shape.count,
    empty: !shape.paged && shape.count === 0,
    scope: shape.total === undefined && shape.paged ? "page" : "total",
  };
}
