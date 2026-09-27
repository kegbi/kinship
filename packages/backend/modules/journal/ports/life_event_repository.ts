/**
 * How the module stores a person's life events (JOURNAL-002).
 *
 * Every method is scoped by the actor's workspace and the person the event
 * belongs to, so an event of another person or workspace is simply absent.
 * `lock` reads the row the caller is about to change and holds it until the
 * transaction ends; `update` and `delete` change it only while it still
 * carries the revision the caller saw, and answer nothing when it does not.
 */

import type {
  LifeEventValue,
  StoredLifeEvent,
} from "../domain/life_event_rules.ts";
import type { JournalActor, JournalTransaction } from "./context.ts";

export interface LifeEventRepository {
  create(
    command: JournalActor & {
      readonly id: string;
      readonly now: Date;
      readonly personId: string;
      readonly transaction: JournalTransaction;
      readonly value: LifeEventValue;
    },
  ): Promise<StoredLifeEvent>;
  delete(
    command: JournalActor & {
      readonly expectedUpdatedAt: string;
      readonly lifeEventId: string;
      readonly personId: string;
      readonly transaction: JournalTransaction;
    },
  ): Promise<boolean>;
  lock(
    command: JournalActor & {
      readonly lifeEventId: string;
      readonly personId: string;
      readonly transaction: JournalTransaction;
    },
  ): Promise<StoredLifeEvent | undefined>;
  update(
    command: JournalActor & {
      readonly expectedUpdatedAt: string;
      /** Keep the recorded instant; otherwise it is cleared. */
      readonly keepHappenedAt: boolean;
      readonly lifeEventId: string;
      readonly now: Date;
      readonly personId: string;
      readonly transaction: JournalTransaction;
      readonly value: LifeEventValue;
    },
  ): Promise<StoredLifeEvent | undefined>;
}
