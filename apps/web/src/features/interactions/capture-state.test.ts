import { describe, expect, it } from "vitest";
import {
  CAPTURE_MESSAGES,
  type CaptureAction,
  captureControls,
  type CaptureOptions,
  captureReducer,
  type CaptureState,
  captureSubmission,
  freshDraft,
  initialCaptureState,
  kindBlocked,
  selectorOptions,
} from "./capture-state.ts";

const ada = { id: "00000000-0000-4000-8000-000000000100", name: "Ada" };
const grace = { id: "00000000-0000-4000-8000-000000000101", name: "Grace" };
const meal = { id: "00000000-0000-4000-8000-000000000200", name: "Meal" };
const joy = { id: "00000000-0000-4000-8000-000000000300", name: "Joy" };
const at = "2026-08-16T18:15";

function options(
  availability: CaptureOptions["availability"] = {
    activity: true,
    note: true,
  },
): CaptureOptions {
  return {
    activityTypes: { cursor: "types-2", records: [meal] },
    availability,
    emotions: { records: [joy] },
    people: { cursor: "people-2", records: [ada, grace] },
  };
}

const ready: CaptureAction = {
  session: {
    nameOrder: "given_family_nickname",
    status: "ready",
    workspaceId: "workspace",
  },
  type: "session",
};

function run(
  actions: readonly CaptureAction[],
  state: CaptureState = initialCaptureState({
    happenedAt: at,
    requestId: "request-1",
  }),
): CaptureState {
  return actions.reduce(captureReducer, state);
}

/** An open dialog whose options loaded, as the first open leaves it. */
function opened(
  intended?: "activity" | "note",
  given = options(),
  preferredId?: string,
): CaptureState {
  return run(
    [
      ready,
      { type: "open" },
      { happenedAt: at, options: given, type: "options" },
      { intended, type: "opened" },
    ],
    initialCaptureState({
      happenedAt: at,
      preferredId,
      requestId: "request-1",
    }),
  );
}

