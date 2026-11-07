import * as planning from "../public.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import { describeReminderEvent } from "./audit_events.ts";

Deno.test("PLANNING-002 exposes calendar reminder management", () => {
  const publicPlanning = planning as unknown as Record<string, unknown>;
  if (typeof publicPlanning.createReminderManagement !== "function") {
    throw new Error("calendar reminder management is not public");
  }
});

Deno.test("PLANNING-002 management preserves validation, authorization, replay, and disable boundaries", async () => {
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const personId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const reminder: planning.ReminderDefinitionRecord = {
    anchorOn: "2026-08-20",
    createdAt: "2026-08-18T10:00:00.000Z",
    id: crypto.randomUUID(),
    isActive: true,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "month",
    sendTime: "09:00:00",
    title: "Call Ada",
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  const cadence: planning.StayInTouchCadenceRecord = {
    id: crypto.randomUUID(),
    intervalCount: 1,
    intervalUnit: "month",
    isActive: true,
    nextDueAt: "2026-09-18T10:00:00.000Z",
    personId,
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  let authorized = true;
  let timezoneReady = true;
  let personStatus: "archived" | "not-found" | "ready" = "ready";
  let replay: planning.ReminderDefinitionRecord | undefined;
  let created: planning.ReminderDefinitionRecord | undefined = reminder;
  let saved: planning.ReminderDefinitionRecord | undefined = reminder;
  let savedCadence: planning.StayInTouchCadenceRecord | undefined = cadence;
  let cadenceReplay:
    | { cadence: planning.StayInTouchCadenceRecord; requestFingerprint: string }
    | undefined;
  let cadenceFingerprint = "";
  let generated = true;
  const audits: string[] = [];
  const interactions: string[][] = [];
  let cancellations = 0;
  let regenerations = 0;
  const management = planning.createReminderManagement({
    actors: {
      revalidate: () =>
        Promise.resolve(authorized ? "active" as const : "revoked" as const),
    },
    audit: {
      record(command) {
        audits.push(command.action);
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-18T10:00:00.000Z"),
    people: {
      inspect: () => Promise.resolve({ status: personStatus }),
      summarize: () => Promise.resolve([]),
    },
    repository: {
      acknowledgeUndelivered: () => Promise.resolve(undefined),
      cancelFutureOccurrences: () => {
        cancellations += 1;
        return Promise.resolve();
      },
      createReminder: () => Promise.resolve(created),
      findCadenceRequest: () => Promise.resolve(cadenceReplay),
      findReminder: () => Promise.resolve(replay),
      listPerson: () =>
        Promise.resolve({ cadences: [cadence], reminders: [reminder] }),
      lockRequest: () => Promise.resolve(),
      regenerateForTimezone: () => {
        regenerations += 1;
        return Promise.resolve();
      },
      rechannelMember: () => Promise.resolve(),
      regenerateForWorkspaceTimezone: () => Promise.resolve(),
      setReminderActive: (command) =>
        Promise.resolve(
          saved ? { reminder: saved, wasActive: !command.active } : undefined,
        ),
      updateCadenceFromInteraction(command) {
        interactions.push([...command.personIds]);
        return Promise.resolve();
      },
      upsertCadence: (command) => {
        cadenceFingerprint = command.requestFingerprint;
        return Promise.resolve(savedCadence);
      },
      upsertOccurrences: (_command) =>
        Promise.resolve(
          generated
            ? [{
              attemptCount: 0,
              deliverAt: "2026-08-20T07:00:00Z",
              id: crypto.randomUUID(),
              occursOn: "2026-08-20",
              status: "pending" as const,
            }]
            : [],
        ),
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
    workspace: {
      effectiveTimezone: () =>
        Promise.resolve(
          timezoneReady
            ? { status: "ready" as const, timezone: "Europe/Belgrade" }
            : { status: "forbidden" as const },
        ),
    },
  });
  const input = {
    anchorOn: reminder.anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "month" as const,
    requestId,
    sendTime: "09:00",
    title: reminder.title,
  };
  const invalid = await management.createReminder(actor, {
    ...input,
    anchorOn: "2026-02-30",
    personId: "bad",
    recurrenceInterval: 0,
    requestId: "bad",
    sendTime: "25:00",
    title: " ",
  });
  const invalidCadence = await management.createCadence(actor, {
    intervalCount: 101,
    intervalUnit: "week",
    personId: "bad",
    requestId: "bad",
  });
  timezoneReady = false;
  const forbidden = await management.createReminder(actor, input);
  timezoneReady = true;
  personStatus = "archived";
  const archived = await management.createReminder(actor, input);
  personStatus = "ready";
  replay = reminder;
  const replayed = await management.createReminder(actor, input);
  replay = { ...reminder, title: "Different" };
  const conflict = await management.createReminder(actor, input);
  replay = undefined;
  created = undefined;
  const missing = await management.createReminder(actor, input);
  created = reminder;
  generated = false;
  const withoutOccurrence = await management.createReminder(actor, {
    ...input,
    requestId: crypto.randomUUID(),
  });
  savedCadence = undefined;
  const missingCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: crypto.randomUUID(),
  });
  savedCadence = cadence;
  const cadenceRequestId = crypto.randomUUID();
  const createdCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  cadenceReplay = { cadence, requestFingerprint: cadenceFingerprint };
  const replayedCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  const changedCadenceReplay = await management.createCadence(actor, {
    intervalCount: 2,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  const crossPersonCadenceReplay = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId: crypto.randomUUID(),
    requestId: cadenceRequestId,
  });
  cadenceReplay = undefined;
  authorized = false;
  const forbiddenSave = await management.setActive(actor, reminder.id, false);
  const forbiddenList = await management.listPerson(actor, personId);
  authorized = true;
  saved = undefined;
  const missingSave = await management.setActive(actor, reminder.id, false);
  saved = reminder;
  const active = await management.setActive(actor, reminder.id, true);
  const disabled = await management.setActive(actor, reminder.id, false);
  const listed = await management.listPerson(actor, personId);
  await management.interactionRecorded({
    happenedAt: "invalid",
    memberId: actor.memberId,
    personIds: [personId],
    transaction: { opaque: "tx" },
    workspaceId: actor.workspaceId,
  });
  timezoneReady = false;
  await management.timezoneChanged(actor, { opaque: "tx" });
  timezoneReady = true;
  await management.timezoneChanged(actor, { opaque: "tx" });
  await management.interactionRecorded({
    happenedAt: "2026-08-18T12:00:00Z",
    memberId: actor.memberId,
    personIds: [personId, personId, reminder.id],
    transaction: { opaque: "tx" },
    workspaceId: actor.workspaceId,
  });
  if (
    invalid.status !== "validation-error" ||
    invalidCadence.status !== "validation-error" ||
    forbidden.status !== "forbidden" ||
    archived.status !== "archived-write-rejected" ||
    replayed.status !== "created" ||
    conflict.status !== "idempotency-conflict" ||
    missing.status !== "not-found" || withoutOccurrence.status !== "created" ||
    missingCadence.status !== "not-found" ||
    createdCadence.status !== "created" ||
    replayedCadence.status !== "created" ||
    changedCadenceReplay.status !== "idempotency-conflict" ||
    crossPersonCadenceReplay.status !== "idempotency-conflict" ||
    forbiddenSave.status !== "forbidden" ||
    forbiddenList.status !== "forbidden" ||
    missingSave.status !== "not-found" || active.status !== "saved" ||
    disabled.status !== "saved" ||
    listed.status !== "ready" || cancellations !== 1 ||
    interactions.length !== 1 ||
    interactions[0]?.join(",") !== [personId, reminder.id].sort().join(",") ||
    regenerations !== 1 ||
    !audits.includes("cadence-created") || !audits.includes("disabled")
  ) {
    throw new Error(JSON.stringify({
      active,
      archived,
      audits,
      cancellations,
      conflict,
      changedCadenceReplay,
      createdCadence,
      crossPersonCadenceReplay,
      disabled,
      forbidden,
      forbiddenList,
      forbiddenSave,
      interactions,
      invalid,
      invalidCadence,
      listed,
      missing,
      missingCadence,
      missingSave,
      replayed,
      replayedCadence,
      withoutOccurrence,
    }));
  }
});

Deno.test("[PLANNING-003] REL-088 a member acknowledges their own undelivered reminder once", async () => {
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const occurrenceId = crypto.randomUUID();
  let authorized = true;
  let stored: "acknowledged" | "stale" | "unchanged" | undefined =
    "acknowledged";
  const asked: unknown[] = [];
  const audits: { action: string; subjectId: string }[] = [];
  const management = planning.createReminderManagement({
    actors: {
      revalidate: () =>
        Promise.resolve(authorized ? "active" as const : "revoked" as const),
    },
    audit: {
      record(command) {
        audits.push({
          action: command.action,
          subjectId: command.subjectId,
        });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-09-28T10:00:00.000Z"),
    people: {} as never,
    repository: {
      acknowledgeUndelivered(
        command: Parameters<
          planning.ReminderRepository["acknowledgeUndelivered"]
        >[0],
      ) {
        asked.push({
          id: command.id,
          memberId: command.memberId,
          now: command.now.toISOString(),
          workspaceId: command.workspaceId,
        });
        return Promise.resolve(stored);
      },
    } as unknown as planning.ReminderRepository,
    transaction: { run: (work) => work({ opaque: "tx" }) },
    workspace: {} as never,
  });

  const acknowledged = await management.acknowledgeOccurrence(
    actor,
    occurrenceId.toUpperCase(),
  );
  stored = "unchanged";
  const replayed = await management.acknowledgeOccurrence(actor, occurrenceId);
  stored = "stale";
  const stale = await management.acknowledgeOccurrence(actor, occurrenceId);
  stored = undefined;
  const missing = await management.acknowledgeOccurrence(actor, occurrenceId);
  authorized = false;
  const forbidden = await management.acknowledgeOccurrence(
    actor,
    occurrenceId,
  );

  const outcomes = [acknowledged, replayed, stale, missing, forbidden].map(
    (result) => result.status,
  );
  if (
    JSON.stringify(outcomes) !== JSON.stringify([
      "acknowledged",
      "acknowledged",
      "stale",
      "not-found",
      "forbidden",
    ])
  ) throw new Error(`acknowledgement outcomes: ${JSON.stringify(outcomes)}`);
  if (
    JSON.stringify(asked[0]) !== JSON.stringify({
        id: occurrenceId,
        memberId: actor.memberId,
        now: "2026-09-28T10:00:00.000Z",
        workspaceId: actor.workspaceId,
      }) || asked.length !== 4
  ) {
    throw new Error(`the repository was asked: ${JSON.stringify(asked)}`);
  }
  // Only the write that changed a row is audited; a replay is not.
  if (
    JSON.stringify(audits) !== JSON.stringify([
      { action: "acknowledged", subjectId: occurrenceId },
    ])
  ) throw new Error(`acknowledgement audits: ${JSON.stringify(audits)}`);
  const event = describeReminderEvent({
    action: "acknowledged",
    actor,
    occurredAt: new Date("2026-09-28T10:00:00.000Z"),
    subjectId: occurrenceId,
    transaction: { opaque: "tx" },
  });
  if (
    event.action !== "planning.reminder-acknowledged" ||
    event.subjectType !== "reminder_occurrence" ||
    event.actorMemberId !== actor.memberId
  ) throw new Error(`acknowledgement event: ${JSON.stringify(event)}`);
});
