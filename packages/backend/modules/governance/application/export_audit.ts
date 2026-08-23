export type ExportAuditAction = "completed" | "downloaded" | "requested";

export interface ExportAudit {
  record(command: {
    readonly action: ExportAuditAction;
    readonly actor: {
      readonly memberId: string;
      readonly workspaceId: string;
    };
    readonly exportId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
  recordPersonDownload(command: {
    readonly actor: {
      readonly memberId: string;
      readonly workspaceId: string;
    };
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}
