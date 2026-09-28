/**
 * The note an imported contact arrives with (GAP-050).
 *
 * A vCard `NOTE` or a mapped CSV note column becomes an ordinary note on the
 * person the import creates, written in the commit's transaction. The
 * importer has already revalidated the actor under lock and created the
 * person in the same workspace, so the boundary only writes the row.
 */

export interface InteractionImportBoundary {
  addNote(command: {
    readonly actor: {
      readonly memberId: string;
      readonly workspaceId: string;
    };
    readonly body: string;
    readonly noteId: string;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}
