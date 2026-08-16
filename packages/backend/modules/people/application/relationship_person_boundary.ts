import type { PeopleActor, PeopleTransaction } from "./create_person.ts";

export type RelationshipPersonInspection =
  | { readonly status: "archived" | "not-found" }
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
