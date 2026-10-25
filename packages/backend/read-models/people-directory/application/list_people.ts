import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";
import type { PersonAvatarRecord } from "../../../modules/people/public.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

export interface PeopleDirectoryActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export type PeopleDirectoryLifecycle = "active" | "archived";
/**
 * The directory's orders. GAP-053 (`PEOPLE-010`) adds `last-contacted`, the
 * newest call or conversation first with never-contacted people last, and
 * `recently-updated`, the person record changed most recently first.
 */
export type PeopleDirectorySort =
  | "family-name"
  | "given-name"
  | "last-contacted"
  | "recently-added"
  | "recently-updated";

const SORTS: ReadonlySet<string> = new Set<PeopleDirectorySort>([
  "family-name",
  "given-name",
  "last-contacted",
  "recently-added",
  "recently-updated",
]);

export const PEOPLE_DIRECTORY_TAG_PREVIEW_LIMIT = 5;

export interface PeopleDirectoryTag {
  readonly id: string;
  readonly name: string;
}

export interface PeopleDirectoryPerson {
  /** The stored colour, and the image file only while it can be drawn. */
  readonly avatar?: PersonAvatarRecord;
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly tagCount: number;
  readonly tags: readonly PeopleDirectoryTag[];
}

/**
 * One `replace(text, from, to)` of the name fold, applied in order to the
 * lowercased name (`SEARCH-001`). The transport supplies the steps; the
 * repository only repeats them, so the rules have one home.
 */
export type PeopleDirectoryNameFoldStep = readonly [from: string, to: string];

export interface ListPeopleInput {
  readonly cursor?: string;
  readonly excludePersonId?: string;
  readonly lifecycle?: PeopleDirectoryLifecycle;
  readonly limit?: number;
  /** How names are folded before `nameForms` is matched. */
  readonly nameFold?: readonly PeopleDirectoryNameFoldStep[];
  /**
   * The search's folded spellings across scripts and keyboard layouts that a
   * name may contain, beside the search as typed. They follow from `search`,
   * so a cursor need not carry them.
   */
  readonly nameForms?: readonly string[];
  readonly search?: string;
  readonly selectedPersonId?: string;
  readonly sort?: PeopleDirectorySort;
  /** Only starred people (GAP-053). */
  readonly starred?: boolean;
  /** Starred people before everybody else, each group in the sort. */
  readonly starredFirst?: boolean;
  readonly tagId?: string;
}

/**
 * Where a page ended: the last person's sort keys, their id, and whether
 * they are starred, which orders the page first when starred people lead.
 */
export interface PeopleDirectoryCursor {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
  /** Whether that person is starred; a record that omits it is not. */
  readonly starred?: boolean;
}

export interface PeopleDirectoryPersonRecord extends PeopleDirectoryPerson {
  readonly cursor: PeopleDirectoryCursor;
}

export interface PeopleDirectoryCriteria {
  readonly excludePersonId?: string;
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly limit: number;
  readonly nameFold: readonly PeopleDirectoryNameFoldStep[];
  readonly nameForms: readonly string[];
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly starred: boolean;
  readonly starredFirst: boolean;
  readonly tagId?: string;
}

export type PeopleDirectoryRepositoryResult =
  | Failure<"forbidden">
  | { readonly status: "stale-cursor" }
  | {
    readonly people: readonly PeopleDirectoryPersonRecord[];
    readonly status: "ready";
  };

export interface PeopleDirectoryRepository {
  findSelected?(
    command: PeopleDirectoryActor & {
      readonly lifecycle: PeopleDirectoryLifecycle;
      readonly personId: string;
    },
  ): Promise<PeopleDirectoryPersonRecord | undefined>;
  list(
    command: PeopleDirectoryActor & PeopleDirectoryCriteria & {
      readonly after?: PeopleDirectoryCursor;
    },
  ): Promise<PeopleDirectoryRepositoryResult>;
}

export type ListPeopleResult =
  | Failure<"forbidden">
  | { readonly status: "stale-cursor" }
  | {
    readonly nextCursor?: string;
    readonly people: readonly PeopleDirectoryPerson[];
    readonly selected?: PeopleDirectoryPerson;
    readonly status: "ready";
  };

