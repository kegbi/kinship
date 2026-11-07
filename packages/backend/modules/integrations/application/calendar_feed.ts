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
 *
 * The entity tag comes first (BEQ-14): it is derived from the read model's
 * cheap revision, and only when the caller does not already hold that tag
 * are the events read and rendered. The revision is taken before the events,
 * so a write between the two can only make a later poll fetch again, never
 * pin a stale body to a current tag.
 */

import {
  calendarFeedDocument,
  calendarFeedTag,
} from "../domain/calendar_feed_rules.ts";
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
  | { readonly body: string; readonly status: "ready"; readonly tag: string }
  | { readonly status: "not-modified"; readonly tag: string }
  | { readonly status: "not-found" }
  | { readonly status: "unavailable" };

/** Whether the caller already holds the body this tag names. */
export type CalendarFeedHeld = (tag: string) => boolean;

const holdsNothing: CalendarFeedHeld = () => false;

export function createCalendarFeedPublication(
  dependencies: CalendarFeedPublicationDependencies,
) {
  return {
    publish: async (
      secret: string,
      held: CalendarFeedHeld = holdsNothing,
    ): Promise<CalendarFeedPublished> => {
      const accepted = await dependencies.authority.authenticate(secret);
      if (accepted.status !== "authenticated") return { status: "not-found" };
      const revision = await dependencies.source.revision(accepted.actor);
      if (revision.status === "forbidden") return { status: "not-found" };
      if (revision.status !== "ready") return { status: "unavailable" };
      const tag = await calendarFeedTag(
        revision.revision,
        dependencies.origin,
      );
      if (held(tag)) return { status: "not-modified", tag };
      const content = await dependencies.source.read(accepted.actor);
      if (content.status === "forbidden") return { status: "not-found" };
      if (content.status !== "ready") return { status: "unavailable" };
      return {
        body: calendarFeedDocument(content, dependencies.origin),
        status: "ready",
        tag,
      };
    },
  };
}

export type CalendarFeedPublication = ReturnType<
  typeof createCalendarFeedPublication
>;
