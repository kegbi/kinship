/**
 * Publishing a member's calendar feed (GAP-052, `INTEGRATION-002`).
 *
 * The feed is read by a calendar application holding nothing but the URL, so
 * the secret inside it is the whole of the request's authority. It is
 * accepted by `api-access` — hashed lookup, constant-time comparison, scope,
 * revocation, expiry, and the member's current standing — and the events are
 * read for exactly the member it names. Every refusal is `not-found`, so a
 * guessed URL learns nothing about whether a secret exists; only an outage
 * reading the events is told apart, because a calendar should keep its last
 * copy rather than empty itself.
 */

import { calendarFeedDocument } from "../domain/calendar_feed_rules.ts";
import type {
  CalendarFeedAuthority,
  CalendarFeedSource,
} from "../ports/calendar_feed.ts";

export interface CalendarFeedPublicationDependencies {
  readonly authority: CalendarFeedAuthority;
  /** The configured public web origin links open at. */
  readonly origin: string;
  readonly source: CalendarFeedSource;
}

export type CalendarFeedPublished =
  | { readonly body: string; readonly status: "ready" }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

export function createCalendarFeedPublication(
  dependencies: CalendarFeedPublicationDependencies,
) {
  return {
    publish: async (secret: string): Promise<CalendarFeedPublished> => {
      const accepted = await dependencies.authority.authenticate(secret);
      if (accepted.status !== "authenticated") return { status: "not-found" };
      const content = await dependencies.source.read(accepted.actor);
      if (content.status === "forbidden") return { status: "not-found" };
      if (content.status !== "ready") return { status: "unavailable" };
      return {
        body: calendarFeedDocument(content, dependencies.origin),
        status: "ready",
      };
    },
  };
}

export type CalendarFeedPublication = ReturnType<
  typeof createCalendarFeedPublication
>;
