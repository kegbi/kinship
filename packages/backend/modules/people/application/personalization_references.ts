export type PeopleReferenceSection =
  | "contact-labels"
  | "contact-method-types"
  | "gender-options"
  | "pet-categories";

export interface PeopleReferenceCommand {
  readonly id: string;
  readonly replacementId?: string;
  readonly section: PeopleReferenceSection;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

export interface PeoplePersonalizationReferences {
  count(command: PeopleReferenceCommand): Promise<number>;
  replace(
    command: PeopleReferenceCommand & { readonly replacementId: string },
  ): Promise<"conflict" | "replaced">;
}
