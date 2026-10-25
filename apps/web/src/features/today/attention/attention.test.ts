import { describe, expect, it } from "vitest";
import type {
  TodayAttention,
  TodayAttentionItem,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  acknowledgeable,
  actionableItemIds,
  type AttentionAction,
  type AttentionAnswer,
  attentionDestination,
  attentionMeta,
  attentionReducer,
  type AttentionState,
  attentionView,
  attentionWhen,
  initialAttentionState,
  upcomingMeta,
} from "./attention.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const person = { archived: false, id: personId, name: "Ada Lovelace" };
const utc = { effectiveTimezone: "UTC", locale: "en" };

it("shows calendar event dates without notification timing", () => {
  const item = task("event", {
    kind: "important-date",
    occursOn: "2026-11-22",
    dueAt: "2026-10-23T09:00:00Z",
  });
  expect(attentionMeta(item, utc)).toBe("Important date Nov 22, 2026");
  expect(upcomingMeta(item, utc)).toBe("Important date Nov 22, 2026");
});

function task(
  id: string,
  overrides: Readonly<Record<string, unknown>> = {},
): TodayAttentionItem {
  return {
    dueAt: "2026-08-20T09:00:00.000Z",
    id,
    kind: "task",
    person,
    title: `Task ${id}`,
    ...overrides,
  } as TodayAttentionItem;
}

function snapshot(
  overdue: readonly TodayAttentionItem[] = [],
  upcoming: readonly TodayAttentionItem[] = [],
  date = "2026-08-18",
): TodayAttention {
  return {
    attention: { nextSevenDays: [], overdue, today: [] },
    date,
    status: "ready",
    timezone: "UTC",
    upcoming,
  };
}

function answer(
  value: TodayAttention = snapshot(),
  overrides: Partial<AttentionAnswer> = {},
): AttentionAnswer {
  return {
    preferences: utc,
    principalId: "user",
    snapshot: value,
    workspaceId,
    ...overrides,
  };
}

function run(
  ...actions: readonly AttentionAction[]
): AttentionState {
  return actions.reduce(attentionReducer, initialAttentionState);
}

const both = { regions: ["attention", "upcoming"], type: "read" } as const;

