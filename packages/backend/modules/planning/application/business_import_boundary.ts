/** Historical import writes participate in the importer transaction. */
export interface PlanningBusinessImportRecord {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>> & {
    readonly kind: "rule" | "reminder" | "cadence";
  };
  readonly references: Readonly<Record<string, string>>;
}
export interface PlanningBusinessImportBoundary {
  assertReminder(
    command: {
      readonly workspaceId: string;
      readonly reminderId: string;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean>;
  importRecords(command: {
    readonly actor: {
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly role: "admin" | "member" | "owner";
    };
    readonly records: readonly PlanningBusinessImportRecord[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void | Readonly<Record<string, string>>>;
}
