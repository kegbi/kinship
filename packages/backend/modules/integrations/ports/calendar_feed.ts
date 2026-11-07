/**
 * What the calendar feed needs from outside integrations (GAP-052,
 * `INTEGRATION-002`).
 *
 * Integrations publishes the feed but owns none of it: the secret is an
 * `api-access` token and the events are the `calendar-feed` read model's. Both
 * contracts are declared here and filled at the composition root, so this
 * module imports neither — the same arrangement as the DAV bridges into
 * people and planning.
 */

import type { CalendarFeedContent } from "../domain/calendar_feed_rules.ts";
import type { DavActor } from "./context.ts";

/** Accepts a feed secret as its URL carries it. */
export interface CalendarFeedAuthority {
  authenticate(rawSecret: string): Promise<
    | { readonly actor: DavActor; readonly status: "authenticated" }
    | { readonly status: "invalid" }
  >;
}

/** The events one member's feed shows. */
export interface CalendarFeedSource {
  read(actor: DavActor): Promise<
    | (CalendarFeedContent & { readonly status: "ready" })
    | { readonly status: "forbidden" | "unavailable" }
  >;
  /**
   * An opaque string that changes whenever what `read` would answer does,
   * cheap enough to compute on every poll (BEQ-14).
   */
  revision(actor: DavActor): Promise<
    | { readonly revision: string; readonly status: "ready" }
    | { readonly status: "forbidden" | "unavailable" }
  >;
}
