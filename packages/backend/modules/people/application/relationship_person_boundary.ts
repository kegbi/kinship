import type { Failure } from "../../../shared-kernel/result.ts";
import type { PeopleActor, PeopleTransaction } from "../ports/context.ts";

export type RelationshipPersonInspection =
  | Failure<"not-found", "archived">
  | { readonly status: "ready" };

export interface RelationshipPersonSummary {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
}

export interface RelationshipPersonBoundary {
  inspect(
    command: PeopleActor & {
      readonly lock: boolean;
      readonly personIds: readonly string[];
      readonly transaction: PeopleTransaction;
    },
  ): Promise<RelationshipPersonInspection>;
  summarize(
    command: PeopleActor & {
      readonly personIds: readonly string[];
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly RelationshipPersonSummary[]>;
}
