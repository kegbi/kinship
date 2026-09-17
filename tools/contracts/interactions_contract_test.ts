import { buildOpenApiDocument } from "./document.ts";
import type {
  ActivityReport,
  Interaction,
  InteractionInput,
  TodayRecentActivity,
} from "../../packages/contracts/generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("INTERACTION-001 OpenAPI versions strict mutation and projection boundaries", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, unknown>>;
    readonly components: {
      readonly schemas: Readonly<
        Record<string, {
          readonly additionalProperties?: boolean;
          readonly oneOf?: readonly unknown[];
          readonly required?: readonly string[];
          readonly properties?: Readonly<
            Record<string, {
              readonly description?: string;
              readonly items?: { readonly $ref?: string };
              readonly maxItems?: number;
              readonly minItems?: number;
            }>
          >;
        }>
      >;
    };
  };
  for (
    const path of [
      "/api/v1/interactions",
      "/api/v1/interaction-options",
      "/api/v1/communication-options",
      "/api/v1/people/{personId}/activity-report",
      "/api/v1/people/{personId}/communications",
      "/api/v1/today/favorite-notes",
      "/api/v1/today/recent-activity",
    ]
  ) {
    assert(Boolean(document.paths[path]), `${path} is not versioned`);
  }
  assert(
    !document.paths["/api/v1/today/interactions"],
    "combined Today interaction endpoint bypasses independent region retries",
  );
  for (
    const schema of [
      document.components.schemas.ActivityInteractionInput,
      document.components.schemas.NoteInteractionInput,
    ]
  ) {
    assert(
      schema?.properties?.requestId?.description?.includes(
        "workspace-scoped aggregate identifier",
      ) === true,
      "requestId does not document its workspace-scoped aggregate mapping",
    );
  }
  assert(
    document.components.schemas.InteractionInput?.oneOf?.length === 4 &&
      document.components.schemas.ActivityInteractionInput
          ?.additionalProperties === false &&
      document.components.schemas.NoteInteractionInput
          ?.additionalProperties === false,
    "activity/note mutation inputs are not a closed union",
  );
  assert(
    document.components.schemas.ActivityOrNoteInteraction?.oneOf?.length ===
        2 &&
      document.components.schemas.ActivityReport?.properties?.items?.items
          ?.$ref ===
        "#/components/schemas/ActivityOrNoteInteraction" &&
      document.components.schemas.TodayRecentActivity?.properties?.items?.items
          ?.$ref === "#/components/schemas/ActivityOrNoteInteraction",
    "activity report and Today recent activity lost their precise projection union",
  );
  assert(
    document.components.schemas.ConversationInteraction?.required?.includes(
      "channelType",
    ) === false,
    "historical conversations still require a channel that canonical data may clear",
  );
  const operation = (path: string) =>
    document.paths[path] as {
      readonly get?: {
        readonly parameters?: readonly {
          readonly in?: string;
          readonly name?: string;
          readonly schema?: { readonly enum?: readonly string[] };
        }[];
        readonly responses?: Readonly<Record<string, unknown>>;
      };
    };
  const peopleKind = operation("/api/v1/people").get?.parameters?.find((
    parameter,
  ) => parameter.in === "query" && parameter.name === "kind");
  const reportKind = operation("/api/v1/people/{personId}/activity-report")
    .get?.parameters?.find((parameter) =>
      parameter.in === "query" && parameter.name === "kind"
    );
  assert(!peopleKind, "activity-report kind leaked into list people");
  assert(
    reportKind?.schema?.enum?.join(",") === "activity,note",
    "activity-report kind filter is not documented as a strict enum",
  );
  const optionResponses = operation("/api/v1/interaction-options").get
    ?.responses;
  assert(
    Boolean(optionResponses?.["400"]),
    "interaction options invalid query response is not documented",
  );
  assert(
    Boolean(optionResponses?.["409"]),
    "interaction options stale cursor response is not documented",
  );
  const activity: InteractionInput = {
    happenedAt: "2026-08-16T18:15:00.000Z",
    kind: "activity",
    participantIds: [crypto.randomUUID()],
    requestId: crypto.randomUUID(),
    summary: "Dinner",
  };
  const call: InteractionInput = {
    calledAt: "2026-08-16T18:15:00.000Z",
    contactWasCaller: true,
    kind: "call",
    personId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
  };
  assert(
    activity.kind === "activity" && String(call.kind) === "call",
    "compile fixtures lost",
  );
  const callProjection = {
    calledAt: "2026-08-16T18:15:00.000Z",
    contactWasCaller: true,
    createdAt: "2026-08-16T18:15:00.000Z",
    emotions: [],
    id: crypto.randomUUID(),
    kind: "call" as const,
    person: { id: crypto.randomUUID(), name: "Ada" },
  } satisfies Extract<Interaction, { readonly kind: "call" }>;
  // @ts-expect-error activity reports contain only activity/note projections
  const invalidReportItem: ActivityReport["items"][number] = callProjection;
  // @ts-expect-error Today recent activity contains only activity/note projections
  const invalidRecentItem: TodayRecentActivity["items"][number] =
    callProjection;
  assert(
    Boolean(invalidReportItem) && Boolean(invalidRecentItem),
    "compile-only precision fixtures lost",
  );
  const activityParticipants = document.components.schemas.ActivityInteraction
    ?.properties?.participants;
  const inputParticipants = document.components.schemas.ActivityInteractionInput
    ?.properties?.participantIds;
  const retainedActivity = {
    emotions: [],
    happenedAt: "2026-08-16T18:15:00.000Z",
    id: crypto.randomUUID(),
    kind: "activity",
    participants: [],
    summary: "Retained history",
  };
  const acceptsArray = (
    schema:
      | { readonly maxItems?: number; readonly minItems?: number }
      | undefined,
    value: readonly unknown[],
  ) =>
    schema !== undefined &&
    (schema.minItems === undefined || value.length >= schema.minItems) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems);
  assert(
    acceptsArray(activityParticipants, retainedActivity.participants),
    "retained activity response rejects redacted empty participants",
  );
  assert(
    !acceptsArray(inputParticipants, []),
    "activity create input no longer requires a participant",
  );
});
