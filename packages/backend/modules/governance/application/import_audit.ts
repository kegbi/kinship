import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";

export type ImportAuditAction = "committed" | "started" | "validated";

export interface ImportAudit {
  record(command: {
    readonly action: ImportAuditAction;
    readonly actor: {
      readonly memberId: string;
      readonly requestId?: string | undefined;
      readonly workspaceId: string;
    };
    readonly importId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void>;
}

export function describeImportEvent(
  command: Parameters<ImportAudit["record"]>[0],
): AuditEvent {
  return {
    action: `import.${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: command.payload,
    subjectId: command.importId,
    subjectType: "data_import",
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function importAuditFrom(recorder: AuditEventRecorder): ImportAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeImportEvent(command),
        missing: "Import audit insert failed.",
        transaction: command.transaction,
      });
    },
  };
}
