/** Workspace-owned selection catalog and personal timezone, within the import transaction. */
export interface ImportChoicesBoundary {
  options(command: {
    readonly workspaceId: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<{
    readonly currencies: readonly string[];
    readonly genders: readonly {
      readonly id: string;
      readonly name: string;
      readonly archived: boolean;
    }[];
  }>;
  setTimezone(command: {
    readonly workspaceId: string;
    readonly memberId: string;
    readonly timezone: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}
