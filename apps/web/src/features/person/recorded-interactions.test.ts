import { describe, expect, it } from "vitest";
import type { Interaction } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  initialRecentCard,
  lastContactAfter,
  type RecentCard,
  recentCardReducer,
  recordedFor,
} from "./recorded-interactions.ts";

const ada = "00000000-0000-4000-8000-000000000100";
const grace = "00000000-0000-4000-8000-000000000101";

const note = (personId = ada): Interaction => ({
  body: "Remember the engine",
  createdAt: "2026-08-17T12:31:00.000Z",
  id: "note",
  isFavorited: false,
  kind: "note",
  participants: [{ id: personId, name: "Someone" }],
});

const call = (calledAt: string): Interaction => ({
  calledAt,
  contactWasCaller: true,
  createdAt: calledAt,
  emotions: [],
  id: "call",
  kind: "call",
  person: { id: ada, name: "Ada" },
});

const conversation = (
  happenedAt: string,
  written: readonly string[] = [],
): Interaction => ({
  createdAt: happenedAt,
  happenedAt,
  id: "conversation",
  kind: "conversation",
  messages: written.map((writtenAt, index) => ({
    content: "Hello",
    direction: "outbound",
    id: `message-${index}`,
    writtenAt,
  })),
  person: { id: ada, name: "Ada" },
});

const created = (detail: unknown, limit = 20) =>
  ({ detail, kind: "note", limit, personId: ada, type: "created" }) as const;

describe("FEQ-10 a recorded interaction on its person's page", () => {
  it("starts a card hidden, counted empty, or unread", () => {
    expect(initialRecentCard(true, 0)).toEqual({ status: "hidden" });
    expect(initialRecentCard(false, 0)).toEqual({ count: 0, status: "ready" });
    expect(initialRecentCard(false, 3)).toEqual({
      initial: true,
      status: "loading",
    });
    expect(initialRecentCard(false, undefined)).toEqual({
      initial: true,
      status: "loading",
    });
  });

  it("names the record the creation event carries when it is this person's", () => {
    const record = note();
    expect(recordedFor(ada, record)).toBe(record);
    expect(recordedFor(grace, record)).toBeUndefined();
    // A note may name its one person rather than participants.
    const { participants: _participants, ...single } = note() as Extract<
      Interaction,
      { kind: "note" }
    >;
    const named = { ...single, person: { id: ada, name: "Ada" } };
    expect(recordedFor(ada, named)).toBe(named);
    expect(recordedFor(grace, named)).toBeUndefined();
    expect(recordedFor(ada, call("2026-08-16T18:15:00.000Z"))).toMatchObject({
      kind: "call",
    });
    expect(recordedFor(ada, undefined)).toBe("unknown");
    expect(recordedFor(ada, null)).toBe("unknown");
    expect(recordedFor(ada, { status: "created" })).toBe("unknown");
  });

  const ready = (count: number): RecentCard => ({ count, status: "ready" });
  it.each<[string, RecentCard, unknown, RecentCard | "same", number?]>([
    ["counts its own kind", ready(1), note(), ready(2)],
    ["keeps a full page full", ready(20), note(), "same"],
    [
      "ignores another kind",
      ready(1),
      call("2026-08-16T18:15:00.000Z"),
      "same",
    ],
    ["ignores another person", ready(1), note(grace), "same"],
    ["reads after an unknown write", ready(1), undefined, {
      initial: false,
      status: "loading",
    }],
    ["reads a failed card again", { status: "error" }, note(), {
      initial: false,
      status: "loading",
    }],
    ["leaves a hidden card", { status: "hidden" }, note(), "same"],
  ])("%s", (_label, card, detail, expected) => {
    const next = recentCardReducer(card, created(detail));
    if (expected === "same") expect(next).toBe(card);
    else expect(next).toEqual(expected);
  });

  it("moves through its reads", () => {
    const loading = recentCardReducer(ready(2), { type: "loading" });
    expect(loading).toEqual({ initial: false, status: "loading" });
    expect(recentCardReducer(loading, { count: 4, type: "loaded" })).toEqual(
      ready(4),
    );
    expect(recentCardReducer(loading, { type: "failed" })).toEqual({
      status: "error",
    });
    const hidden: RecentCard = { status: "hidden" };
    expect(recentCardReducer(hidden, { type: "loading" })).toBe(hidden);
  });

  it("gives the hero the newest moment a call or conversation was in contact", () => {
    const earlier = "2026-08-16T18:15:00.000Z";
    const later = "2026-08-20T12:00:00.000Z";
    expect(lastContactAfter(undefined, call(earlier))).toBe(earlier);
    expect(lastContactAfter(later, call(earlier))).toBe(later);
    expect(lastContactAfter(earlier, call(later))).toBe(later);
    expect(lastContactAfter(undefined, conversation(earlier, [later]))).toBe(
      later,
    );
    expect(
      lastContactAfter(undefined, conversation(later, [earlier])),
    ).toBe(later);
    expect(lastContactAfter(earlier, note())).toBe(earlier);
    expect(lastContactAfter(undefined, note())).toBeUndefined();
  });
});
