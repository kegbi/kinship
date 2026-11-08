import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor } from "../../../modules/people/public.ts";
import {
  actorMayRead,
  type ActorRevalidation,
} from "../../../modules/workspaces/public.ts";
import type { ReadModelTransaction } from "./get_today_interactions.ts";

export interface TodayRecentPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

export interface TodayRecentPeopleRepository {
  list(
    command: PeopleActor & { readonly limit: number },
  ): Promise<
    | Failure<"forbidden">
    | {
      readonly people: readonly TodayRecentPerson[];
      readonly status: "ready";
    }
  >;
}

/**
 * Read models carry no actor join of their own. The `workspaces` port answers
 * whether the actor may still read this workspace — without a lock, because
 * these paths take none — and the repository scopes by workspace alone.
 */
export function createTodayRecentPeople(dependencies: {
  readonly actors: ActorRevalidation;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
      scope?: TransactionScope,
    ): Promise<T>;
  };
  readonly repository: TodayRecentPeopleRepository;
}) {
  const readable = async (
    actor: {
      readonly memberId: string;
      readonly role: "admin" | "member" | "owner";
      readonly userId: string;
      readonly workspaceId: string;
    },
  ): Promise<boolean> => await actorMayRead(dependencies, actor);

  return {
    get: async (actor: PeopleActor) =>
      await readable(actor)
        ? await dependencies.repository.list({ ...actor, limit: 8 })
        : { status: "forbidden" as const },
  };
}

export type TodayRecentPeople = ReturnType<typeof createTodayRecentPeople>;
