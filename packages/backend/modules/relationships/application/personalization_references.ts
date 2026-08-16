export interface RelationshipPersonalizationReferences {
  count(command: {
    readonly id: string;
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<number>;
  replace(command: {
    readonly id: string;
    readonly replacementId: string;
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<"conflict" | "replaced">;
}
