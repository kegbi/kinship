/**
 * What the module promises to write into the audit history.
 *
 * A read is audited alongside an upload and a removal, which is unusual and
 * deliberate: a person's documents are the kind of record where who looked is
 * as much a fact as who changed something.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { StoredPersonFile } from "../domain/file_rules.ts";
import type { PersonFileActor, PersonFileTransaction } from "./context.ts";

export interface FileAudit {
  record(command: {
    readonly action: "read" | "removed" | "uploaded";
    readonly actor: PersonFileActor;
    readonly file: StoredPersonFile;
    readonly occurredAt: Date;
    readonly transaction: PersonFileTransaction;
  }): Promise<string>;
}
