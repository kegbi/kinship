import { describe, expect, it } from "vitest";
import type {
  CommunicationList,
  CommunicationOptions,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  COMMUNICATION_MESSAGES,
  communicationCounts,
  type CommunicationsAction,
  communicationsReducer,
  type CommunicationsState,
  initialCommunicationsState,
  writable,
} from "./communications-state.ts";

const options: CommunicationOptions = {
  availability: { call: true, conversation: true },
  channelTypes: [{ id: "email", name: "Email" }],
  emotions: [],
  status: "ready",
};

const history: CommunicationList = {
  items: [{
    calledAt: "2026-08-16T18:15:00.000Z",
    contactWasCaller: true,
    createdAt: "2026-08-16T18:15:00.000Z",
    emotions: [],
    id: "call",
    kind: "call",
    person: { id: "ada", name: "Ada" },
  }],
  status: "ready",
};

function run(
  actions: readonly CommunicationsAction[],
  state: CommunicationsState = initialCommunicationsState(false),
): CommunicationsState {
  return actions.reduce(communicationsReducer, state);
}

const loaded = (given = options) =>
  run([{ history, options: given, type: "loaded" }]);

describe("calls and conversations state", () => {
  it("counts each kind the history holds", () => {
    expect(communicationCounts(history)).toEqual({ call: 1, conversation: 0 });
    expect(loaded().list).toEqual({
      counts: { call: 1, conversation: 0 },
      status: "ready",
    });
    expect(run([{ type: "load-failed" }]).list.status).toBe("error");
    expect(run([{ type: "loading" }], loaded()).list.status).toBe("loading");
    expect(
      run(
        [{ history: { items: [], status: "ready" }, type: "history" }],
        loaded(),
      )
        .list,
    ).toEqual({ counts: { call: 0, conversation: 0 }, status: "ready" });
  });

  it("opens an editor only for an available kind of an active person", () => {
    expect(writable(run([]), "call")).toBe(false);
    const unavailable = loaded({
      ...options,
      availability: { call: false, conversation: true },
    });
    expect(writable(unavailable, "call")).toBe(false);
    expect(run([{ kind: "call", requestId: "r1", type: "open" }], unavailable))
      .toBe(unavailable);
    const archived = run([{ archived: true, type: "archived" }], loaded());
    expect(writable(archived, "conversation")).toBe(false);
    const opened = run(
      [{ kind: "call", requestId: "r1", type: "open" }],
      loaded(),
    );
    expect(opened.editors.call).toMatchObject({
      focus: { target: "field" },
      open: true,
      requestId: "r1",
    });
  });

  it("keeps a request key until the save succeeds", () => {
    const failed = run([
      { kind: "call", requestId: "r1", type: "open" },
      { kind: "call", requestId: "r1", type: "saving" },
      { kind: "call", notice: "Try again.", type: "save-failed" },
      { kind: "call", requestId: "r2", type: "open" },
    ], loaded());
    expect(failed.editors.call).toMatchObject({
      focus: { target: "field" },
      notice: "Try again.",
      pending: false,
      requestId: "r1",
    });
    const saving = run(
      [{ kind: "call", requestId: "r1", type: "saving" }],
      failed,
    );
    expect(run([{ kind: "call", requestId: "r3", type: "open" }], saving))
      .toBe(saving);
    const saved = run([{ current: true, kind: "call", type: "saved" }], saving);
    expect(saved.editors.call).toMatchObject({
      notice: "Call saved.",
      pending: false,
      refresh: "hidden",
      requestId: undefined,
    });
    expect(saved.editors.call.focus).toEqual(failed.editors.call.focus);
  });

  it("says a save landed even when the view could not be refreshed, and retries the refresh", () => {
    const saved = run([
      { kind: "conversation", requestId: "r1", type: "saving" },
      { current: false, kind: "conversation", type: "saved" },
    ], loaded());
    expect(saved.editors.conversation).toMatchObject({
      focus: { target: "notice" },
      notice:
        "Conversation saved, but the current view could not be refreshed. Retry refresh or reload the page.",
      refresh: "shown",
    });
    const busy = run([{ kind: "conversation", type: "refreshing" }], saved);
    expect(busy.editors.conversation.refresh).toBe("busy");
    expect(
      run([{ current: false, kind: "conversation", type: "refreshed" }], busy)
        .editors.conversation,
    ).toMatchObject({
      notice: COMMUNICATION_MESSAGES.refreshFailed,
      refresh: "shown",
    });
    expect(
      run([{ current: true, kind: "conversation", type: "refreshed" }], busy)
        .editors.conversation,
    ).toMatchObject({
      notice: COMMUNICATION_MESSAGES.refreshed,
      refresh: "hidden",
    });
  });

  it("discards a cancelled draft and focuses the add control", () => {
    const drafted = run([
      { kind: "conversation", requestId: "r1", type: "open" },
      { channel: "email", type: "channel" },
      { key: "m1", type: "add-message" },
      { key: "m2", type: "add-message" },
      { key: "m1", type: "remove-message" },
    ], loaded());
    expect(drafted.editors.conversation).toMatchObject({
      channel: "email",
      messages: ["m2"],
    });
    const cancelled = run([{ kind: "conversation", type: "cancel" }], drafted);
    expect(cancelled.editors.conversation).toMatchObject({
      channel: "",
      draft: drafted.editors.conversation.draft + 1,
      focus: { target: "add" },
      messages: [],
      open: false,
      requestId: undefined,
    });
  });

  it("closes both editors when the person is archived, keeping a draft whose save is in flight", () => {
    const state = run([
      { kind: "call", requestId: "r1", type: "open" },
      { kind: "call", requestId: "r1", type: "saving" },
      { kind: "conversation", requestId: "r2", type: "open" },
      { key: "m1", type: "add-message" },
      { archived: true, type: "archived" },
    ], loaded());
    expect(state.archived).toBe(true);
    expect(state.editors.call).toMatchObject({
      open: false,
      pending: true,
      requestId: "r1",
    });
    expect(state.editors.conversation).toMatchObject({
      messages: [],
      open: false,
      requestId: undefined,
    });
    const restored = run([{ archived: false, type: "archived" }], state);
    expect(restored.archived).toBe(false);
    expect(restored.editors).toBe(state.editors);
  });

  it("loads contact methods once and says when they could not load", () => {
    const loading = run([{ type: "contacts-loading" }], loaded());
    expect(loading.contacts.status).toBe("loading");
    expect(loading.editors.conversation.notice).toBe(
      COMMUNICATION_MESSAGES.contactsLoading,
    );
    const failed = run([{ type: "contacts-settled" }], loading);
    expect(failed.contacts.status).toBe("failed");
    expect(failed.editors.conversation.notice).toBe(
      COMMUNICATION_MESSAGES.contactsFailed,
    );
    const records = [{ id: "m", typeId: "email", value: "ada@example.test" }];
    const ready = run([{ records, type: "contacts-settled" }], failed);
    expect(ready.contacts).toEqual({ records, status: "ready" });
    expect(ready.editors.conversation.notice).toBe("");
    const reopened = run([{ type: "contacts-loading" }], ready);
    expect(reopened.contacts).toBe(ready.contacts);
    expect(reopened.editors.conversation.notice).toBe("");
  });

  it("focuses a notice each time one is set", () => {
    const first = run([{
      kind: "call",
      notice: COMMUNICATION_MESSAGES.invalidOccurrence,
      type: "notice",
    }], loaded());
    const second = run([{
      kind: "call",
      notice: COMMUNICATION_MESSAGES.invalidOccurrence,
      type: "notice",
    }], first);
    expect(second.editors.call.focus).toEqual({ target: "notice", tick: 2 });
  });
});
