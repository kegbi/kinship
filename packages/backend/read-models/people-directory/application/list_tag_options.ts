import type { Failure } from "../../../shared-kernel/result.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}
import type {
  PeopleDirectoryActor,
  PeopleDirectoryTag,
} from "./list_people.ts";

export const PEOPLE_TAG_OPTION_PAGE_SIZE = 20;

export interface ListPeopleTagOptionsInput {
  readonly cursor?: string;
  readonly search?: string;
  readonly selectedTagId?: string;
}

export interface PeopleTagOptionCursor {
  readonly id: string;
  readonly primary: string;
}

export interface PeopleTagOptionRecord extends PeopleDirectoryTag {
  readonly cursor: PeopleTagOptionCursor;
}

export interface PeopleTagOptionsCriteria {
  readonly limit: typeof PEOPLE_TAG_OPTION_PAGE_SIZE;
  readonly search: string;
}

export type PeopleTagOptionsRepositoryResult =
  | Failure<"forbidden">
  | {
    readonly options: readonly PeopleTagOptionRecord[];
    readonly selected?: PeopleDirectoryTag;
    readonly status: "ready";
  };

export interface PeopleTagOptionsRepository {
  listTagOptions(
    command: PeopleDirectoryActor & PeopleTagOptionsCriteria & {
      readonly after?: PeopleTagOptionCursor;
      readonly selectedTagId?: string;
    },
  ): Promise<PeopleTagOptionsRepositoryResult>;
}

export type ListPeopleTagOptionsResult =
  | Failure<"forbidden">
  | { readonly status: "invalid-input" }
  | {
    readonly nextCursor?: string;
    readonly options: readonly PeopleDirectoryTag[];
    readonly selected?: PeopleDirectoryTag;
    readonly status: "ready";
  };

interface EncodedTagCursor extends PeopleTagOptionCursor {
  readonly search: string;
  readonly version: 1;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSearch(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 200).toLowerCase() ?? "";
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

function decodeCursor(value: string): EncodedTagCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(value));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const cursor = parsed as Partial<EncodedTagCursor>;
    if (
      cursor.version !== 1 || !UUID_PATTERN.test(cursor.id ?? "") ||
      typeof cursor.primary !== "string" || typeof cursor.search !== "string"
    ) {
      return undefined;
    }
    return cursor as EncodedTagCursor;
  } catch {
    return undefined;
  }
}

function encodeCursor(
  record: PeopleTagOptionRecord,
  search: string,
): string {
  return base64UrlEncode(JSON.stringify(
    {
      ...record.cursor,
      search,
      version: 1,
    } satisfies EncodedTagCursor,
  ));
}

function option(record: PeopleTagOptionRecord): PeopleDirectoryTag {
  return { id: record.id, name: record.name };
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createPeopleTagOptions(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly repository: PeopleTagOptionsRepository;
}) {
  const readable = async (actor: PeopleDirectoryActor): Promise<boolean> =>
    await dependencies.transaction.run((transaction) =>
      dependencies.actors.revalidate({ ...actor, lock: false, transaction })
    ) === "active";

  return {
    list: async (
      actor: PeopleDirectoryActor,
      input: ListPeopleTagOptionsInput,
    ): Promise<ListPeopleTagOptionsResult> => {
      if (!await readable(actor)) return { status: "forbidden" };
      const search = normalizeSearch(input.search);
      if (
        input.selectedTagId && !UUID_PATTERN.test(input.selectedTagId)
      ) {
        return { status: "invalid-input" };
      }
      const decoded = input.cursor ? decodeCursor(input.cursor) : undefined;
      if (input.cursor && (!decoded || decoded.search !== search)) {
        return { status: "invalid-input" };
      }
      const result = await dependencies.repository.listTagOptions({
        ...actor,
        limit: PEOPLE_TAG_OPTION_PAGE_SIZE,
        search,
        ...(decoded
          ? { after: { id: decoded.id, primary: decoded.primary } }
          : {}),
        ...(input.selectedTagId ? { selectedTagId: input.selectedTagId } : {}),
      });
      if (result.status !== "ready") return result;
      const hasMore = result.options.length > PEOPLE_TAG_OPTION_PAGE_SIZE;
      const page = result.options.slice(0, PEOPLE_TAG_OPTION_PAGE_SIZE);
      const final = page.at(-1);
      return {
        ...(hasMore && final
          ? { nextCursor: encodeCursor(final, search) }
          : {}),
        options: page.map(option),
        ...(result.selected ? { selected: result.selected } : {}),
        status: "ready",
      };
    },
  };
}

export type PeopleTagOptions = ReturnType<typeof createPeopleTagOptions>;
