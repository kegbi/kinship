export type ImportAuditAction = "committed" | "started" | "validated";

export interface ImportAudit {
  record(command: {
    readonly action: ImportAuditAction;
    readonly actor: {
      readonly memberId: string;
      readonly workspaceId: string;
    };
    readonly importId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}
