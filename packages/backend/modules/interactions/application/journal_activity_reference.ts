import type { PeopleActor, PeopleTransaction } from "../../people/public.ts";

export interface JournalActivityReference {
  inspect(
    command: PeopleActor & {
      readonly activityId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    { readonly occurredAt: string; readonly status: "ready" } | {
      readonly status: "forbidden" | "not-found";
    }
  >;
}
