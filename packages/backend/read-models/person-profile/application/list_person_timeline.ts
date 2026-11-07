import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  PersonLifeEventPrecision,
  PersonProfileActor,
  ReadModelTransaction,
} from "./get_person_profile.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type {
  InteractionOption,
  InteractionParticipant,
} from "../../../modules/interactions/public.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-58][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PersonTimelineKind =
  | "activity"
  | "call"
  | "conversation"
  | "life-event"
  | "note";

export interface PersonTimelineMessage {
  readonly content: string;
  readonly direction: "inbound" | "outbound";
  readonly writtenAt: string;
}

export interface PersonTimelineItem {
  readonly calendarDate?: {
    readonly year?: number;
    readonly month?: number;
    readonly day?: number;
  };
  readonly activityType?: string;
  readonly channelType?: string;
  readonly contactMethod?: string;
  readonly contactWasCaller?: boolean;
  readonly datePrecision: PersonLifeEventPrecision;
  readonly emotions?: readonly InteractionOption[];
  readonly excerpt?: string;
  readonly id: string;
  readonly kind: PersonTimelineKind;
  readonly messages?: readonly PersonTimelineMessage[];
  readonly occurredAt: string;
  readonly participants?: readonly InteractionParticipant[];
  readonly title?: string;
}

export interface PersonTimelineRepository {
  listTimeline(
    command: PersonProfileActor & {
      readonly after?: {
        readonly id: string;
        readonly timestamp: string;
      };
      readonly kind?: PersonTimelineKind;
      readonly limit: number;
      readonly personId: string;
    },
  ): Promise<
    | {
      readonly items: readonly PersonTimelineItem[];
      readonly next?: { readonly id: string; readonly timestamp: string };
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
export function createPersonTimeline(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
  readonly repository: PersonTimelineRepository;
}) {
  const readable = async (actor: PersonProfileActor): Promise<boolean> =>
    await actorMayRead(dependencies, actor);

  return {
    listTimeline: async (
      actor: PersonProfileActor,
      personId: string,
      input: {
        readonly cursor?: string;
        readonly kind?: PersonTimelineKind;
        readonly limit?: number;
      } = {},
    ) => {
      if (!await readable(actor)) return { status: "forbidden" as const };
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
            typeof decoded.id !== "string" || !UUID_PATTERN.test(decoded.id) ||
            typeof decoded.timestamp !== "string" ||
            !Number.isFinite(Date.parse(decoded.timestamp))
          ) return { status: "stale-cursor" as const };
          after = { id: decoded.id, timestamp: decoded.timestamp };
        } catch {
          return { status: "stale-cursor" as const };
        }
      }
      const result = await dependencies.repository.listTimeline({
        ...actor,
        ...(after ? { after } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
        limit: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
        personId,
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
            })).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
              "=",
              "",
            ),
          }
          : {}),
        status: result.status,
      };
    },
  };
}

export type PersonTimeline = ReturnType<typeof createPersonTimeline>;
