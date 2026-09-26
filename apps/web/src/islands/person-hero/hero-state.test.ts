import { describe, expect, it } from "vitest";
import {
  deletionMessage,
  type HeroIdentity,
  heroReducer,
  type HeroState,
  initialHeroState,
  initials,
} from "./hero-state.ts";

const identity = {
  familyName: "Lovelace",
  gender: "Woman",
  givenName: "Ada",
  id: "00000000-0000-4000-8000-000000000100",
  isDeceased: false,
  isPartial: false,
  isSelf: false,
  isStarred: true,
  middleName: "Augusta",
  nickname: "Enchantress",
  tagCount: 0,
  tags: [],
  updatedAt: "2026-08-15T08:00:00.000000Z",
} as HeroIdentity;

const lifecycle = (
  overrides: Record<string, unknown> = {},
) => ({
  givenName: "Ada",
  id: identity.id,
  isPartial: true,
  lifecycle: "active" as const,
  updatedAt: "2026-08-15T09:00:00.000000Z",
  ...overrides,
});

const start = (archived = false): HeroState =>
  initialHeroState(identity, archived);

describe("GAP-028 hero state", () => {
  it("toggles and closes the menu", () => {
    let state = heroReducer(start(), { type: "menu-toggled" });
    expect(state.menuOpen).toBe(true);
    state = heroReducer(state, { type: "menu-toggled" });
    expect(state.menuOpen).toBe(false);
    state = heroReducer(heroReducer(state, { type: "menu-toggled" }), {
      type: "menu-closed",
    });
    expect(state.menuOpen).toBe(false);
  });

  it("opens, cancels, fails, and saves the identity editor", () => {
    let state = heroReducer(heroReducer(start(), { type: "menu-toggled" }), {
      type: "edit-opened",
    });
    expect(state).toMatchObject({ editing: true, menuOpen: false });
    state = heroReducer(state, { type: "edit-cancelled" });
    expect(state).toMatchObject({
      editing: false,
      menuOpen: true,
      status: "Edit cancelled. No changes were saved.",
    });
    state = heroReducer(state, { detail: "Refused.", type: "edit-failed" });
    expect(state.status).toBe("Refused.");
    state = heroReducer(state, {
      person: lifecycle({ familyName: "Byron" }),
      type: "edit-saved",
    });
    expect(state.identity).toMatchObject({
      familyName: "Byron",
      gender: "Woman",
      givenName: "Ada",
      isPartial: true,
      isStarred: true,
      updatedAt: "2026-08-15T09:00:00.000000Z",
    });
    // Names the answer no longer carries are gone, not kept stale.
    expect(state.identity).not.toHaveProperty("middleName");
    expect(state.identity).not.toHaveProperty("nickname");
    expect(state.updatedAt).toBe("2026-08-15T09:00:00.000000Z");
    expect(state.status).toBe("Person identity updated.");
  });

  it("names the latest revision any section published", () => {
    expect(
      heroReducer(start(), {
        type: "revision-changed",
        updatedAt: "2026-08-16T00:00:00.000000Z",
      }).updatedAt,
    ).toBe("2026-08-16T00:00:00.000000Z");
  });

  it("archives and restores, waiting while a transition is in flight", () => {
    let state = heroReducer(heroReducer(start(), { type: "menu-toggled" }), {
      type: "transition-started",
    });
    expect(state).toMatchObject({ menuOpen: false, transitioning: true });
    state = heroReducer(state, { detail: "Busy.", type: "transition-failed" });
    expect(state).toMatchObject({ status: "Busy.", transitioning: false });
    state = heroReducer(state, {
      archived: true,
      person: lifecycle({
        familyName: "Lovelace",
        middleName: "Augusta",
        nickname: "Enchantress",
      }),
      type: "transition-succeeded",
    });
    expect(state).toMatchObject({
      archived: true,
      editing: false,
      transitioning: false,
    });
    expect(state.identity.nickname).toBe("Enchantress");
  });

  it("walks the delete dialog from impact to submission, failure, and cancel", () => {
    let state = heroReducer(start(), { type: "delete-opened" });
    expect(state.deletion).toEqual({ phase: "loading" });
    expect(deletionMessage(state.deletion)).toBe("Loading deletion impact…");
    // A delete cannot be submitted before its impact is known.
    expect(heroReducer(state, { type: "delete-submitted" })).toBe(state);
    state = heroReducer(state, {
      confirmation: "DELETE Ada",
      type: "delete-impact-loaded",
      updatedAt: "2026-08-15T12:00:00.000000Z",
    });
    expect(state.deletion).toEqual({
      confirmation: "DELETE Ada",
      phase: "ready",
    });
    expect(state.updatedAt).toBe("2026-08-15T12:00:00.000000Z");
    expect(deletionMessage(state.deletion)).toContain("Enter DELETE Ada");
    // A late impact after the dialog moved on changes nothing.
    expect(
      heroReducer(state, {
        confirmation: "stale",
        type: "delete-impact-loaded",
        updatedAt: "x",
      }),
    ).toBe(state);
    state = heroReducer(state, { type: "delete-submitted" });
    expect(state.deletion.phase).toBe("submitting");
    expect(deletionMessage(state.deletion)).toContain("Enter DELETE Ada");
    state = heroReducer(state, { detail: "No match.", type: "delete-failed" });
    expect(state.deletion).toEqual({
      confirmation: "DELETE Ada",
      detail: "No match.",
      phase: "failed",
    });
    expect(deletionMessage(state.deletion)).toBe("No match.");
    state = heroReducer(state, { type: "delete-submitted" });
    expect(state.deletion.phase).toBe("submitting");
    state = heroReducer(state, { type: "delete-finished" });
    expect(state.deletion).toEqual({ phase: "closed" });
    // A failure after the dialog closed is ignored.
    expect(heroReducer(state, { detail: "late", type: "delete-failed" }))
      .toBe(state);

    state = heroReducer(heroReducer(state, { type: "delete-opened" }), {
      detail: "Impact unavailable.",
      type: "delete-failed",
    });
    expect(state.deletion).toEqual({
      detail: "Impact unavailable.",
      phase: "failed",
    });
    expect(heroReducer(state, { type: "delete-submitted" })).toBe(state);
    state = heroReducer(state, { type: "delete-cancelled" });
    expect(state).toMatchObject({
      deletion: { phase: "closed" },
      menuOpen: true,
      status: "Delete cancelled. No changes were made.",
    });
  });

  it("draws up to two initials from the names the person has", () => {
    expect(initials(identity)).toBe("AL");
    expect(initials({ nickname: "zed" })).toBe("Z");
    expect(initials({})).toBe("?");
    expect(initials({ givenName: " ", familyName: "Byron" })).toBe("B");
  });
});
