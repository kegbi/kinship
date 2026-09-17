/**
 * What the module promises to write into the audit history.
 *
 * The DAV repository writes its own outcomes through this port, inside the
 * transaction that changed the subscription, so a run that recorded a failure
 * and the history that says it failed cannot come apart.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { AuditTransaction } from "../../../shared-kernel/audit_event.ts";
import type { DavAuditEvent } from "../domain/dav_rules.ts";
import type { DavActor } from "./context.ts";

export interface DavAuditCommand {
  readonly actor: DavActor;
  readonly event: DavAuditEvent;
  readonly transaction: AuditTransaction;
}

export interface DavAudit {
  record(command: DavAuditCommand): Promise<void>;
}
