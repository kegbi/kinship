/**
 * What a member may record a communication against, and what is already there.
 *
 * Both reads are lock-free: they establish the actor, ask the workspace or the
 * repository, and hand the answer back. The only work worth naming is the
 * hydration, and that lives in `communication_context.ts`.
 */

import {
  active,
  type CommunicationDependencies,
  hydrateMany,
} from "./communication_context.ts";
import type { InteractionActor } from "../ports/context.ts";

export function createCommunicationListing(
  dependencies: CommunicationDependencies,
) {
  return {
    communicationOptions: (actor: InteractionActor) =>
      dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        return await dependencies.workspace.communicationOptions({
          ...actor,
          transaction,
        });
      }, { workspaceId: actor.workspaceId }),
    listCommunications: (actor: InteractionActor, personId: string) =>
      dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const people = await dependencies.people.inspect({
          ...actor,
          lock: false,
          personIds: [personId],
          transaction,
        });
        if (people.status === "not-found") {
          return { status: "not-found" as const };
        }
        const stored = await dependencies.repository.listForPerson({
          ...actor,
          personId,
          transaction,
        });
        return {
          items: await hydrateMany(dependencies, actor, stored, transaction),
          status: "ready" as const,
        };
      }, { workspaceId: actor.workspaceId }),
  };
}