describe("GAP-033 Today attention reducer", () => {
  it("REL-048 settles every region still loading whenever a read answers", () => {
    const answers: readonly (AttentionAnswer | undefined)[] = [
      answer(snapshot([task("a")])),
      undefined,
    ];
    const reads: readonly AttentionAction[] = [
      both,
      { focus: "attention", regions: ["attention"], type: "read" },
      { focus: "upcoming", regions: ["upcoming"], type: "read" },
    ];
    for (const first of reads) {
      for (const second of reads) {
        for (const landed of answers) {
          const state = run(first, second, {
            answer: landed,
            type: "answered",
          });
          expect(state.attention.status).not.toBe("loading");
          expect(state.upcoming.status).not.toBe("loading");
          const view = attentionView(state);
          expect(view.attentionStatus).not.toMatch(/^Loading/);
          expect(view.upcomingStatus).not.toMatch(/^Loading/);
        }
      }
    }
  });

  it("starts loading both regions and applies an answer only to the regions asked for", () => {
    expect(attentionView(initialAttentionState)).toMatchObject({
      attentionRetry: false,
      attentionStatus: "Loading relationship priorities…",
      date: { text: "Loading date…" },
      onboarding: false,
      upcomingRetry: false,
      upcomingStatus: "Loading upcoming work…",
    });
    const first = run(both, {
      answer: answer(snapshot([task("a")], [task("b")])),
      type: "answered",
    });
    expect(attentionView(first)).toMatchObject({
      attentionStatus: "1 relationship priority.",
      date: { dateTime: "2026-08-18" },
      upcomingStatus: "1 upcoming item.",
    });
    const retried = [
      { regions: ["upcoming"], type: "read" },
      { answer: undefined, type: "answered" },
    ] as const;
    const failed = retried.reduce<AttentionState>(attentionReducer, first);
    expect(failed.attention).toBe(first.attention);
    expect(failed.upcoming).toEqual({
      status: "failed",
      value: first.upcoming.value,
    });
    expect(attentionView(failed)).toMatchObject({
      attentionRetry: false,
      upcomingRetry: true,
      upcomingStatus:
        "Upcoming work could not be loaded. Needs attention is unchanged.",
    });
    const recovered = [
      { regions: ["upcoming"], type: "read" },
      {
        answer: answer(snapshot([], [task("b"), task("c")], "2026-08-19")),
        type: "answered",
      },
    ] as const;
    const upcoming = recovered.reduce<AttentionState>(
      attentionReducer,
      failed,
    );
    expect(upcoming.attention.value?.overdue).toHaveLength(1);
    expect(attentionView(upcoming)).toMatchObject({
      date: { dateTime: "2026-08-19" },
      upcomingStatus: "2 upcoming items.",
    });
  });

  it("words empty, plural, and failed regions and shows onboarding only when both are empty", () => {
    const empty = run(both, { answer: answer(), type: "answered" });
    expect(attentionView(empty)).toMatchObject({
      attentionStatus: "All clear. No relationship work needs attention.",
      onboarding: true,
      upcomingStatus: "No upcoming relationship work in the next 30 days.",
    });
    const plural = run(both, {
      answer: answer(snapshot([task("a"), task("b")])),
      type: "answered",
    });
    expect(attentionView(plural)).toMatchObject({
      attentionStatus: "2 relationship priorities.",
      onboarding: false,
    });
    const failed = run(both, { answer: undefined, type: "answered" });
    expect(attentionView(failed)).toMatchObject({
      attentionRetry: true,
      attentionStatus:
        "Attention could not be loaded. Other Today regions remain available.",
      date: { dateTime: undefined, text: "Date unavailable" },
      onboarding: false,
      upcomingRetry: true,
    });
    const partial = [
      { regions: ["attention"], type: "read" },
      { answer: answer(), type: "answered" },
    ] as const;
    expect(
      attentionView(partial.reduce<AttentionState>(attentionReducer, failed))
        .onboarding,
    ).toBe(false);
  });

  it("keeps the last good date and formats it with the member's locale", () => {
    const good = run(both, { answer: answer(), type: "answered" });
    const failed = [both, { answer: undefined, type: "answered" }] as const;
    const kept = failed.reduce<AttentionState>(attentionReducer, good);
    expect(attentionView(kept).date).toEqual(attentionView(good).date);
    expect(attentionView(good).date.text).toBe("Tuesday, August 18, 2026");
    const unsupported = run(both, {
      answer: answer(snapshot(), {
        preferences: { effectiveTimezone: "UTC", locale: "en-USA" },
      }),
      type: "answered",
    });
    expect(attentionView(unsupported).date).toEqual({
      dateTime: "2026-08-18",
      text: "Date unavailable",
    });
    const unknown = run(both, {
      answer: answer(snapshot(), { preferences: undefined }),
      type: "answered",
    });
    expect(attentionView(unknown).date.text).toBe("Tuesday, August 18, 2026");
  });

  it("owns one completion at a time and hides only its row while it is pending", () => {
    const loaded = run(both, {
      answer: answer(snapshot([task("a"), task("b")])),
      type: "answered",
    });
    const pending = attentionReducer(loaded, { taskId: "a", type: "complete" });
    expect(attentionReducer(pending, { taskId: "b", type: "complete" })).toBe(
      pending,
    );
    expect(attentionView(pending)).toMatchObject({
      attentionRetry: false,
      attentionStatus: "Completing task…",
      actionsDisabled: true,
      hiddenItemId: "a",
      upcomingRetry: false,
    });
    const refreshing = attentionReducer(pending, both);
    expect(attentionView(refreshing).attentionStatus).toBe("Completing task…");
    const failed = attentionReducer(pending, { type: "completion-failed" });
    expect(failed.focus?.target).toEqual({ itemId: "a" });
    expect(attentionView(failed)).toMatchObject({
      attentionRetry: false,
      attentionStatus:
        "2 relationship priorities. Task could not be completed. Retry Complete.",
      actionsDisabled: false,
      hiddenItemId: undefined,
    });
    expect(attentionReducer(loaded, { type: "completion-failed" })).toBe(
      loaded,
    );
    expect(attentionReducer(loaded, { type: "completion-confirmed" })).toBe(
      loaded,
    );
  });

  it("clears a confirmed completion only once an answer no longer lists its task", () => {
    const loaded = run(both, {
      answer: answer(snapshot([task("a"), task("b")])),
      type: "answered",
    });
    const confirmed = [
      { taskId: "a", type: "complete" },
      { type: "completion-confirmed" },
      { focus: "attention", ...both },
    ] as const;
    const waiting = confirmed.reduce<AttentionState>(attentionReducer, loaded);
    expect(attentionView(waiting)).toMatchObject({
      attentionStatus: "Loading relationship priorities…",
      actionsDisabled: true,
      hiddenItemId: undefined,
    });
    const stale = attentionReducer(waiting, {
      answer: answer(snapshot([task("a"), task("b")])),
      type: "answered",
    });
    expect(stale.focus?.target).toBe("attention");
    expect(attentionView(stale)).toMatchObject({
      attentionRetry: true,
      attentionStatus:
        "2 relationship priorities. Task completion is confirmed; the projection has not caught up.",
      actionsDisabled: true,
    });
    const upcomingOnly = [
      { regions: ["upcoming"], type: "read" },
      { answer: answer(snapshot([task("b")])), type: "answered" },
    ] as const;
    expect(
      upcomingOnly.reduce<AttentionState>(attentionReducer, stale).completion,
    ).toEqual({ itemId: "a", phase: "confirmed", write: "complete" });
    const caughtUp = [
      { regions: ["attention"], type: "read" },
      { answer: answer(snapshot([task("b")])), type: "answered" },
    ] as const;
    const done = caughtUp.reduce<AttentionState>(attentionReducer, stale);
    expect(done.completion).toBeUndefined();
    expect(attentionView(done)).toMatchObject({
      attentionRetry: false,
      attentionStatus: "1 relationship priority.",
      actionsDisabled: false,
    });
  });

  it("asks for the projection when a failed task left the list, and forgets the failure once it is gone", () => {
    const loaded = run(both, {
      answer: answer(snapshot([task("a")])),
      type: "answered",
    });
    const failed = [
      { taskId: "a", type: "complete" },
      { type: "completion-failed" },
      both,
      { answer: answer(snapshot([task("b")])), type: "answered" },
    ] as const;
    const gone = failed.slice(0, 2).reduce<AttentionState>(
      attentionReducer,
      run(both, {
        answer: answer(snapshot([task("a", { person: undefined })])),
        type: "answered",
      }),
    );
    expect(gone.failure).toEqual({ itemId: "a", write: "complete" });
    const settled = failed.reduce<AttentionState>(attentionReducer, loaded);
    expect(settled.failure).toBeUndefined();
    const stillListed = failed.slice(0, 3).reduce<AttentionState>(
      attentionReducer,
      loaded,
    );
    const archived = attentionReducer(stillListed, {
      answer: answer(
        snapshot([task("a", { person: { ...person, archived: true } })]),
      ),
      type: "answered",
    });
    expect(archived.failure).toBeUndefined();
    const inert = attentionReducer(stillListed, {
      answer: answer(snapshot([task("a")])),
      type: "answered",
    });
    expect(inert.failure).toEqual({ itemId: "a", write: "complete" });
    const upcomingFailed = [
      { regions: ["upcoming"], type: "read" },
      { answer: undefined, type: "answered" },
    ] as const;
    const withoutControl = [
      { taskId: "a", type: "complete" },
      { type: "completion-failed" },
    ] as const;
    const noControl = withoutControl.reduce<AttentionState>(
      attentionReducer,
      upcomingFailed.reduce<AttentionState>(
        attentionReducer,
        run(both, {
          answer: answer(snapshot([task("a")])),
          type: "answered",
        }),
      ),
    );
    expect(attentionView(noControl)).toMatchObject({
      attentionRetry: false,
      upcomingRetry: true,
    });
    expect(
      attentionView({
        ...noControl,
        attention: { status: "ready", value: snapshot().attention },
      }),
    ).toMatchObject({
      attentionRetry: true,
      attentionStatus:
        "All clear. No relationship work needs attention. Task could not be completed. Retry the attention projection.",
    });
  });

  it("focuses the queue's status when a refused task is no longer offered", () => {
    const loaded = run(both, { answer: answer(), type: "answered" });
    const failed = [
      { taskId: "gone", type: "complete" },
      { type: "completion-failed" },
    ] as const;
    expect(failed.reduce<AttentionState>(attentionReducer, loaded).focus)
      .toEqual({ sequence: 1, target: "attention" });
  });

  it("words a region that settled without rows as empty", () => {
    expect(
      attentionView({
        ...initialAttentionState,
        attention: { status: "ready" },
        upcoming: { status: "ready" },
      }),
    ).toMatchObject({
      attentionStatus: "All clear. No relationship work needs attention.",
      onboarding: false,
      upcomingStatus: "No upcoming relationship work in the next 30 days.",
    });
  });

  it("starts over when the answer is for another workspace", () => {
    const loaded = run(both, {
      answer: answer(snapshot([task("a")], [task("u")])),
      type: "answered",
    });
    const pending = attentionReducer(loaded, { taskId: "a", type: "complete" });
    const moved = [
      { regions: ["attention"], type: "read" },
      {
        answer: answer(snapshot([task("b")]), {
          workspaceId: "00000000-0000-4000-8000-000000000004",
        }),
        type: "answered",
      },
    ] as const;
    const other = moved.reduce<AttentionState>(attentionReducer, pending);
    expect(other.completion).toBeUndefined();
    expect(other.upcoming).toEqual({ status: "ready", value: [] });
    expect(other.workspaceId).toBe("00000000-0000-4000-8000-000000000004");
  });

  it("starts over when the answer is for another principal in the same workspace", () => {
    const loaded = run(both, {
      answer: answer(snapshot([task("a")])),
      type: "answered",
    });
    const failed = [
      { taskId: "a", type: "complete" },
      { type: "completion-failed" },
    ] as const;
    const refused = failed.reduce<AttentionState>(attentionReducer, loaded);
    expect(refused.failure).toEqual({ itemId: "a", write: "complete" });
    const other = [
      { regions: ["upcoming"], type: "read" },
      {
        answer: answer(snapshot([task("a")]), { principalId: "someone-else" }),
        type: "answered",
      },
    ] as const;
    const moved = other.reduce<AttentionState>(attentionReducer, refused);
    expect(moved.failure).toBeUndefined();
    expect(moved.principalId).toBe("someone-else");
    expect(moved.attention.value?.overdue).toHaveLength(1);
    const same = [
      { regions: ["upcoming"], type: "read" },
      { answer: answer(snapshot([task("a")])), type: "answered" },
    ] as const;
    expect(same.reduce<AttentionState>(attentionReducer, refused).failure)
      .toEqual({ itemId: "a", write: "complete" });
  });

  it("focuses what the latest request asked for, and nothing when it asked for nothing", () => {
    const loaded = run(both, { answer: answer(), type: "answered" });
    expect(loaded.focus).toBeUndefined();
    const retried = [
      { focus: "attention", regions: ["attention"], type: "read" },
      { focus: "upcoming", regions: ["upcoming"], type: "read" },
      { answer: answer(), type: "answered" },
    ] as const;
    expect(retried.reduce<AttentionState>(attentionReducer, loaded).focus)
      .toEqual({ sequence: 1, target: "upcoming" });
    const superseded = [
      { focus: "attention", regions: ["attention"], type: "read" },
      both,
      { answer: undefined, type: "answered" },
    ] as const;
    expect(superseded.reduce<AttentionState>(attentionReducer, loaded).focus)
      .toBeUndefined();
  });
});

