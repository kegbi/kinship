/**
 * Audit-history composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresAuditHistoryRepository } from "./adapters/postgres/audit_history_repository.ts";
import { createAuditHistory } from "./public.ts";
import type { AuditCursorKeyset } from "./application/list_audit_history.ts";

export function composeAuditHistory(
  shared: SharedComposition,
  ports: { readonly cursorKeyset: AuditCursorKeyset },
) {
  return createAuditHistory({
    cursorKeyset: ports.cursorKeyset,
    repository: new PostgresAuditHistoryRepository(shared.database),
  });
}
