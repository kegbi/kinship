import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { isUuid } from "../../../shared-kernel/validation.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

export interface ActivityReportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ActivityReportParticipant {
  readonly id: string;
  readonly name: string;
}

export type ActivityReportKind = "activity" | "note";

export type ActivityReportItem =
  | {
    readonly activityType?: string;
    readonly description?: string;
    readonly emotions: readonly {
      readonly id: string;
      readonly name: string;
    }[];
    readonly happenedAt: string;
    readonly id: string;
    readonly kind: "activity";
    readonly participants: readonly ActivityReportParticipant[];
    readonly summary: string;
    /** The revision an edit or a removal names (MCP-D1). */
    readonly updatedAt?: string;
  }
  | {
    readonly body: string;
    readonly createdAt: string;
    readonly id: string;
    readonly isFavorited: boolean;
    readonly kind: "note";
    readonly participants: readonly [ActivityReportParticipant];
    /** The revision an edit or a removal names (MCP-D1). */
    readonly updatedAt?: string;
  };

export interface ActivityReportRepository {
  list(
    command: ActivityReportActor & {
      readonly after?: {
        readonly id: string;
        readonly timestamp: string;
      };
      readonly kind?: ActivityReportKind;
      readonly limit: number;
      readonly personId: string;
      readonly year?: number;
    },
  ): Promise<
    | {
      readonly items: readonly ActivityReportItem[];
      readonly next?: { readonly id: string; readonly timestamp: string };
      readonly person: ActivityReportParticipant;
      readonly status: "archived" | "ready";
    }
    | Failure<"forbidden" | "not-found", "stale-cursor">
  >;
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createActivityReport(dependencies: {
  readonly actors: ActorRevalidation;
  readonly repository: ActivityReportRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
}) {
  const readable = async (actor: ActivityReportActor): Promise<boolean> =>
    await actorMayRead(dependencies, actor);

  return {
    list: async (
      actor: ActivityReportActor,
      personId: string,
      input: {
        readonly cursor?: string;
        readonly kind?: ActivityReportKind;
        readonly limit?: number;
        readonly year?: number;
      } = {},
    ) => {
      const year = input.year;
      let after:
        | { readonly id: string; readonly timestamp: string }
        | undefined;
      if (input.cursor) {
        try {
          const decoded = JSON.parse(
            atob(input.cursor.replaceAll("-", "+").replaceAll("_", "/")),
          ) as Record<string, unknown>;
          if (
            decoded.version !== 1 ||
            decoded.workspaceId !== actor.workspaceId ||
            decoded.personId !== personId ||
            decoded.kind !== (input.kind ?? null) ||
            decoded.year !== (year ?? null) ||
            typeof decoded.id !== "string" || !isUuid(decoded.id) ||
            typeof decoded.timestamp !== "string" ||
            !Number.isFinite(Date.parse(decoded.timestamp))
          ) return { status: "stale-cursor" as const };
          after = { id: decoded.id, timestamp: decoded.timestamp };
        } catch {
          return { status: "stale-cursor" as const };
        }
      }
      if (!await readable(actor)) return { status: "forbidden" as const };
      const result = await dependencies.repository.list({
        ...actor,
        ...(after ? { after } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        limit: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
        personId,
        ...(year ? { year } : {}),
      });
      if (!("items" in result)) return { status: result.status };
      return {
        items: result.items,
        ...(result.next
          ? {
            nextCursor: btoa(JSON.stringify({
              ...result.next,
              kind: input.kind ?? null,
              personId,
              version: 1,
              workspaceId: actor.workspaceId,
              year: year ?? null,
            })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
          }
          : {}),
        person: result.person,
        status: result.status,
      };
    },
  };
}

export type ActivityReport = ReturnType<typeof createActivityReport>;
