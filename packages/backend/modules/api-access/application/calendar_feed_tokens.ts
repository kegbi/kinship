/**
 * A member's calendar feed secret (GAP-052, `INTEGRATION-002`).
 *
 * A calendar application cannot send a header, so the feed's credential
 * travels in its URL. It is still an ordinary `api_tokens` row — hashed,
 * revocable, bound to one user and one workspace — with the single scope
 * `calendar.read`, so it is accepted by the same path as a personal token and
 * can never be spent as one: the text is spelled `kin_cal_…`, which the
 * personal-token parser refuses, and the scope is one no personal token may
 * carry.
 *
 * Unlike a personal token, a feed is every member's own: nobody but its
 * owner sees or changes it, so there is no administrative gate. Each member
 * has at most one live feed per workspace. The write paths lock the actor's
 * standing first, which serializes two creates by the same member, and
 * rotation revokes before it mints, in one transaction, so there is never a
 * moment with two live feeds. The secret is shown exactly once, in the answer
 * that minted it; only its hash is stored.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import {
  type ApiTokenRecord,
  CALENDAR_FEED_SCOPE,
  CALENDAR_FEED_TOKEN_NAME,
  type CalendarFeedRecord,
  parseCalendarFeedToken,
  renderCalendarFeedToken,
} from "../domain/token_rules.ts";
import type { CalendarFeedRepository } from "../ports/calendar_feed_repository.ts";
import type { ApiTokenActor, ApiTokenTransaction } from "../ports/context.ts";
import type { ApiTokenDependencies } from "./api_token_management.ts";
import { authenticatePresented } from "./token_authentication.ts";

export interface CalendarFeedTokenDependencies
  extends Omit<ApiTokenDependencies, "issuers"> {
  readonly calendarFeeds: CalendarFeedRepository;
}

/**
 * A feed secret's acceptance. Unlike a personal token's, it names no row: a
 * feed is read, never written with, so nothing audits it.
 */
export type FeedAuthentication =
  | { readonly actor: ApiTokenActor; readonly status: "authenticated" }
  | { readonly status: "invalid" };

type Minted<Status extends string> = {
  readonly feed: CalendarFeedRecord;
  readonly secret: string;
  readonly status: Status;
};

export interface CalendarFeedTokens {
  /** Accepts a feed's secret as its URL carries it. */
  authenticate(rawSecret: string): Promise<FeedAuthentication>;
  create(
    actor: ApiTokenActor,
  ): Promise<Minted<"created"> | Failure<"conflict" | "forbidden">>;
  current(actor: ApiTokenActor): Promise<
    | { readonly feed?: CalendarFeedRecord; readonly status: "ready" }
    | Failure<"forbidden">
  >;
  revoke(actor: ApiTokenActor): Promise<
    { readonly status: "revoked" } | Failure<"forbidden" | "not-found">
  >;
  rotate(
    actor: ApiTokenActor,
  ): Promise<Minted<"rotated"> | Failure<"forbidden" | "not-found">>;
}

export function createCalendarFeedTokens(
  dependencies: CalendarFeedTokenDependencies,
): CalendarFeedTokens {
  const active = async (
    actor: ApiTokenActor,
    transaction: ApiTokenTransaction,
    lock: boolean,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({ ...actor, lock, transaction }) ===
      "active";

  /** What the audit history says the token row was. */
  const audited = (feed: CalendarFeedRecord): ApiTokenRecord => ({
    createdAt: feed.createdAt,
    id: feed.id,
    name: CALENDAR_FEED_TOKEN_NAME,
    scopes: [CALENDAR_FEED_SCOPE],
  });

  const revokeAll = async (
    actor: ApiTokenActor,
    transaction: ApiTokenTransaction,
    now: Date,
  ): Promise<number> => {
    const revoked = await dependencies.calendarFeeds.revokeActive({
      ...actor,
      occurredAt: now,
      transaction,
    });
    for (const feed of revoked) {
      await dependencies.audit.record({
        action: "revoked",
        actor,
        occurredAt: now,
        record: { ...audited(feed), revokedAt: now.toISOString() },
        transaction,
      });
    }
    return revoked.length;
  };

  const mint = async (
    actor: ApiTokenActor,
    transaction: ApiTokenTransaction,
    now: Date,
  ): Promise<
    { readonly feed: CalendarFeedRecord; readonly secret: string }
  > => {
    const id = dependencies.ids.next();
    const secret = await dependencies.secrets.create();
    const feed = await dependencies.calendarFeeds.create({
      ...actor,
      hash: secret.hash,
      id,
      occurredAt: now,
      transaction,
    });
    await dependencies.audit.record({
      action: "created",
      actor,
      occurredAt: now,
      record: audited(feed),
      transaction,
    });
    return { feed, secret: renderCalendarFeedToken(id, secret.raw) };
  };

  return {
    authenticate: async (rawSecret) => {
      const accepted = await authenticatePresented(
        dependencies,
        parseCalendarFeedToken(rawSecret),
        CALENDAR_FEED_SCOPE,
      );
      return accepted.status === "authenticated"
        ? { actor: accepted.actor, status: "authenticated" }
        : accepted;
    },
    create: async (actor) => {
      const now = dependencies.clock.now();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        if (
          await dependencies.calendarFeeds.active({ ...actor, transaction })
        ) {
          return { status: "conflict" as const };
        }
        return { ...await mint(actor, transaction, now), status: "created" };
      }, { workspaceId: actor.workspaceId });
    },
    current: async (actor) =>
      await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const feed = await dependencies.calendarFeeds.active({
          ...actor,
          transaction,
        });
        return { ...(feed ? { feed } : {}), status: "ready" as const };
      }, { workspaceId: actor.workspaceId }),
    revoke: async (actor) => {
      const now = dependencies.clock.now();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        return await revokeAll(actor, transaction, now) > 0
          ? { status: "revoked" as const }
          : { status: "not-found" as const };
      }, { workspaceId: actor.workspaceId });
    },
    rotate: async (actor) => {
      const now = dependencies.clock.now();
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(actor, transaction, true)) {
          return { status: "forbidden" as const };
        }
        if (await revokeAll(actor, transaction, now) === 0) {
          return { status: "not-found" as const };
        }
        return { ...await mint(actor, transaction, now), status: "rotated" };
      }, { workspaceId: actor.workspaceId });
    },
  };
}
