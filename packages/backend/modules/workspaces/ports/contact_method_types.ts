/**
 * The contact-method types an import can file a value under (GAP-050).
 *
 * A vCard or CSV contact carries email addresses, phone numbers, and
 * websites, but a stored contact method needs a type from the workspace's own
 * vocabulary, which this module owns. The importer asks which active type
 * stands for each broad kind; a kind the workspace has no active type for is
 * reported in the dry run rather than invented. The actor's standing is not
 * this boundary's question: the importer revalidates before it asks.
 */

export interface ContactMethodTypeTransaction {
  readonly opaque: unknown;
}

/** The broad kinds the importer files values under. */
export type ContactMethodTypeKind = "email" | "phone" | "url";

/** The type a kind is filed under, and whether its name chose it. */
export interface ContactMethodTypeChoice {
  /** A custom type whose name says the kind (`Email`, `Phone`, `Website`). */
  readonly byName: boolean;
  readonly id: string;
  readonly name: string;
}

export interface ContactMethodTypeCatalog {
  /**
   * The first active type of each kind, by the workspace's own order; a kind
   * with no active type is absent. A workspace whose types predate the kind
   * field has them all as `custom`, so a custom type named `Email`, `Phone`,
   * `Website`, or `URL` (in any case) stands in when no type has the kind.
   */
  byKind(command: {
    readonly transaction: ContactMethodTypeTransaction;
    readonly workspaceId: string;
  }): Promise<
    Readonly<Partial<Record<ContactMethodTypeKind, ContactMethodTypeChoice>>>
  >;
}
