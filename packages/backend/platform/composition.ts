/**
 * The one shared composition context.
 *
 * Before GAP-013 a single 650-line function in `apps/api/composition.ts`
 * constructed every adapter in the repository, and each module's `public.ts`
 * doubled as the registry that made those classes reachable. Each module now
 * owns a `composition.ts` that builds its own adapters, and this is the object
 * every one of them receives: the handful of things no single module owns.
 *
 * It is a contract, not a factory. The fields are typed by the shared kernel
 * and by module port types, never by an adapter class, so a module's
 * composition file can depend on the context without depending on anyone
 * else's infrastructure. A composition root builds one instance from the
 * per-module factories that produce these shared ports.
 *
 * `mail` and `objectStore` are deliberately absent: they are runtime choices a
 * root makes (SMTP or a capturing double, S3 or an in-memory store), so the
 * roots pass them to the modules that need them instead of every module seeing
 * them.
 */

import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "./postgres/database.ts";
import type { AuditEventRecorder } from "../shared-kernel/audit_event.ts";
import type { Clock } from "../shared-kernel/clock.ts";
import type { IdGenerator } from "../shared-kernel/ids.ts";
import type { RequestTombstones } from "../shared-kernel/request_tombstone.ts";
import type { TransactionRunner } from "../shared-kernel/transaction.ts";
import type { PeopleTransaction } from "../modules/people/public.ts";
import type {
  ActiveWorkspaceResolver,
  ActorContext,
  ActorRecipients,
  ActorRevalidation,
  RegistrationTransaction,
} from "../modules/workspaces/public.ts";

/**
 * The one approved actor-context read, as every module sees it. The workspaces
 * adapter answers all three questions; a module depends on the subset it asks.
 */
export type SharedActors = ActorContext & ActorRecipients & ActorRevalidation;

export interface SharedComposition {
  /** The one actor-context read, shared by every use case that writes. */
  readonly actors: SharedActors;
  /** Governance owns `crm.audit_events`; this is its one writer. */
  readonly audit: AuditEventRecorder;
  readonly clock: Clock;
  readonly database: Kysely<ApplicationDatabase>;
  readonly ids: IdGenerator;
  /** The people-owned transaction the person-scoped modules share. */
  readonly peopleTransaction: TransactionRunner<PeopleTransaction>;
  /**
   * Governance owns `crm.request_tombstones`; this is its one reader and
   * writer, which a keyed create asks and a permanent delete writes (MCP-E3).
   */
  readonly tombstones: RequestTombstones;
  /** The workspaces-owned transaction the account-scoped modules share. */
  readonly transaction: TransactionRunner<RegistrationTransaction>;
  /** The workspace an authenticated identity may enter. */
  readonly workspaceEntry: ActiveWorkspaceResolver;
}
