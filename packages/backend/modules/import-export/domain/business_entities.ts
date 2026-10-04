/** Normalized business records staged in the import identity map. */
export interface BusinessEntity {
  readonly alreadyImported?: boolean;
  readonly owner:
    | "relationships"
    | "interactions"
    | "planning"
    | "vocabulary"
    | "people"
    | "gifts"
    | "journal"
    | "files"
    | "workspaces"
    | "governance";
  readonly sourceTable: string;
  readonly sourcePrimaryKey: string;
  readonly targetTable: string;
  readonly targetId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly references?: Readonly<
    Record<string, { readonly table: string; readonly key: string }>
  >;
}
export type UnstagedBusinessEntity = Omit<BusinessEntity, "targetId">;
export interface BusinessParseResult {
  readonly entities: readonly UnstagedBusinessEntity[];
  readonly handledTables: readonly string[];
  readonly unsupportedRows?: Readonly<Record<string, number>>;
  readonly unsupportedFields?: Readonly<Record<string, number>>;
}
export async function businessTargetId(
  workspaceId: string,
  entity: UnstagedBusinessEntity,
  namespace: string,
): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        workspaceId,
        "monica",
        namespace,
        entity.data.sourceAccountId ?? "",
        entity.sourceTable,
        entity.sourcePrimaryKey,
      ]),
    ),
  );
  const bytes = new Uint8Array(hash).slice(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80;
  bytes[8] = (bytes[8]! & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`;
}
