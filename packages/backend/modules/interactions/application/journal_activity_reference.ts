import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor, PeopleTransaction } from "../../people/public.ts";

export interface JournalActivityReference {
  inspect(
    command: PeopleActor & {
      readonly activityId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly occurredAt: string; readonly status: "ready" }
    | Failure<"forbidden" | "not-found">
  >;
}
