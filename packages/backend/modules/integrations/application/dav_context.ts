/**
 * What a DAV use case needs before it may proceed.
 *
 * The standing check is two questions, not one, and the order is the point:
 * the role is decided here from the actor the request already carried, and
 * only then is the repository asked whether that membership is still live. A
 * member never reaches the second question, so an ordinary member cannot
 * discover which subscriptions a workspace has by watching how long a refusal
 * takes.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
// Configuring a subscription is an administrative act.
import { privileged } from "../../workspaces/public.ts";
import type {
  DavPeopleBoundary,
  DavTaskBoundary,
} from "../ports/core_boundaries.ts";
import type { DavActor } from "../ports/context.ts";
import type { DavRemoteClient } from "../ports/dav_remote.ts";
import type { DavRepository } from "../ports/dav_repository.ts";
import type { DavSecretBox } from "../ports/secrets.ts";

export interface DavSyncDependencies {
  readonly clock: Clock;
  readonly ids:
    & IdGenerator
    & { fromRemote(value: string): string | Promise<string> };
  readonly people: DavPeopleBoundary;
  readonly remote: DavRemoteClient;
  readonly repository: DavRepository;
  readonly secrets: DavSecretBox;
  readonly tasks: DavTaskBoundary;
}

/** An administrator whose membership the repository still recognises. */
export async function authorized(
  dependencies: DavSyncDependencies,
  actor: DavActor,
): Promise<boolean> {
  return privileged(actor) && await dependencies.repository.authorize(actor);
}
