/**
 * Notifications composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresNotificationsRepository } from "./adapters/postgres/notifications_repository.ts";
import { createNotifications } from "./public.ts";

export function composeNotifications(shared: SharedComposition) {
  return createNotifications({
    actors: shared.actors,
    repository: new PostgresNotificationsRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
