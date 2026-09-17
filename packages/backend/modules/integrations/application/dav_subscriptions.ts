/**
 * Configuring, disabling, and listing DAV subscriptions.
 *
 * Configuring is the only one with any shape to it, and the shape is that a
 * refused configuration is still recorded. A member who pastes the wrong URL,
 * and a member whose attempt failed against the database, both leave an audit
 * event behind under the identifier the attempt would have had: a standing
 * instruction to fetch somebody else's server is worth a trail even when it
 * was never created.
 *
 * The password is sealed before it reaches the repository and never appears in
 * anything this file returns.
 */

import {
  type DavConfigurationInput,
  type DavSubscription,
  validConfiguration,
} from "../domain/dav_rules.ts";
import type { DavActor } from "../ports/context.ts";
import { authorized, type DavSyncDependencies } from "./dav_context.ts";

export function createDavSubscriptions(dependencies: DavSyncDependencies) {
  return {
    configure: async (actor: DavActor, input: DavConfigurationInput) => {
      if (!await authorized(dependencies, actor)) {
        return { status: "forbidden" as const };
      }
      const id = dependencies.ids.create();
      const occurredAt = dependencies.clock.now();
      const recordFailure = () =>
        dependencies.repository.recordAudit(actor, {
          action: "configure",
          code: "dav_sync_failed",
          occurredAt,
          outcome: "failure",
          subscriptionId: id,
        });
      const checked = validConfiguration(input);
      if (!checked) {
        await recordFailure();
        return { status: "invalid" as const };
      }
      let subscription: DavSubscription | undefined;
      try {
        subscription = await dependencies.repository.create({
          ...actor,
          encryptedPassword: await dependencies.secrets.seal(input.password),
          id,
          occurredAt,
          ...checked,
        });
      } catch {
        await recordFailure();
        throw new Error("dav_sync_failed");
      }
      if (!subscription) {
        await recordFailure();
        return { status: "forbidden" as const };
      }
      return { status: "configured" as const, subscription };
    },
    disable: async (actor: DavActor, subscriptionId: string) => {
      if (!await authorized(dependencies, actor)) {
        return { status: "forbidden" as const };
      }
      const subscription = await dependencies.repository.disable(
        actor,
        subscriptionId,
        dependencies.clock.now(),
      );
      return subscription
        ? { status: "disabled" as const, subscription }
        : { status: "not-found" as const };
    },
    list: async (actor: DavActor) =>
      !await authorized(dependencies, actor)
        ? { status: "forbidden" as const, subscriptions: [] }
        : {
          status: "ready" as const,
          subscriptions: await dependencies.repository.list(actor),
        },
  };
}
