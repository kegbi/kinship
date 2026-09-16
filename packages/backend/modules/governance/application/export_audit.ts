import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";

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

export function describeExportEvent(
  command: Parameters<ExportAudit["record"]>[0],
): AuditEvent {
  return {
    action: `export.${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: command.payload,
    subjectId: command.exportId,
    subjectType: "data_export",
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
  };
}

export function describePersonDownloadEvent(
  command: Parameters<ExportAudit["recordPersonDownload"]>[0],
): AuditEvent {
  return {
    action: "export.downloaded",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { format: "vcard" },
    personId: command.personId,
    subjectId: command.personId,
    subjectType: "person",
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
  };
}

export function exportAuditFrom(recorder: AuditEventRecorder): ExportAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeExportEvent(command),
        missing: "Export audit insert failed.",
        transaction: command.transaction,
      });
    },
    recordPersonDownload: async (command) => {
      await recorder.record({
        event: describePersonDownloadEvent(command),
        missing: "vCard export audit insert failed.",
        transaction: command.transaction,
      });
    },
  };
}
