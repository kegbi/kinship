import type { Failure } from "../../../shared-kernel/result.ts";

export interface RelationshipWorkspaceTransaction {
  readonly opaque: unknown;
}

export interface RelationshipWorkspaceActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface WorkspaceRelationshipType {
  readonly archived: boolean;
  readonly forwardLabel: string;
  readonly id: string;
  readonly reverseLabel: string;
}

export interface WorkspaceRelationshipTypeCursor {
  readonly forwardLabel: string;
  readonly id: string;
  readonly sortOrder: number;
}

export interface WorkspaceRelationshipTypeRecord
  extends WorkspaceRelationshipType {
  readonly cursor: WorkspaceRelationshipTypeCursor;
}

export type WorkspaceRelationshipTypePage =
  | {
    readonly records: readonly WorkspaceRelationshipTypeRecord[];
    readonly status: "ready";
  }
  | Failure<"forbidden">
  | { readonly status: "hidden" }
  | { readonly status: "stale-cursor" };

export type WorkspaceRelationshipTypeHydration =
  | {
    readonly records: readonly WorkspaceRelationshipType[];
    readonly status: "ready";
  }
  | Failure<"forbidden">
  | { readonly status: "hidden" };

export type RelationshipWorkspaceInspection =
  | Failure<"forbidden" | "not-found", "hidden">
  | {
    readonly status: "ready";
    readonly type?: WorkspaceRelationshipType;
  };

export type RelationshipWorkspaceDefaults =
  | { readonly status: "ready" }
  | Failure<"forbidden">
  | { readonly status: "hidden" };

export interface RelationshipWorkspaceBoundary {
  ensureDefaultRelationshipTypes(
    command: RelationshipWorkspaceActor & {
      readonly transaction: RelationshipWorkspaceTransaction;
    },
  ): Promise<RelationshipWorkspaceDefaults>;
  inspect(
    command: RelationshipWorkspaceActor & {
      readonly lock: boolean;
      readonly relationshipTypeId?: string;
      readonly transaction: RelationshipWorkspaceTransaction;
    },
  ): Promise<RelationshipWorkspaceInspection>;
  listTypes(
    command: RelationshipWorkspaceActor & {
      readonly after?: WorkspaceRelationshipTypeCursor;
      readonly limit: number;
      readonly search?: string;
      readonly transaction: RelationshipWorkspaceTransaction;
    },
  ): Promise<WorkspaceRelationshipTypePage>;
  hydrateTypes(
    command: RelationshipWorkspaceActor & {
      readonly relationshipTypeIds: readonly string[];
      readonly transaction: RelationshipWorkspaceTransaction;
    },
  ): Promise<WorkspaceRelationshipTypeHydration>;
}