interface EncodedCursor extends Required<PeopleDirectoryCursor> {
  readonly excludePersonId: string | null;
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly starredOnly: boolean;
  readonly starredFirst: boolean;
  readonly tagId: string | null;
  /** 2 since GAP-053 added the starred criteria; a 1 is stale. */
  readonly version: 2;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalize(input: ListPeopleInput): PeopleDirectoryCriteria {
  const search = input.search?.trim().slice(0, 200) ?? "";
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
  return {
    ...(input.excludePersonId
      ? { excludePersonId: input.excludePersonId }
      : {}),
    lifecycle: input.lifecycle ?? "active",
    limit: Number.isFinite(limit) ? limit : 20,
    nameFold: search ? input.nameFold ?? [] : [],
    nameForms: search ? input.nameForms ?? [] : [],
    search,
    sort: input.sort ?? "given-name",
    starred: input.starred ?? false,
    starredFirst: input.starredFirst ?? false,
    ...(input.tagId ? { tagId: input.tagId } : {}),
  };
}

function base64UrlEncode(value: string): string {
  const binary = Array.from(
    new TextEncoder().encode(value),
    (byte) => String.fromCharCode(byte),
  ).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function base64UrlDecode(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + (4 - normalized.length % 4) % 4,
    "=",
  );
  const bytes = Uint8Array.from(
    atob(padded),
    (character) => character.charCodeAt(0),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function decodeCursor(value: string): EncodedCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const cursor = parsed as Partial<EncodedCursor>;
    if (
      cursor.version !== 2 ||
      (cursor.excludePersonId !== null &&
        !UUID_PATTERN.test(cursor.excludePersonId ?? "")) ||
      !UUID_PATTERN.test(cursor.id ?? "") ||
      typeof cursor.primary !== "string" ||
      typeof cursor.secondary !== "string" ||
      typeof cursor.starred !== "boolean" ||
      typeof cursor.starredOnly !== "boolean" ||
      typeof cursor.starredFirst !== "boolean" ||
      (cursor.lifecycle !== "active" && cursor.lifecycle !== "archived") ||
      typeof cursor.search !== "string" ||
      typeof cursor.sort !== "string" || !SORTS.has(cursor.sort) ||
      (cursor.tagId !== null && !UUID_PATTERN.test(cursor.tagId ?? ""))
    ) {
      return undefined;
    }
    return cursor as EncodedCursor;
  } catch {
    return undefined;
  }
}

function cursorMatches(
  cursor: EncodedCursor,
  criteria: PeopleDirectoryCriteria,
): boolean {
  return cursor.lifecycle === criteria.lifecycle &&
    cursor.excludePersonId === (criteria.excludePersonId ?? null) &&
    cursor.search === criteria.search && cursor.sort === criteria.sort &&
    cursor.starredOnly === criteria.starred &&
    cursor.starredFirst === criteria.starredFirst &&
    cursor.tagId === (criteria.tagId ?? null);
}

function encodeCursor(
  record: PeopleDirectoryPersonRecord,
  criteria: PeopleDirectoryCriteria,
): string {
  return base64UrlEncode(JSON.stringify(
    {
      ...record.cursor,
      starred: record.cursor.starred ?? false,
      excludePersonId: criteria.excludePersonId ?? null,
      lifecycle: criteria.lifecycle,
      search: criteria.search,
      sort: criteria.sort,
      starredFirst: criteria.starredFirst,
      starredOnly: criteria.starred,
      tagId: criteria.tagId ?? null,
      version: 2,
    } satisfies EncodedCursor,
  ));
}

function person(record: PeopleDirectoryPersonRecord): PeopleDirectoryPerson {
  return {
    ...(record.avatar ? { avatar: record.avatar } : {}),
    ...(record.familyName ? { familyName: record.familyName } : {}),
    givenName: record.givenName,
    id: record.id,
    isPartial: record.isPartial,
    isStarred: record.isStarred,
    lifecycle: record.lifecycle,
    ...(record.middleName ? { middleName: record.middleName } : {}),
    ...(record.nickname ? { nickname: record.nickname } : {}),
    tagCount: record.tagCount,
    tags: record.tags.slice(0, PEOPLE_DIRECTORY_TAG_PREVIEW_LIMIT),
  };
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createPeopleDirectory(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly repository: PeopleDirectoryRepository;
}) {
  const readable = async (actor: PeopleDirectoryActor): Promise<boolean> =>
    await dependencies.transaction.run((transaction) =>
      dependencies.actors.revalidate({ ...actor, lock: false, transaction })
    ) === "active";

  return {
    list: async (
      actor: PeopleDirectoryActor,
      input: ListPeopleInput,
    ): Promise<ListPeopleResult> => {
      if (!await readable(actor)) return { status: "forbidden" };
      const criteria = normalize(input);
      const decoded = input.cursor ? decodeCursor(input.cursor) : undefined;
      if (input.cursor && (!decoded || !cursorMatches(decoded, criteria))) {
        return { status: "stale-cursor" };
      }
      const result = await dependencies.repository.list({
        ...actor,
        ...criteria,
        ...(decoded
          ? {
            after: {
              id: decoded.id,
              primary: decoded.primary,
              secondary: decoded.secondary,
              starred: decoded.starred,
            },
          }
          : {}),
      });
      if (result.status !== "ready") return result;
      const selected = input.selectedPersonId &&
          input.selectedPersonId !== input.excludePersonId &&
          dependencies.repository.findSelected
        ? await dependencies.repository.findSelected({
          ...actor,
          lifecycle: criteria.lifecycle,
          personId: input.selectedPersonId,
        })
        : undefined;
      const hasMore = result.people.length > criteria.limit;
      const page = result.people.slice(0, criteria.limit);
      const final = page.at(-1);
      return {
        ...(hasMore && final
          ? { nextCursor: encodeCursor(final, criteria) }
          : {}),
        people: page.map(person),
        ...(selected ? { selected: person(selected) } : {}),
        status: "ready",
      };
    },
  };
}

export type PeopleDirectory = ReturnType<typeof createPeopleDirectory>;
