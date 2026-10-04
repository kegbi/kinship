/** Historical import writes participate in the importer transaction. */
export interface InteractionBusinessImportRecord {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>> & {
    readonly kind:
      | "activity"
      | "participant"
      | "call"
      | "note"
      | "call_emotion"
      | "activity_emotion";
  };
  readonly references: Readonly<Record<string, string>>;
}
export interface InteractionBusinessImportBoundary {
  importRecords(command: {
    readonly actor: {
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly role: "owner" | "admin" | "member";
    };
    readonly records: readonly InteractionBusinessImportRecord[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void | Readonly<Record<string, string>>>;
}
