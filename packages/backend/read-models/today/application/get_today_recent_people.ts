import type { PeopleActor } from "../../../modules/people/public.ts";

export interface TodayRecentPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

export interface TodayRecentPeopleRepository {
  list(
    command: PeopleActor & { readonly limit: number },
  ): Promise<
    | { readonly status: "forbidden" }
    | {
      readonly people: readonly TodayRecentPerson[];
      readonly status: "ready";
    }
  >;
}

export function createTodayRecentPeople(dependencies: {
  readonly repository: TodayRecentPeopleRepository;
}) {
  return {
    get: (actor: PeopleActor) =>
      dependencies.repository.list({ ...actor, limit: 8 }),
  };
}

export type TodayRecentPeople = ReturnType<typeof createTodayRecentPeople>;
