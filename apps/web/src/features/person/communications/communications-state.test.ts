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
  run([{ history, type: "loaded" }, {
    options: given,
    type: "options-settled",
  }]);

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

  it("FEQ-04 starts empty without a read when the summary counted nothing", () => {
    expect(initialCommunicationsState(false, true).list).toEqual({
      counts: { call: 0, conversation: 0 },
      status: "ready",
    });
    expect(initialCommunicationsState(false).list).toEqual({
      initial: true,
      status: "loading",
    });
  });

  it("FEQ-04 loads the editors' options when one opens", () => {
    const opened = run([
      { kind: "call", requestId: "r1", type: "open" },
      { kind: "call", type: "options-loading" },
    ]);
    expect(opened.editors.call.notice).toBe(
      COMMUNICATION_MESSAGES.optionsLoading,
    );
    const ready = run(
      [{ options, type: "options-settled" }],
      opened,
    );
    expect(ready.options).toBe(options);
    expect(ready.editors.call).toMatchObject({ notice: "", open: true });
    // A notice something else wrote while they loaded stays.
    expect(
      run([
        {
          kind: "call",
          notice: "Choose a valid occurrence time.",
          type: "notice",
        },
        { options, type: "options-settled" },
      ], opened).editors.call.notice,
    ).toBe("Choose a valid occurrence time.");
    // Every editor that waited for the one read is settled by its answer.
    const both = run([
      { kind: "conversation", requestId: "r2", type: "open" },
      { kind: "conversation", type: "options-loading" },
      { options, type: "options-settled" },
    ], opened);
    expect(both.editors.call.notice).toBe("");
    expect(both.editors.conversation.notice).toBe("");
    const failed = run(
      [{ type: "options-settled" }],
      opened,
    );
    expect(failed.options).toBeUndefined();
    expect(failed.editors.call.notice).toBe(
      COMMUNICATION_MESSAGES.optionsFailed,
    );
    const unavailable = run([{
      options: {
        ...options,
        availability: { call: false, conversation: true },
      },
      type: "options-settled",
    }], opened);
    expect(unavailable.editors.call.open).toBe(false);
    expect(writable(unavailable, "call")).toBe(false);
  });

  it("FEQ-10 counts a saved record, and reads again when it cannot", () => {
    const call = history.items[0]!;
    expect(run([{ record: call, type: "recorded" }], loaded()).list).toEqual({
      counts: { call: 2, conversation: 0 },
      status: "ready",
    });
    const note = {
      body: "A note",
      createdAt: "2026-08-16T18:15:00.000Z",
      id: "note",
      isFavorited: false,
      kind: "note",
      participants: [],
    } as const;
    const ready = loaded();
    expect(run([{ record: note, type: "recorded" }], ready)).toBe(ready);
    expect(
      run([{ record: call, type: "recorded" }], run([{ type: "load-failed" }]))
        .list,
    ).toEqual({ status: "loading" });
    const full = run([{
      history: { items: Array(50).fill(call), status: "ready" },
      type: "history",
    }]);
    expect(run([{ record: call, type: "recorded" }], full).list).toEqual({
      status: "loading",
    });
  });

  it("opens an editor only for an available kind of an active person", () => {
    // Before the options load, an editor opens and loads them.
    expect(writable(run([]), "call")).toBe(true);
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
