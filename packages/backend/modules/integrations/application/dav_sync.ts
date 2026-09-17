/**
 * The DAV facade.
 *
 * Managing subscriptions and running one against its remote are two different
 * pieces of work that share only the standing check they both start with. They
 * are assembled here so a composition root still builds one object with
 * `configure`, `disable`, `list`, and `synchronize` on it, and so the split
 * between `dav_subscriptions.ts` and `dav_synchronize.ts` stays an internal
 * matter rather than something every caller has to know about.
 */

import type { DavSyncDependencies } from "./dav_context.ts";
import { createDavSubscriptions } from "./dav_subscriptions.ts";
import { createDavSynchronize } from "./dav_synchronize.ts";

export function createDavSyncManagement(dependencies: DavSyncDependencies) {
  const subscriptions = createDavSubscriptions(dependencies);
  const synchronization = createDavSynchronize(dependencies);
  return {
    configure: subscriptions.configure,
    disable: subscriptions.disable,
    list: subscriptions.list,
    synchronize: synchronization.synchronize,
  };
}

export type DavSyncManagement = ReturnType<typeof createDavSyncManagement>;