describe("GAP-033 Today attention presentation", () => {
  it("shows actual event dates without notification times or timezone shifts", () => {
    for (const meta of [attentionMeta, upcomingMeta]) {
      for (
        const effectiveTimezone of [
          "UTC",
          "America/Los_Angeles",
          "Pacific/Kiritimati",
        ]
      ) {
        for (
          const [dueAt, occursOn, expected] of [
            ["2026-10-23T09:00:00Z", "2026-11-22", "Nov 22, 2026"],
            ["2026-10-21T09:00:00Z", "2026-10-28", "Oct 28, 2026"],
          ] as const
        ) {
          const item: TodayAttentionItem = {
            dueAt,
            id: "birthday",
            kind: "important-date",
            occursOn,
            person,
            title: "Birthday",
          };
          const text = meta(item, { effectiveTimezone, locale: "en" });
          expect(text).not.toContain("Reminder due ");
          expect(text).toContain(`Important date ${expected}`);
          expect(text).not.toContain(person.name);
          const retry: TodayAttentionItem = {
            ...item,
            dueAt: "2026-11-23T00:30:00Z",
          };
          expect(meta(retry, { effectiveTimezone, locale: "en" })).toContain(
            `Important date ${expected}`,
          );
        }
      }
      expect(meta({
        dueAt: "2026-10-23T09:00:00Z",
        id: "event",
        kind: "life-event",
        occursOn: "2026-11-22",
        title: "Moved home",
      }, utc)).toBe(
        "Event date Nov 22, 2026",
      );
    }
  });

  it("links each kind to the person section that owns it", () => {
    const kinds = [
      ["task", "tasks"],
      ["important-date", "important-dates"],
      ["life-event", "life-events"],
      ["reminder", "reminders"],
      ["cadence", "stay-in-touch"],
    ] as const;
    for (const [kind, section] of kinds) {
      expect(
        attentionDestination({ ...task("a"), kind } as TodayAttentionItem),
      ).toBe(`/app/people/${personId}?section=${section}`);
    }
    expect(attentionDestination(task("a", { person: undefined }))).toBe(
      "/app/tasks",
    );
    expect(
      attentionDestination(
        {
          ...task("a", { person: undefined }),
          kind: "reminder",
        } as TodayAttentionItem,
      ),
    ).toBeUndefined();
    expect(
      attentionDestination(
        task("a", { person: { ...person, unavailable: true } }),
      ),
    ).toBeUndefined();
  });

  it("describes when an item is due and a cadence's last contact separately from its person", () => {
    const due = "Aug 20, 2026, 9:00 AM";
    expect(attentionMeta(task("a"), utc)).toBe(`Due ${due}`);
    expect(attentionMeta(task("a", { person: undefined }), utc)).toBe(
      `Due ${due}`,
    );
    const cadence = {
      dueAt: "2026-08-20T09:00:00.000Z",
      id: "c",
      kind: "cadence",
      person,
      title: "Reconnect",
    } as const;
    expect(attentionMeta(cadence, utc)).toBe(
      `Reconnect by ${due} · No contact recorded`,
    );
    expect(
      attentionMeta({
        ...cadence,
        lastContactedAt: "2026-08-20T09:00:00.000Z",
        person: { ...person, archived: true },
      }, utc),
    ).toBe(
      `Reconnect by ${due} · Last contact ${due} · archived`,
    );
    expect(upcomingMeta(task("a"), utc)).toBe(due);
    expect(upcomingMeta(task("a", { person: undefined }), undefined)).toBe(
      "Time unavailable",
    );
  });

  it("REL-059 says when an email reminder was not delivered or needs attention", () => {
    const due = "Aug 20, 2026, 9:00 AM";
    const reminder = (
      channel: "email" | "in_app",
      reminderStatus: "failed" | "manual_attention" | "pending" | "retry",
    ): TodayAttentionItem => ({
      channel,
      dueAt: "2026-08-20T09:00:00.000Z",
      id: "r",
      kind: "reminder",
      occursOn: "2026-08-20",
      person,
      reminderStatus,
      title: "Call Ada",
    });
    expect(attentionMeta(reminder("email", "failed"), utc)).toBe(
      `Email reminder not delivered · Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
    expect(attentionMeta(reminder("email", "manual_attention"), utc)).toBe(
      `Email reminder needs attention · Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
    expect(upcomingMeta(reminder("email", "failed"), utc)).toBe(
      `Email reminder not delivered · Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
    expect(attentionMeta(reminder("in_app", "failed"), utc)).toBe(
      `Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
    expect(upcomingMeta(reminder("in_app", "pending"), utc)).toBe(
      `Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
    expect(upcomingMeta(reminder("email", "retry"), utc)).toBe(
      `Reminder due ${due} · Occurs on Aug 20, 2026`,
    );
  });

  it("offers Complete only for an active person's or the workspace's tasks", () => {
    expect(
      actionableItemIds({
        nextSevenDays: [task("workspace", { person: undefined })],
        overdue: [
          task("a"),
          task("archived", { person: { ...person, archived: true } }),
          task("gone", { person: { ...person, unavailable: true } }),
        ],
        today: [{ ...task("r"), kind: "reminder" } as TodayAttentionItem],
      }),
    ).toEqual(["a", "workspace"]);
    expect(actionableItemIds(undefined)).toEqual([]);
  });
});

describe("REL-088 dismissing an undelivered reminder", () => {
  function undelivered(
    id: string,
    overrides: Readonly<Record<string, unknown>> = {},
  ): TodayAttentionItem {
    return {
      channel: "email",
      dueAt: "2026-08-17T09:00:00.000Z",
      id,
      kind: "reminder",
      occursOn: "2026-08-17",
      person,
      reminderStatus: "failed",
      title: `Reminder ${id}`,
      ...overrides,
    } as TodayAttentionItem;
  }

  it("offers Dismiss only for a reminder whose delivery failed or needs attention", () => {
    const offered = [
      undelivered("email-failed"),
      undelivered("email-unclear", { reminderStatus: "manual_attention" }),
      undelivered("in-app-failed", { channel: "in_app" }),
      undelivered("archived", { person: { ...person, archived: true } }),
      undelivered("personless", { person: undefined }),
    ];
    const withheld = [
      task("date", { kind: "important-date", occursOn: "2026-08-17" }),
      task("event", { kind: "life-event", occursOn: "2026-08-17" }),
      undelivered("pending", { reminderStatus: "pending" }),
      undelivered("retry", { reminderStatus: "retry" }),
      undelivered("gone", { person: { ...person, unavailable: true } }),
      task("task"),
    ];
    expect(offered.filter(acknowledgeable)).toEqual(offered);
    expect(withheld.filter(acknowledgeable)).toEqual([]);
    expect(
      actionableItemIds({
        nextSevenDays: [],
        overdue: [task("a"), ...offered, ...withheld],
        today: [],
      }),
    ).toEqual(["a", ...offered.map((item) => item.id), "task"]);
  });

  it("forgets a dismissal the server found stale without offering a retry", () => {
    const loaded = run(both, {
      answer: answer(snapshot([undelivered("r")])),
      type: "answered",
    });
    expect(attentionReducer(loaded, { type: "completion-stale" })).toBe(loaded);
    const stale = [
      { occurrenceId: "r", type: "acknowledge" },
      { type: "completion-stale" },
    ] as const;
    const settled = stale.reduce<AttentionState>(attentionReducer, loaded);
    expect(settled.completion).toBeUndefined();
    expect(settled.failure).toBeUndefined();
    expect(settled.focus).toBeUndefined();
    expect(attentionView(settled)).toMatchObject({
      actionsDisabled: false,
      attentionRetry: false,
      attentionStatus: "1 relationship priority.",
    });
  });

  it("shares the one write with Complete and says what it is doing", () => {
    const loaded = run(both, {
      answer: answer(snapshot([undelivered("r"), task("a")])),
      type: "answered",
    });
    const pending = attentionReducer(loaded, {
      occurrenceId: "r",
      type: "acknowledge",
    });
    expect(attentionReducer(pending, { taskId: "a", type: "complete" })).toBe(
      pending,
    );
    expect(
      attentionReducer(pending, { occurrenceId: "r", type: "acknowledge" }),
    ).toBe(pending);
    expect(attentionView(pending)).toMatchObject({
      actionsDisabled: true,
      attentionStatus: "Dismissing reminder…",
      hiddenItemId: "r",
    });
    const failed = attentionReducer(pending, { type: "completion-failed" });
    expect(failed.focus?.target).toEqual({ itemId: "r" });
    expect(attentionView(failed)).toMatchObject({
      actionsDisabled: false,
      attentionStatus:
        "2 relationship priorities. Reminder could not be dismissed. Retry Dismiss.",
      hiddenItemId: undefined,
    });
    const waiting = [
      { occurrenceId: "r", type: "acknowledge" },
      { type: "completion-confirmed" },
      { focus: "attention", ...both },
      {
        answer: answer(snapshot([undelivered("r"), task("a")])),
        type: "answered",
      },
    ] as const;
    const stale = waiting.reduce<AttentionState>(attentionReducer, failed);
    expect(attentionView(stale)).toMatchObject({
      actionsDisabled: true,
      attentionRetry: true,
      attentionStatus:
        "2 relationship priorities. Reminder dismissal is confirmed; the projection has not caught up.",
    });
    const caughtUp = [
      { regions: ["attention"], type: "read" },
      { answer: answer(snapshot([task("a")])), type: "answered" },
    ] as const;
    const done = caughtUp.reduce<AttentionState>(attentionReducer, stale);
    expect(done.completion).toBeUndefined();
    expect(attentionView(done)).toMatchObject({
      actionsDisabled: false,
      attentionStatus: "1 relationship priority.",
    });
  });
});

describe("when an item falls, relative to the member's today", () => {
  const belgrade = { effectiveTimezone: "Europe/Belgrade", locale: "en" };

  it.each(
    [
      ["2026-10-25", "Today", "today"],
      ["2026-10-26", "Tomorrow", "soon"],
      ["2026-10-27", "In 2 days", "soon"],
      ["2026-11-01", "In 7 days", "soon"],
      ["2026-11-06", "In 12 days", "later"],
      ["2026-10-24", "Yesterday", "overdue"],
      ["2026-10-20", "5 days ago", "overdue"],
    ] as const,
  )("a date on %s reads %s", (occursOn, label, tone) => {
    const item = task("date", {
      dueAt: "2026-10-01T09:00:00Z",
      kind: "important-date",
      occursOn,
    });
    expect(attentionWhen(item, "2026-10-25", utc)).toEqual({ label, tone });
  });

  it("reads a task's due instant in the member's time zone", () => {
    // 23:30 UTC on the 25th is already the 26th in Belgrade.
    const late = task("late", { dueAt: "2026-10-25T23:30:00Z" });
    expect(attentionWhen(late, "2026-10-25", belgrade)).toEqual({
      label: "Tomorrow",
      tone: "soon",
    });
    expect(attentionWhen(late, "2026-10-25", utc)).toEqual({
      label: "Today",
      tone: "today",
    });
  });

  it("says how overdue a task is", () => {
    const item = task("old", { dueAt: "2026-10-22T10:00:00Z" });
    expect(attentionWhen(item, "2026-10-25", utc)).toEqual({
      label: "3 days overdue",
      tone: "overdue",
    });
  });

  it("has nothing to say without the member's today", () => {
    expect(attentionWhen(task("any", {}), undefined, utc)).toBeUndefined();
  });
});
