/** Historical import writes participate in the importer transaction. */
export interface RelationshipBusinessImportRecord {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>> & {
    readonly kind: "relationship" | "relationship_alias";
  };
  readonly references: Readonly<Record<string, string>>;
}
export interface RelationshipBusinessImportBoundary {
  importRecords(command: {
    readonly actor: {
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly role: "owner" | "admin" | "member";
    };
    readonly records: readonly RelationshipBusinessImportRecord[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void | Readonly<Record<string, string>>>;
}