describe("Quick capture state", () => {
  it("starts closed, idle, and unwired", () => {
    const state = run([]);
    expect(state).toMatchObject({
      dirty: false,
      open: false,
      options: { status: "idle" },
      reconnect: "none",
      requestId: "request-1",
      session: { status: "resolving" },
      status: "",
    });
    expect(state.draft).toEqual({
      body: "",
      description: "",
      emotions: [],
      happenedAt: at,
      isFavorited: false,
      kind: "activity",
      participants: [],
      summary: "",
    });
    expect(captureControls(state)).toMatchObject({
      fields: true,
      openers: true,
      submit: true,
    });
  });

  it("wires the openers once the session is ready and explains a failed one", () => {
    expect(captureControls(run([ready])).openers).toBe(false);
    expect(
      run([{ session: { status: "access-lost" }, type: "session" }]).status,
    ).toBe(CAPTURE_MESSAGES.accessLost);
    const unavailable = run([{
      session: { status: "unavailable" },
      type: "session",
    }]);
    expect(unavailable.status).toBe(CAPTURE_MESSAGES.unavailable);
    expect(captureControls(unavailable).openers).toBe(true);
  });

  it("gates the opened dialog while its options load, except Cancel", () => {
    const loading = run([ready, { type: "open" }]);
    expect(loading).toMatchObject({
      focus: { target: "status" },
      open: true,
      options: { status: "loading" },
      status: CAPTURE_MESSAGES.loading,
    });
    expect(captureControls(loading)).toMatchObject({
      busy: true,
      cancel: false,
      fields: true,
      kind: true,
      submit: true,
    });
    expect(captureReducer(loading, { intended: "note", type: "opened" }))
      .toBe(loading);
  });

  it("keeps a failed load retryable on the next open", () => {
    const failed = run([ready, { type: "open" }, {
      happenedAt: at,
      type: "options",
    }]);
    expect(failed).toMatchObject({
      focus: { target: "status" },
      options: { status: "failed" },
      status: CAPTURE_MESSAGES.optionsFailed,
    });
    const reopened = run([
      { happenedAt: at, requestId: "request-2", type: "dismiss" },
      { type: "open" },
    ], failed);
    expect(reopened.options.status).toBe("loading");
  });

  it("reuses loaded options on a later open and focuses the kind", () => {
    const state = opened();
    expect(state).toMatchObject({
      focus: { target: "kind" },
      options: { status: "ready" },
      status: "",
    });
    const again = run([
      { happenedAt: at, requestId: "request-2", type: "dismiss" },
      { type: "open" },
    ], state);
    expect(again.options).toBe(state.options);
    expect(again.open).toBe(true);
    expect(captureControls(again)).toMatchObject({
      busy: false,
      fields: false,
      happenedAt: false,
      kind: false,
      submit: false,
    });
  });

  it("chooses the page's person in every fresh draft when the page offers one", () => {
    const state = opened(undefined, options(), grace.id);
    expect(state.draft.participants).toEqual([grace]);
    expect(
      freshDraft({ status: "ready", value: options() }, "missing", at)
        .participants,
    ).toEqual([]);
  });

  it("opens with the opener's intended kind and keeps one participant for a note", () => {
    const activity = run([{
      patch: { participants: [ada, grace] },
      type: "edit",
    }], opened("activity"));
    const note = run([{ intended: "note", type: "opened" }], activity);
    expect(note.draft.kind).toBe("note");
    expect(note.draft.participants).toEqual([ada]);
    expect(captureControls(note).happenedAt).toBe(true);
  });

  it("keeps activity and note availability independent", () => {
    const notesOnly = opened("note", options({ activity: false, note: true }));
    expect(notesOnly.draft.kind).toBe("note");
    expect(notesOnly.blocked).toBe(false);
    expect(captureControls(notesOnly).availability).toEqual({
      activity: false,
      note: true,
    });
    const fresh = freshDraft(
      { status: "ready", value: options({ activity: false, note: true }) },
      undefined,
      at,
    );
    expect(fresh.kind).toBe("note");
    const blocked = opened("note", options({ activity: true, note: false }));
    expect(blocked).toMatchObject({
      blocked: true,
      draft: { kind: "note" },
      focus: { target: "status" },
      status: CAPTURE_MESSAGES.hidden,
    });
    expect(captureControls(blocked)).toMatchObject({
      cancel: false,
      fields: true,
      submit: true,
    });
    const neither = opened(
      undefined,
      options({ activity: false, note: false }),
    );
    expect(neither.blocked).toBe(true);
    expect(neither.draft.kind).toBe("note");
    expect(kindBlocked({ activity: true, note: false }, undefined)).toBe(false);
    expect(kindBlocked({ activity: false, note: false }, undefined)).toBe(true);
  });

  it("marks the draft dirty on every edit and clears an occurrence error for a note", () => {
    const invalid = run([
      { patch: { participants: [ada], happenedAt: "" }, type: "edit" },
      { reason: "occurrence", type: "invalid" },
    ], opened());
    expect(invalid).toMatchObject({
      dirty: true,
      focus: { target: "happenedAt" },
      occurrenceError: CAPTURE_MESSAGES.occurrence,
      status: CAPTURE_MESSAGES.occurrence,
    });
    expect(
      captureReducer(invalid, { kind: "note", type: "kind" }).occurrenceError,
    ).toBe("");
    expect(
      captureReducer(invalid, { kind: "activity", type: "kind" })
        .occurrenceError,
    ).toBe(CAPTURE_MESSAGES.occurrence);
  });

  it("names why a submission was refused before it was sent", () => {
    expect(run([{ reason: "kind", type: "invalid" }], opened())).toMatchObject({
      focus: { target: "kind" },
      status: CAPTURE_MESSAGES.hidden,
    });
    expect(run([{ reason: "participants", type: "invalid" }], opened()))
      .toMatchObject({
        focus: { target: "participants" },
        status: CAPTURE_MESSAGES.noParticipants,
      });
    const refocused = run([{ target: "status", type: "focus" }], opened());
    const again = run([{ target: "status", type: "focus" }], refocused);
    expect(again.focus?.tick).toBe((refocused.focus?.tick ?? 0) + 1);
  });

  it("dismisses to a fresh draft with a new request key", () => {
    const edited = run([{
      patch: { participants: [grace], summary: "Draft" },
      type: "edit",
    }], opened(undefined, options(), ada.id));
    const dismissed = run([{
      happenedAt: "2026-08-17T09:00",
      requestId: "request-2",
      type: "dismiss",
    }], edited);
    expect(dismissed).toMatchObject({
      dirty: false,
      generation: edited.generation + 1,
      open: false,
      requestId: "request-2",
      status: "",
    });
    expect(dismissed.draft).toMatchObject({
      happenedAt: "2026-08-17T09:00",
      participants: [ada],
      summary: "",
    });
  });

  it("builds a multi-person activity with its actual time and options", () => {
    const state = run([{
      patch: {
        activityType: meal,
        description: "Talked shop",
        emotions: [joy],
        participants: [ada, grace],
        summary: "Dinner together",
      },
      type: "edit",
    }], opened());
    const submission = captureSubmission(state);
    expect(submission).toEqual({
      intent: {
        input: {
          activityTypeId: meal.id,
          description: "Talked shop",
          emotionIds: [joy.id],
          happenedAt: new Date(at).toISOString(),
          kind: "activity",
          participantIds: [ada.id, grace.id],
          requestId: "request-1",
          summary: "Dinner together",
        },
        phase: "pending",
      },
      type: "send",
    });
    if (submission.type !== "send") throw new Error("not sent");
    expect(Object.isFrozen(submission.intent.input)).toBe(true);
    const bare = captureSubmission(
      run([{ patch: { participants: [ada] }, type: "edit" }], opened()),
    );
    expect(bare).toMatchObject({
      intent: { input: { emotionIds: [], participantIds: [ada.id] } },
    });
    if (bare.type !== "send") throw new Error("not sent");
    expect(bare.intent.input).not.toHaveProperty("activityTypeId");
    expect(bare.intent.input).not.toHaveProperty("description");
  });

  it("builds a favorite note for the one chosen person", () => {
    const state = run([
      { patch: { participants: [ada, grace] }, type: "edit" },
      { kind: "note", type: "kind" },
      { patch: { body: "Keep this context", isFavorited: true }, type: "edit" },
    ], opened());
    expect(captureSubmission(state)).toEqual({
      intent: {
        input: {
          body: "Keep this context",
          isFavorited: true,
          kind: "note",
          personId: ada.id,
          requestId: "request-1",
        },
        phase: "pending",
      },
      type: "send",
    });
  });

  it("refuses a hidden kind, no participants, or a blank occurrence without sending", () => {
    expect(captureSubmission(opened())).toEqual({
      reason: "participants",
      type: "invalid",
    });
    const hiddenKind = run([
      { patch: { participants: [ada] }, type: "edit" },
      { kind: "note", type: "kind" },
    ], opened("activity", options({ activity: true, note: false })));
    expect(captureSubmission(hiddenKind)).toEqual({
      reason: "kind",
      type: "invalid",
    });
    for (const happenedAt of ["", "not a time"]) {
      expect(captureSubmission(run([{
        patch: { happenedAt, participants: [ada] },
        type: "edit",
      }], opened()))).toEqual({ reason: "occurrence", type: "invalid" });
    }
    expect(captureSubmission(run([ready, { type: "open" }]))).toEqual({
      type: "ignore",
    });
    expect(
      captureSubmission(
        opened("note", options({ activity: true, note: false })),
      ),
    ).toEqual({ type: "ignore" });
  });

  it("locks the dialog and every opener while a save is pending", () => {
    const state = run(
      [{ patch: { participants: [ada] }, type: "edit" }],
      opened(),
    );
    const submission = captureSubmission(state);
    if (submission.type !== "send") throw new Error("not sent");
    const saving = run([{ intent: submission.intent, type: "save" }], state);
    expect(saving).toMatchObject({
      intent: { phase: "pending" },
      status: CAPTURE_MESSAGES.saving,
    });
    expect(captureControls(saving)).toMatchObject({
      cancel: true,
      fields: true,
      openers: true,
      submit: true,
    });
    expect(captureSubmission(saving)).toEqual({ type: "ignore" });
    expect(run([{ type: "open" }], saving)).toBe(saving);
    expect(
      run([{ happenedAt: at, requestId: "other", type: "dismiss" }], saving),
    ).toBe(saving);
  });

  it("keeps the draft open for a sequential capture once saved", () => {
    const state = run([{
      patch: { participants: [ada], summary: "First" },
      type: "edit",
    }], opened());
    const submission = captureSubmission(state);
    if (submission.type !== "send") throw new Error("not sent");
    const saved = run([
      { intent: submission.intent, type: "save" },
      {
        happenedAt: at,
        kind: "activity",
        requestId: "request-2",
        type: "saved",
      },
    ], state);
    expect(saved).toMatchObject({
      dirty: false,
      draft: { participants: [ada], summary: "First" },
      focus: { target: "submit" },
      intent: undefined,
      open: true,
      requestId: "request-2",
      status: "Activity saved.",
    });
    expect(
      run(
        [{ happenedAt: at, kind: "note", requestId: "r", type: "saved" }],
        state,
      )
        .status,
    ).toBe("Note saved.");
  });

  it("releases a refused save with a new key and keeps an uncertain one to replay exactly", () => {
    const state = run(
      [{ patch: { participants: [ada] }, type: "edit" }],
      opened(),
    );
    const submission = captureSubmission(state);
    if (submission.type !== "send") throw new Error("not sent");
    const saving = run([{ intent: submission.intent, type: "save" }], state);
    const refused = run([{
      detail: "Restore the person first.",
      requestId: "request-2",
      type: "refused",
    }], saving);
    expect(refused).toMatchObject({
      focus: { target: "submit" },
      intent: undefined,
      reconnect: "none",
      requestId: "request-2",
      status: "Restore the person first.",
    });
    expect(captureControls(refused).fields).toBe(false);
    const uncertain = run([{ type: "uncertain" }], saving);
    expect(uncertain).toMatchObject({
      focus: { target: "submit" },
      intent: { phase: "ambiguous" },
      status: CAPTURE_MESSAGES.uncertain,
    });
    expect(captureControls(uncertain)).toMatchObject({
      fields: true,
      submit: false,
    });
    expect(captureSubmission(uncertain)).toEqual({
      intent: uncertain.intent,
      type: "send",
    });
    expect(run([{ type: "uncertain" }], state)).toBe(state);
  });

  it("checks a reconnect person and records only against them", () => {
    const checking = run([{ type: "reconnect-checking" }], opened("activity"));
    expect(checking).toMatchObject({
      focus: { target: "status" },
      reconnect: "checking",
      status: CAPTURE_MESSAGES.checking,
    });
    expect(captureControls(checking)).toMatchObject({
      busy: true,
      kind: true,
      submit: true,
    });
    const confirmed = run(
      [{ person: grace, type: "reconnect-settled" }],
      checking,
    );
    expect(confirmed).toMatchObject({
      draft: { kind: "activity", participants: [grace] },
      focus: { target: "summary" },
      reconnect: "ready",
      reconnectPersonId: grace.id,
      status: "",
    });
    expect(captureControls(confirmed)).toMatchObject({
      kind: true,
      submit: false,
    });
    const submission = captureSubmission(
      run([{ patch: { summary: "Caught up" }, type: "edit" }], confirmed),
    );
    expect(submission).toMatchObject({
      intent: { reconnectPersonId: grace.id },
      type: "send",
    });
    if (submission.type !== "send") throw new Error("not sent");
    const saved = run([
      { intent: submission.intent, type: "save" },
      {
        happenedAt: at,
        kind: "activity",
        requestId: "request-2",
        type: "saved",
      },
    ], confirmed);
    expect(saved).toMatchObject({
      dirty: false,
      draft: { participants: [], summary: "" },
      open: false,
      reconnect: "none",
      reconnectPersonId: undefined,
      requestId: "request-2",
      status: "",
    });
    const note = run([
      {
        patch: { participants: [ada] },
        type: "edit",
      },
      { kind: "note", type: "kind" },
      {
        type: "reconnect-settled",
      },
    ], opened());
    expect(captureSubmission(note)).toEqual({
      target: "status",
      type: "focus",
    });
  });

  it("degrades a reconnect it cannot confirm and after a final refusal", () => {
    const degraded = run([{ type: "reconnect-settled" }], opened("activity"));
    expect(degraded).toMatchObject({
      draft: { kind: "activity" },
      focus: { target: "status" },
      reconnect: "degraded",
      status: CAPTURE_MESSAGES.reconnectUnavailable,
    });
    expect(captureControls(degraded)).toMatchObject({
      kind: true,
      submit: true,
    });
    expect(captureSubmission(degraded)).toEqual({
      target: "status",
      type: "focus",
    });
    const confirmed = run([
      { type: "reconnect-checking" },
      { person: grace, type: "reconnect-settled" },
      { patch: { summary: "Too late" }, type: "edit" },
    ], opened("activity"));
    const submission = captureSubmission(confirmed);
    if (submission.type !== "send") throw new Error("not sent");
    const refused = run([
      { intent: submission.intent, type: "save" },
      {
        detail: "Restore every selected person.",
        requestId: "r2",
        type: "refused",
      },
    ], confirmed);
    expect(refused).toMatchObject({
      focus: { target: "status" },
      reconnect: "degraded",
      status: "Restore every selected person.",
    });
    expect(captureControls(refused).submit).toBe(true);
    const reopened = run([
      { happenedAt: at, requestId: "r3", type: "dismiss" },
      { type: "open" },
    ], refused);
    expect(reopened.reconnect).toBe("none");
  });

  it("offers a selector's page and every chosen option it lacks, at most 70", () => {
    expect(selectorOptions([ada], [grace])).toEqual([ada, grace]);
    expect(selectorOptions([ada], [{ ...ada, name: "Ada L." }])).toEqual([
      { ...ada, name: "Ada L." },
    ]);
    const many = Array.from({ length: 80 }, (_, index) => ({
      id: String(index),
      name: `Person ${index}`,
    }));
    expect(selectorOptions(many, [])).toHaveLength(70);
  });
});
