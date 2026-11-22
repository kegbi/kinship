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
  let refills = 0;
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
      refillOtherMembers: () => {
        refills += 1;
        return Promise.resolve();
      },
      regenerateForWorkspaceTimezone: () => Promise.resolve(),
      setReminderActive: (command) =>
        Promise.resolve(
          saved ? { reminder: saved, wasActive: !command.active } : undefined,
        ),
      updateCadenceFromInteraction(command) {
        interactions.push([...command.personIds]);
        return Promise.resolve();
      },
      deleteCadence: () => Promise.resolve(false),
      deleteReminder: () => Promise.resolve(false),
      findCadence: () => Promise.resolve(undefined),
      findReminderForChange: () => Promise.resolve(undefined),
      reminderDeleted: () => Promise.resolve(false),
      saveReminder: () => Promise.resolve(undefined),
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
  personStatus = "not-found";
  const unknownList = await management.listPerson(actor, personId);
  personStatus = "archived";
  const archivedList = await management.listPerson(actor, personId);
  personStatus = "ready";
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
    listed.status !== "ready" || unknownList.status !== "not-found" ||
    archivedList.status !== "ready" || cancellations !== 1 ||
    interactions.length !== 1 ||
    interactions[0]?.join(",") !== [personId, reminder.id].sort().join(",") ||
    regenerations !== 1 ||
    // Re-enabling refills every other member who held the reminder's work;
    // disabling does not.
    refills !== 1 ||
    !audits.includes("cadence-created") || !audits.includes("disabled")
  ) {
    throw new Error(JSON.stringify({
      active,
      archived,
      archivedList,
      audits,
      cancellations,
      conflict,
      refills,
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
      unknownList,
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

Deno.test("[MCP-D2] a member edits and deletes their own reminder and cadence by revision", async () => {
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const personId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  let reminder: planning.ReminderDefinitionRecord | undefined;
  let source = { canDelete: true, targetKind: "person" };
  let deletedReminderId: string | undefined;
  let cadence: planning.StayInTouchCadenceRecord | undefined = {
    id: crypto.randomUUID(),
    intervalCount: 2,
    intervalUnit: "week",
    isActive: true,
    nextDueAt: "2026-09-01T10:00:00.000Z",
    personId,
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  let authorized = true;
  let personStatus: "archived" | "not-found" | "ready" = "ready";
  const audits: { action: string; subjectId: string }[] = [];
  const steps: string[] = [];
  const tick = (value: string) => new Date(Date.parse(value) + 1).toISOString();
  const management = planning.createReminderManagement({
    actors: {
      revalidate: () =>
        Promise.resolve(authorized ? "active" as const : "revoked" as const),
    },
    audit: {
      record(command) {
        audits.push({ action: command.action, subjectId: command.subjectId });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-18T10:00:00.000Z"),
    people: {
      inspect: (command) => {
        steps.push(`person:${command.personIds.join(",")}:${command.lock}`);
        return Promise.resolve({ status: personStatus });
      },
      summarize: () => Promise.resolve([]),
    },
    repository: ({
      cancelFutureOccurrences: (command) => {
        steps.push(`cancel:${command.reminderId}`);
        return Promise.resolve();
      },
      createReminder: (command) => {
        reminder = {
          anchorOn: command.anchorOn,
          createdAt: command.occurredAt.toISOString(),
          id: command.id,
          isActive: true,
          personId: command.personId,
          recurrenceInterval: command.recurrenceInterval,
          recurrenceUnit: command.recurrenceUnit,
          sendTime: command.sendTime,
          title: command.title,
          updatedAt: command.occurredAt.toISOString(),
        };
        return Promise.resolve(reminder);
      },
      deleteCadence: (command) => {
        if (cadence?.updatedAt !== command.expectedUpdatedAt) {
          return Promise.resolve(false);
        }
        cadence = undefined;
        return Promise.resolve(true);
      },
      deleteReminder: (command) => {
        if (reminder?.updatedAt !== command.expectedUpdatedAt) {
          return Promise.resolve(false);
        }
        deletedReminderId = reminder.id;
        reminder = undefined;
        return Promise.resolve(true);
      },
      findCadence: (command) =>
        Promise.resolve(cadence?.id === command.id ? cadence : undefined),
      findReminder: (command) =>
        Promise.resolve(reminder?.id === command.id ? reminder : undefined),
      findReminderForChange: (command) =>
        Promise.resolve(
          reminder?.id === command.id ? { reminder, source } : undefined,
        ),
      lockRequest: () => Promise.resolve(),
      refillOtherMembers: (command) => {
        steps.push(`refill:${command.reminderId}:${command.memberId}`);
        return Promise.resolve();
      },
      reminderDeleted: (command) =>
        Promise.resolve(command.id === deletedReminderId),
      saveReminder: (command) => {
        if (reminder?.updatedAt !== command.expectedUpdatedAt) {
          return Promise.resolve(undefined);
        }
        reminder = {
          ...reminder,
          ...command.patch,
          updatedAt: tick(reminder.updatedAt),
        };
        steps.push(`save:${JSON.stringify(command.patch)}`);
        return Promise.resolve(reminder);
      },
      upsertOccurrences: (command) => {
        steps.push(
          `mint:${command.reminder.title}:${command.occurrences.length}`,
        );
        return Promise.resolve([{
          attemptCount: 0,
          deliverAt: command.occurrences[0]!.deliverAt,
          id: crypto.randomUUID(),
          occursOn: command.occurrences[0]!.occursOn,
          status: "pending" as const,
        }]);
      },
    } satisfies Partial<
      planning.ReminderRepository
    >) as unknown as planning.ReminderRepository,
    transaction: { run: (work) => work({ opaque: "tx" }) },
    workspace: {
      effectiveTimezone: () =>
        Promise.resolve({ status: "ready" as const, timezone: "UTC" }),
    },
  });
  const input = {
    anchorOn: "2026-08-20",
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "month" as const,
    requestId,
    sendTime: "09:00",
    title: "Call Ada",
  };
  const created = await management.createReminder(actor, input);
  if (created.status !== "created" || !("reminder" in created)) {
    throw new Error(`fixture reminder: ${JSON.stringify(created)}`);
  }
  const id = created.reminder.id;
  const revision = created.reminder.updatedAt;
  const statuses: Record<string, string> = {};
  statuses.malformed = (await management.editReminder(actor, "bad", {
    expectedUpdatedAt: revision,
    title: "x",
  })).status;
  statuses.empty = (await management.editReminder(actor, id, {
    expectedUpdatedAt: revision,
  })).status;
  authorized = false;
  statuses.forbidden = (await management.editReminder(actor, id, {
    expectedUpdatedAt: revision,
    title: "Forbidden",
  })).status;
  authorized = true;
  statuses.missing = (await management.editReminder(
    actor,
    crypto.randomUUID(),
    { expectedUpdatedAt: revision, title: "Missing" },
  )).status;
  statuses.stale = (await management.editReminder(actor, id, {
    expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
    title: "Stale",
  })).status;
  source = { canDelete: false, targetKind: "person_date" };
  statuses.managedEdit = (await management.editReminder(actor, id, {
    expectedUpdatedAt: revision,
    title: "Birthday",
  })).status;
  statuses.managedDelete = (await management.deleteReminder(actor, id, {
    expectedUpdatedAt: revision,
  })).status;
  source = { canDelete: true, targetKind: "person" };
  personStatus = "archived";
  statuses.archived = (await management.editReminder(actor, id, {
    expectedUpdatedAt: revision,
    title: "Archived",
  })).status;
  personStatus = "ready";
  statuses.unchanged = (await management.editReminder(actor, id, {
    expectedUpdatedAt: revision,
    sendTime: "09:00",
    title: " Call Ada ",
  })).status;
  steps.length = 0;
  const edited = await management.editReminder(actor, id.toUpperCase(), {
    expectedUpdatedAt: revision,
    recurrenceUnit: "week",
    title: "Call Ada weekly",
  });
  if (edited.status !== "saved") {
    throw new Error(`edit: ${JSON.stringify(edited)}`);
  }
  // The person is locked before the reminder, as a create does, and the
  // future is replaced the way disabling and re-enabling would replace it:
  // for every other member who held it, then for the editor.
  if (
    JSON.stringify(steps) !== JSON.stringify([
        `person:${personId}:true`,
        `save:${
          JSON.stringify({ recurrenceUnit: "week", title: "Call Ada weekly" })
        }`,
        `cancel:${id}`,
        `refill:${id}:${actor.memberId}`,
        "mint:Call Ada weekly:8",
      ]) ||
    edited.reminder.recurrenceUnit !== "week" ||
    !edited.reminder.nextOccurrence
  ) throw new Error(`edit steps: ${JSON.stringify({ edited, steps })}`);
  reminder = { ...reminder!, isActive: false };
  steps.length = 0;
  const inactive = await management.editReminder(actor, id, {
    anchorOn: "2026-09-01",
    expectedUpdatedAt: reminder.updatedAt,
  });
  if (
    inactive.status !== "saved" ||
    steps.some((step) => step.startsWith("mint:") || step.startsWith("refill:"))
  ) throw new Error(`a disabled reminder minted: ${JSON.stringify(steps)}`);
  statuses.deleteStale = (await management.deleteReminder(actor, id, {
    expectedUpdatedAt: revision,
  })).status;
  steps.length = 0;
  const deleted = await management.deleteReminder(actor, id, {
    expectedUpdatedAt: reminder.updatedAt,
  });
  if (
    deleted.status !== "deleted" || deleted.reminderId !== id ||
    !steps.includes(`cancel:${id}`) ||
    steps.some((step) => step.startsWith("refill:"))
  ) throw new Error(`delete: ${JSON.stringify({ deleted, steps })}`);
  statuses.deletedAgain = (await management.deleteReminder(actor, id, {
    expectedUpdatedAt: revision,
  })).status;
  statuses.recreate = (await management.createReminder(actor, input)).status;

  const cadenceId = cadence!.id;
  const cadenceRevision = cadence!.updatedAt;
  statuses.cadenceMalformed = (await management.deleteCadence(actor, "bad", {
    expectedUpdatedAt: cadenceRevision,
  })).status;
  statuses.cadenceStale = (await management.deleteCadence(actor, cadenceId, {
    expectedUpdatedAt: "2025-01-01T00:00:00.000Z",
  })).status;
  personStatus = "archived";
  statuses.cadenceArchived = (await management.deleteCadence(
    actor,
    cadenceId,
    { expectedUpdatedAt: cadenceRevision },
  )).status;
  personStatus = "ready";
  authorized = false;
  statuses.cadenceForbidden = (await management.deleteCadence(
    actor,
    cadenceId,
    { expectedUpdatedAt: cadenceRevision },
  )).status;
  authorized = true;
  const cadenceDeleted = await management.deleteCadence(actor, cadenceId, {
    expectedUpdatedAt: cadenceRevision,
  });
  statuses.cadenceDeleted = cadenceDeleted.status;
  statuses.cadenceAgain = (await management.deleteCadence(actor, cadenceId, {
    expectedUpdatedAt: cadenceRevision,
  })).status;

  const expected = {
    malformed: "validation-error",
    empty: "validation-error",
    forbidden: "forbidden",
    missing: "not-found",
    stale: "stale",
    managedEdit: "managed-reminder",
    managedDelete: "managed-reminder",
    archived: "archived-write-rejected",
    unchanged: "unchanged",
    deleteStale: "stale",
    deletedAgain: "not-found",
    recreate: "request-deleted",
    cadenceMalformed: "validation-error",
    cadenceStale: "stale",
    cadenceArchived: "archived-write-rejected",
    cadenceForbidden: "forbidden",
    cadenceDeleted: "deleted",
    cadenceAgain: "not-found",
  };
  if (JSON.stringify(statuses) !== JSON.stringify(expected)) {
    throw new Error(`statuses: ${JSON.stringify(statuses)}`);
  }
  const actions = audits.map((entry) => entry.action);
  if (
    JSON.stringify(actions) !== JSON.stringify([
        "created",
        "generated",
        "edited",
        "generated",
        "edited",
        "deleted",
        "cadence-deleted",
      ]) || audits.at(-1)?.subjectId !== cadenceId
  ) throw new Error(`audits: ${JSON.stringify(audits)}`);
  const event = describeReminderEvent({
    action: "cadence-deleted",
    actor,
    occurredAt: new Date("2026-08-18T10:00:00.000Z"),
    subjectId: cadenceId,
    transaction: { opaque: "tx" },
  });
  if (
    event.action !== "planning.reminder-cadence-deleted" ||
    event.subjectType !== "stay_in_touch_cadence"
  ) throw new Error(`cadence deletion event: ${JSON.stringify(event)}`);
});
