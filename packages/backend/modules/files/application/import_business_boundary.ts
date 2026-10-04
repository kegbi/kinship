/** Writes source records only inside the authorized import transaction. */
export interface FileBusinessImportBoundary {
  importRecords(command: {
    readonly actor: {
      readonly workspaceId: string;
      readonly memberId: string;
      readonly userId: string;
      readonly role: "owner" | "admin" | "member";
    };
    readonly records: readonly {
      readonly id: string;
      readonly data: Readonly<Record<string, unknown>>;
      readonly references: Readonly<Record<string, string>>;
    }[];
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void | Readonly<Record<string, string>>>;
}
