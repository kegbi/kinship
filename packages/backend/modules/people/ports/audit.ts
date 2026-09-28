/**
 * What the module promises to write into the audit history.
 *
 * Every people write records an event in the same transaction and then reads
 * it back: `record` writes, `assertPostcondition` proves the row is there
 * before the transaction is allowed to commit. Two of the four hand back the
 * identifier they wrote so the assertion can name the exact row; the other two
 * assert on the described event alone, which is all the recorder needs.
 *
 * These are contracts, not descriptions — `application/audit_events.ts` holds
 * the pure functions that turn each command into the row governance stores.
 */

import type {
  ImportantDateAction,
  ImportantDateRecord,
} from "../domain/important_dates/rules.ts";
import type {
  PersonLifecycleAction,
  PersonLifecycleRecord,
} from "../domain/lifecycle_rules.ts";
import type { PersonIdentity } from "../domain/person_identity.ts";
import type { ProfileFactRecord } from "../domain/profile_facts/values.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

export interface PersonCreatedAudit {
  record(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly person: PersonIdentity;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  assertPostcondition(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly person: PersonIdentity;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface PersonLifecycleAudit {
  record(command: {
    readonly action: PersonLifecycleAction;
    readonly actor: PeopleActor;
    readonly before: PersonLifecycleRecord;
    readonly occurredAt: Date;
    readonly person: PersonLifecycleRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: PersonLifecycleAction;
    readonly actor: PeopleActor;
    readonly auditId: string;
    readonly before: PersonLifecycleRecord;
    readonly occurredAt: Date;
    readonly person: PersonLifecycleRecord;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ImportantDateAudit {
  record(command: {
    readonly action: ImportantDateAction;
    readonly actor: PeopleActor;
    readonly after?: ImportantDateRecord;
    readonly before?: ImportantDateRecord;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: ImportantDateAction;
    readonly actor: PeopleActor;
    readonly after?: ImportantDateRecord;
    readonly auditId: string;
    readonly before?: ImportantDateRecord;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ProfileFactAudit {
  record(command: {
    readonly action: "delete" | "save";
    readonly actor: PeopleActor;
    readonly after?: ProfileFactRecord;
    readonly before?: ProfileFactRecord;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: "delete" | "save";
    readonly actor: PeopleActor;
    readonly after?: ProfileFactRecord;
    readonly auditId: string;
    readonly before?: ProfileFactRecord;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

/** A person's avatar changed: a new image, or back to their initials. */
export interface PersonAvatarAudit {
  record(command: {
    readonly action: "removed" | "updated";
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

/** A person was starred or unstarred for the workspace (GAP-053). */
export interface PersonStarAudit {
  record(command: {
    readonly action: "starred" | "unstarred";
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

/** A pair of people was marked as not duplicates (REL-064). */
export interface PersonDuplicateDismissalAudit {
  record(command: {
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly personHighId: string;
    readonly personLowId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

/**
 * Two people became one (GAP-049): the primary kept, the duplicate deleted,
 * and every reference that moved counted by table.
 */
export interface PersonMergeAudit {
  record(command: PersonMergeAuditCommand): Promise<string>;
  assertPostcondition(
    command: PersonMergeAuditCommand & { readonly auditId: string },
  ): Promise<void>;
}

export interface PersonMergeAuditCommand {
  readonly actor: PeopleActor;
  /** Each single-valued fact of the duplicate's that was not kept, as it was. */
  readonly discarded: readonly Readonly<Record<string, unknown>>[];
  readonly duplicateId: string;
  readonly occurredAt: Date;
  readonly primaryId: string;
  /** Reference name to the rows relinked and removed there. */
  readonly tables: Readonly<
    Record<string, { readonly relinked: number; readonly removed: number }>
  >;
  readonly transaction: PeopleTransaction;
}
