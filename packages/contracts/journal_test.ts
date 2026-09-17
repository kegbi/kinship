function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameMembers(
  actual: readonly string[] | undefined,
  expected: readonly string[],
): boolean {
  return JSON.stringify([...(actual ?? [])].sort()) ===
    JSON.stringify([...expected].sort());
}

Deno.test("[JOURNAL-001] generated contract exposes journal routes and client", async () => {
  const document = JSON.parse(
    await Deno.readTextFile("packages/contracts/openapi/openapi.json"),
  ) as {
    paths: Record<
      string,
      Record<string, {
        parameters?: readonly { name?: string }[];
        responses?: Record<string, {
          content?: { "application/json"?: { schema?: { $ref?: string } } };
        }>;
      }>
    >;
    components: {
      schemas: Record<string, {
        additionalProperties?: boolean;
        discriminator?: { propertyName?: string };
        oneOf?: readonly { $ref?: string }[];
        properties?: Record<string, { const?: string }>;
        required?: readonly string[];
      }>;
    };
  };
  const client = [
    await Deno.readTextFile("packages/contracts/client/journal.ts"),
    await Deno.readTextFile("packages/contracts/client/types.ts"),
  ].join(" ").replace(/\s+/g, "").replace(/,\)/g, ")");
  for (
    const path of [
      "/api/v1/journal",
      "/api/v1/journal/items/{itemId}",
      "/api/v1/journal/posts",
      "/api/v1/journal/posts/{itemId}",
      "/api/v1/journal/day-ratings",
      "/api/v1/journal/activities",
    ]
  ) assert(document.paths[path], `${path} missing`);
  assert(
    document.components.schemas.JournalTimelineItem,
    "journal timeline schema missing",
  );
  const timeline = document.components.schemas.JournalTimelineItem;
  assert(
    timeline.oneOf?.length === 3 &&
      timeline.discriminator?.propertyName === "type",
    "journal timeline must be a type-discriminated union",
  );
  for (
    const [schema, type, required] of [
      [
        "JournalActivityItem",
        "activity",
        ["activity", "id", "occurredAt", "type"],
      ],
      [
        "JournalDayRatingItem",
        "day-rating",
        ["dayRating", "id", "occurredAt", "type"],
      ],
      [
        "JournalPostItem",
        "post",
        ["id", "occurredAt", "post", "type"],
      ],
    ] as const
  ) {
    const arm = document.components.schemas[schema];
    assert(
      arm?.additionalProperties === false &&
        arm.properties?.type?.const === type &&
        sameMembers(arm.required, required),
      `${schema} is not an exact ${type} timeline arm`,
    );
  }
  for (
    const [path, method, status, schema, required] of [
      [
        "/api/v1/journal/items/{itemId}",
        "delete",
        "200",
        "JournalDeleted",
        ["itemType", "status"],
      ],
      [
        "/api/v1/journal/posts",
        "post",
        "201",
        "JournalPostCreated",
        ["post", "status"],
      ],
      [
        "/api/v1/journal/posts/{itemId}",
        "put",
        "200",
        "JournalPostUpdated",
        ["post", "status"],
      ],
      [
        "/api/v1/journal/day-ratings",
        "put",
        "200",
        "JournalDayRatingSaved",
        ["rating", "status"],
      ],
      [
        "/api/v1/journal/day-ratings",
        "put",
        "201",
        "JournalDayRatingSaved",
        ["rating", "status"],
      ],
      [
        "/api/v1/journal/activities",
        "post",
        "201",
        "JournalActivityLinked",
        ["activityId", "id", "occurredAt", "status"],
      ],
    ] as const
  ) {
    assert(
      document.paths[path]?.[method]?.responses?.[status]?.content?.[
        "application/json"
      ]?.schema?.$ref === `#/components/schemas/${schema}`,
      `${method.toUpperCase()} ${path} ${status} lacks exact success schema`,
    );
    const response = document.components.schemas[schema];
    assert(
      response?.additionalProperties === false &&
        sameMembers(response.required, required),
      `${schema} is not exact`,
    );
  }
  assert(
    !document.paths["/api/v1/journal/items/{itemId}"]?.delete?.parameters
      ?.some((parameter) => parameter.name === "type"),
    "journal deletion must not accept a client-controlled item type",
  );
  for (
    const operation of [
      "listJournal",
      "getJournalItem",
      "createJournalPost",
      "updateJournalPost",
      "saveJournalDayRating",
      "linkJournalActivity",
      "deleteJournalItem",
    ]
  ) {
    assert(
      client.includes(`function${operation}`),
      `${operation} client missing`,
    );
  }
  assert(
    client.includes("exporttypeJournalTimelineItem=") &&
      client.includes(
        'exporttypeJournalItemType=JournalTimelineItem["type"]',
      ) &&
      client.includes(
        "deleteJournalItem(itemId:string,workspaceId?:string)",
      ),
    "journal client does not preserve discriminated items and server-derived deletion",
  );
});
