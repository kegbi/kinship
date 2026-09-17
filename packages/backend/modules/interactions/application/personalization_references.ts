export type InteractionReferenceSection =
  | "activity-types"
  | "contact-method-types"
  | "emotion-options";

export interface InteractionPersonalizationReferences {
  count(command: {
    readonly id: string;
    readonly section: InteractionReferenceSection;
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<number>;
  replace(command: {
    readonly id: string;
    readonly replacementId: string;
    readonly section: InteractionReferenceSection;
    readonly transaction: { readonly opaque: unknown };
    readonly workspaceId: string;
  }): Promise<"conflict" | "replaced">;
}
