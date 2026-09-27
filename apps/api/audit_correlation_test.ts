/**
 * The request identifier reaches every audit event an actor causes.
 *
 * The HTTP kit puts the request's identifier on the actor it resolves, every
 * use case hands that actor to its module's audit port, and each module's
 * `describe…Event` forwards it as the kernel `AuditEvent.requestId` that the
 * one governance writer stores as `payload.requestId`. This suite drives every
 * public `…AuditFrom` adapter that describes an actor-caused event, plus the
 * worker's delivery event, against the recording audit fake, so a module that
 * forgets to forward the correlation fails here.
 */

import type { AuditEventRecorder } from "../../packages/backend/shared-kernel/audit_event.ts";
import { assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingAudit } from "../../packages/backend/testing/fakes.ts";
import { sessionActor, uuid } from "../../packages/backend/testing/fixtures.ts";
import { apiTokenAuditFrom } from "../../packages/backend/modules/api-access/public.ts";
import { fileAuditFrom } from "../../packages/backend/modules/files/public.ts";
import { giftAuditFrom } from "../../packages/backend/modules/gifts/public.ts";
import {
  exportAuditFrom,
  importAuditFrom,
} from "../../packages/backend/modules/governance/public.ts";
import { davAuditFrom } from "../../packages/backend/modules/integrations/public.ts";
import {
  communicationAuditFrom,
  interactionAuditFrom,
} from "../../packages/backend/modules/interactions/public.ts";
import {
  journalAuditFrom,
  lifeEventAuditFrom,
} from "../../packages/backend/modules/journal/public.ts";
import {
  importantDateAuditFrom,
  personAvatarAuditFrom,
  personCreatedAuditFrom,
  personLifecycleAuditFrom,
  personMergeAuditFrom,
  profileFactAuditFrom,
} from "../../packages/backend/modules/people/public.ts";
import {
  reminderAuditFrom,
  reminderDeliveryAuditFrom,
  taskAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { relationshipAuditFrom } from "../../packages/backend/modules/relationships/public.ts";
import { settingsAuditFrom } from "../../packages/backend/modules/workspaces/public.ts";

const REQUEST_ID = "3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d";
const OCCURRED_AT = new Date("2026-09-26T10:00:00.000Z");
const PERSON = uuid(100);
const SUBJECT = uuid(200);
const transaction = { opaque: "transaction" };

type Writer = (
  recorder: AuditEventRecorder,
  actor: ReturnType<typeof actorWith>,
) => Promise<unknown>;

function actorWith(requestId?: string) {
  const { memberId, role, userId, workspaceId } = sessionActor();
  return {
    memberId,
    role,
    userId,
    workspaceId,
    ...(requestId ? { requestId } : {}),
  };
}

/**
 * Each writer, with the least of its command the description reads. The
 * commands are cast because each port's full command type belongs to its
 * module; what this suite pins is the one member every one of them forwards.
 */
const WRITERS: ReadonlyArray<readonly [string, Writer]> = [
  ["api-access token", (recorder, actor) =>
    apiTokenAuditFrom(recorder).record({
      action: "created",
      actor,
      occurredAt: OCCURRED_AT,
      record: { id: SUBJECT, scopes: ["people:read"] },
      transaction,
    } as never)],
  ["files file", (recorder, actor) =>
    fileAuditFrom(recorder).record({
      action: "created",
      actor,
      file: {
        fileId: SUBJECT,
        kind: "document",
        personId: PERSON,
        status: "available",
      },
      occurredAt: OCCURRED_AT,
      transaction,
    } as never)],
  ["gifts gift", (recorder, actor) =>
    giftAuditFrom(recorder).record({
      action: "create",
      actor,
      occurredAt: OCCURRED_AT,
      record: { id: SUBJECT, personId: PERSON, status: "idea" },
      recordType: "gift",
      transaction,
    } as never)],
  ["governance export", (recorder, actor) =>
    exportAuditFrom(recorder).record({
      action: "requested",
      actor,
      exportId: SUBJECT,
      occurredAt: OCCURRED_AT,
      payload: { format: "json" },
      transaction,
    })],
  [
    "governance vCard download",
    (recorder, actor) =>
      exportAuditFrom(recorder).recordPersonDownload({
        actor,
        occurredAt: OCCURRED_AT,
        personId: PERSON,
        transaction,
      }),
  ],
  ["governance import", (recorder, actor) =>
    importAuditFrom(recorder).record({
      action: "started",
      actor,
      importId: SUBJECT,
      occurredAt: OCCURRED_AT,
      payload: {},
      transaction,
    })],
  ["integrations DAV", (recorder, actor) =>
    davAuditFrom(recorder).record({
      actor,
      event: {
        action: "sync",
        occurredAt: OCCURRED_AT,
        outcome: "succeeded",
        subscriptionId: SUBJECT,
      },
      transaction,
    } as never)],
  [
    "interactions note",
    (recorder, actor) =>
      interactionAuditFrom(recorder).record({
        actor,
        occurredAt: OCCURRED_AT,
        record: { id: SUBJECT, kind: "note", person: { id: PERSON } },
        transaction,
      } as never),
  ],
  [
    "interactions communication",
    (recorder, actor) =>
      communicationAuditFrom(recorder).record({
        actor,
        occurredAt: OCCURRED_AT,
        record: { id: SUBJECT, kind: "call", person: { id: PERSON } },
        transaction,
      } as never),
  ],
  ["journal item", (recorder, actor) =>
    journalAuditFrom(recorder).record({
      action: "created",
      actor,
      itemId: SUBJECT,
      itemType: "entry",
      occurredAt: OCCURRED_AT,
      transaction,
    } as never)],
  [
    "journal life event",
    (recorder, actor) =>
      lifeEventAuditFrom(recorder).record({
        action: "updated",
        actor,
        lifeEventId: SUBJECT,
        occurredAt: OCCURRED_AT,
        personId: PERSON,
        transaction,
      }),
  ],
  [
    "people person created",
    (recorder, actor) =>
      personCreatedAuditFrom(recorder).record({
        actor,
        occurredAt: OCCURRED_AT,
        person: { id: PERSON, isPartial: false },
        transaction,
      } as never),
  ],
  [
    "people lifecycle",
    (recorder, actor) =>
      personLifecycleAuditFrom(recorder).record({
        action: "archive",
        actor,
        before: { lifecycle: "active" },
        occurredAt: OCCURRED_AT,
        person: { id: PERSON, lifecycle: "archived" },
        transaction,
      } as never),
  ],
  [
    "people important date",
    (recorder, actor) =>
      importantDateAuditFrom(recorder).record({
        action: "create",
        actor,
        after: {
          id: SUBJECT,
          isYearApproximate: false,
          personId: PERSON,
          precision: "full",
        },
        occurredAt: OCCURRED_AT,
        transaction,
      } as never),
  ],
  [
    "people avatar",
    (recorder, actor) =>
      personAvatarAuditFrom(recorder).record({
        action: "updated",
        actor,
        occurredAt: OCCURRED_AT,
        personId: PERSON,
        transaction,
      }),
  ],
  [
    "people merge",
    (recorder, actor) =>
      personMergeAuditFrom(recorder).record({
        actor,
        discarded: [],
        duplicateId: SUBJECT,
        occurredAt: OCCURRED_AT,
        primaryId: PERSON,
        tables: {},
        transaction,
      }),
  ],
  [
    "people profile fact",
    (recorder, actor) =>
      profileFactAuditFrom(recorder).record({
        action: "create",
        actor,
        after: { id: SUBJECT, section: "food-preferences" },
        occurredAt: OCCURRED_AT,
        personId: PERSON,
        transaction,
      } as never),
  ],
  [
    "planning reminder",
    (recorder, actor) =>
      reminderAuditFrom(recorder).record({
        action: "created",
        actor,
        occurredAt: OCCURRED_AT,
        subjectId: SUBJECT,
        transaction,
      } as never),
  ],
  ["planning task", (recorder, actor) =>
    taskAuditFrom(recorder).record({
      action: "create",
      actor,
      occurredAt: OCCURRED_AT,
      task: { id: SUBJECT, personId: PERSON, status: "open" },
      transaction,
    } as never)],
  [
    "relationships edge",
    (recorder, actor) =>
      relationshipAuditFrom(recorder).record({
        action: "create",
        actor,
        after: {
          fromPersonId: PERSON,
          id: SUBJECT,
          relationshipTypeId: uuid(300),
          toPersonId: uuid(101),
        },
        occurredAt: OCCURRED_AT,
        transaction,
      } as never),
  ],
  [
    "workspaces settings",
    (recorder, actor) =>
      settingsAuditFrom(recorder).record({
        action: "member.profile-updated",
        actor,
        occurredAt: OCCURRED_AT,
        payload: {},
        subjectId: actor.memberId,
        subjectType: "workspace_member",
        transaction,
      } as never),
  ],
];

Deno.test("[GAP-039] every actor-caused audit event carries the actor's request identifier", async () => {
  for (const [name, write] of WRITERS) {
    const audit = recordingAudit();
    await write(audit, actorWith(REQUEST_ID));
    assertEquals(audit.commands.length, 1, `${name} wrote one event`);
    assertEquals(
      audit.commands[0]?.event.requestId,
      REQUEST_ID,
      `${name} forwards the request identifier`,
    );
  }
});

Deno.test("[GAP-039] an actor without a request identifier adds no member", async () => {
  for (const [name, write] of WRITERS) {
    const audit = recordingAudit();
    await write(audit, actorWith());
    assertEquals(
      audit.commands.map(({ event }) => Object.hasOwn(event, "requestId")),
      [false],
      `${name} describes an uncorrelated event without the member`,
    );
  }
});

Deno.test("[GAP-039] a worker delivery event carries its job run's identifier", async () => {
  const occurrence = {
    attemptCount: 1,
    id: SUBJECT,
    personId: PERSON,
    workspaceId: uuid(3),
  };
  const audit = recordingAudit();
  await reminderDeliveryAuditFrom(audit).record({
    action: "delivered",
    occurrence,
    occurredAt: OCCURRED_AT,
    requestId: REQUEST_ID,
    transaction,
  } as never);
  await reminderDeliveryAuditFrom(audit).record({
    action: "failed",
    occurrence,
    occurredAt: OCCURRED_AT,
    transaction,
  } as never);

  assertEquals(
    audit.commands.map(({ event }) => event.requestId ?? null),
    [REQUEST_ID, null],
    "the run's identifier, or no member for an uncorrelated run",
  );
});
