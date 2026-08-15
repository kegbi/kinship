export interface PeopleDirectoryActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export type PeopleDirectoryLifecycle = "active" | "archived";
export type PeopleDirectorySort =
  | "family-name"
  | "given-name"
  | "recently-added";

export const PEOPLE_DIRECTORY_TAG_PREVIEW_LIMIT = 5;

export interface PeopleDirectoryTag {
  readonly id: string;
  readonly name: string;
}

export interface PeopleDirectoryPerson {
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

export interface ListPeopleInput {
  readonly cursor?: string;
  readonly lifecycle?: PeopleDirectoryLifecycle;
  readonly limit?: number;
  readonly search?: string;
  readonly sort?: PeopleDirectorySort;
  readonly tagId?: string;
}

export interface PeopleDirectoryCursor {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
}

export interface PeopleDirectoryPersonRecord extends PeopleDirectoryPerson {
  readonly cursor: PeopleDirectoryCursor;
}

export interface PeopleDirectoryCriteria {
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly limit: number;
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly tagId?: string;
}

export type PeopleDirectoryRepositoryResult =
  | { readonly status: "forbidden" }
  | { readonly status: "stale-cursor" }
  | {
    readonly people: readonly PeopleDirectoryPersonRecord[];
    readonly status: "ready";
  };

export interface PeopleDirectoryRepository {
  list(
    command: PeopleDirectoryActor & PeopleDirectoryCriteria & {
      readonly after?: PeopleDirectoryCursor;
    },
  ): Promise<PeopleDirectoryRepositoryResult>;
}

export type ListPeopleResult =
  | { readonly status: "forbidden" }
  | { readonly status: "stale-cursor" }
  | {
    readonly nextCursor?: string;
    readonly people: readonly PeopleDirectoryPerson[];
    readonly status: "ready";
  };

interface EncodedCursor extends PeopleDirectoryCursor {
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly tagId: string | null;
  readonly version: 1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalize(input: ListPeopleInput): PeopleDirectoryCriteria {
  const search = input.search?.trim().slice(0, 200) ?? "";
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20)));
  return {
    lifecycle: input.lifecycle ?? "active",
    limit: Number.isFinite(limit) ? limit : 20,
    search,
    sort: input.sort ?? "given-name",
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
      cursor.version !== 1 ||
      !UUID_PATTERN.test(cursor.id ?? "") ||
      typeof cursor.primary !== "string" ||
      typeof cursor.secondary !== "string" ||
      (cursor.lifecycle !== "active" && cursor.lifecycle !== "archived") ||
      typeof cursor.search !== "string" ||
      (cursor.sort !== "family-name" && cursor.sort !== "given-name" &&
        cursor.sort !== "recently-added") ||
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
    cursor.search === criteria.search && cursor.sort === criteria.sort &&
    cursor.tagId === (criteria.tagId ?? null);
}

function encodeCursor(
  record: PeopleDirectoryPersonRecord,
  criteria: PeopleDirectoryCriteria,
): string {
  return base64UrlEncode(JSON.stringify(
    {
      ...record.cursor,
      lifecycle: criteria.lifecycle,
      search: criteria.search,
      sort: criteria.sort,
      tagId: criteria.tagId ?? null,
      version: 1,
    } satisfies EncodedCursor,
  ));
}

function person(record: PeopleDirectoryPersonRecord): PeopleDirectoryPerson {
  return {
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

export function createPeopleDirectory(dependencies: {
  readonly repository: PeopleDirectoryRepository;
}) {
  return {
    list: async (
      actor: PeopleDirectoryActor,
      input: ListPeopleInput,
    ): Promise<ListPeopleResult> => {
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
            },
          }
          : {}),
      });
      if (result.status !== "ready") return result;
      const hasMore = result.people.length > criteria.limit;
      const page = result.people.slice(0, criteria.limit);
      const final = page.at(-1);
      return {
        ...(hasMore && final
          ? { nextCursor: encodeCursor(final, criteria) }
          : {}),
        people: page.map(person),
        status: "ready",
      };
    },
  };
}

export type PeopleDirectory = ReturnType<typeof createPeopleDirectory>;
