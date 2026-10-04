/** Historical import writes participate in the importer transaction. */
export interface VocabularyBusinessImportRecord {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>> & {
    readonly kind:
      | "relationship_group"
      | "relationship_type"
      | "activity_category"
      | "activity_type"
      | "emotion";
  };
  readonly references: Readonly<Record<string, string>>;
}
export interface VocabularyBusinessImportBoundary {
  importRecords(command: {
    readonly actor: { readonly workspaceId: string; readonly memberId: string };
    readonly records: readonly VocabularyBusinessImportRecord[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void | Readonly<Record<string, string>>>;
}
