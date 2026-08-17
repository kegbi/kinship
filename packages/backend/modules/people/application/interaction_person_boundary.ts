import type { RelationshipPersonBoundary } from "./relationship_person_boundary.ts";

export interface InteractionPersonBoundary extends RelationshipPersonBoundary {
  describeContactMethods(command: {
    readonly contactMethodIds: readonly string[];
    readonly personId: string;
    readonly transaction: Parameters<
      RelationshipPersonBoundary["inspect"]
    >[0]["transaction"];
    readonly workspaceId: string;
  }): Promise<
    readonly {
      readonly id: string;
      readonly typeId: string;
      readonly value: string;
    }[]
  >;
  inspectContactMethod(command: {
    readonly contactMethodId: string;
    readonly personId: string;
    readonly transaction: Parameters<
      RelationshipPersonBoundary["inspect"]
    >[0]["transaction"];
    readonly workspaceId: string;
  }): Promise<
    | {
      readonly contactMethod: {
        readonly id: string;
        readonly typeId: string;
        readonly value: string;
      };
      readonly status: "ready";
    }
    | { readonly status: "not-found" }
  >;
}
