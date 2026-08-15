import { buildOpenApiDocument } from "./generate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface ObjectSchema {
  readonly $ref?: string;
  readonly additionalProperties?: boolean;
  readonly allOf?: readonly ObjectSchema[];
  readonly properties?: Readonly<Record<string, ObjectSchema>>;
  readonly required?: readonly string[];
  readonly type?: string;
}

function acceptsObjectInstance(
  schemas: Readonly<Record<string, ObjectSchema>>,
  schema: ObjectSchema,
  instance: Readonly<Record<string, unknown>>,
): boolean {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return name !== undefined && schemas[name] !== undefined &&
      acceptsObjectInstance(schemas, schemas[name], instance);
  }
  if (
    schema.allOf?.some((part) =>
      !acceptsObjectInstance(schemas, part, instance)
    )
  ) return false;
  if (schema.required?.some((name) => !(name in instance))) return false;
  if (
    schema.additionalProperties === false &&
    Object.keys(instance).some((name) =>
      schema.properties?.[name] === undefined
    )
  ) return false;
  return true;
}

Deno.test("PEOPLE-001 OpenAPI describes tenant-safe person creation", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, {
    readonly post?: {
      readonly parameters?: readonly { readonly name?: string }[];
      readonly responses?: Readonly<Record<string, unknown>>;
      readonly security?: readonly Readonly<
        Record<string, readonly unknown[]>
      >[];
    };
  }>;
  const create = paths["/api/v1/people"]?.post;
  assert(create !== undefined, "person creation path must be versioned");
  assert(
    JSON.stringify(create.security) ===
      JSON.stringify([{ kinship_session: [] }]),
    "person creation must require the session cookie",
  );
  assert(
    create.parameters?.some((parameter) => parameter.name === "Origin") ===
        true &&
      create.parameters?.some((parameter) =>
          parameter.name === "X-Workspace-Id"
        ) === true,
    "person creation must document CSRF and active-workspace headers",
  );
  for (const status of ["201", "400", "401", "403", "409", "503"]) {
    assert(
      create.responses?.[status] !== undefined,
      `person creation must document ${status}`,
    );
  }
});

Deno.test("PEOPLE-002 OpenAPI describes tenant-safe cursor directory reads", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, {
    readonly get?: {
      readonly parameters?: readonly { readonly name?: string }[];
      readonly responses?: Readonly<Record<string, unknown>>;
      readonly security?: readonly Readonly<
        Record<string, readonly unknown[]>
      >[];
    };
  }>;
  const list = paths["/api/v1/people"]?.get;
  assert(list !== undefined, "people directory path must be versioned");
  assert(
    JSON.stringify(list.security) === JSON.stringify([{ kinship_session: [] }]),
    "people directory must require the session cookie",
  );
  for (
    const parameter of [
      "X-Workspace-Id",
      "search",
      "tag",
      "lifecycle",
      "sort",
      "cursor",
      "limit",
    ]
  ) {
    assert(
      list.parameters?.some((candidate) => candidate.name === parameter) ===
        true,
      `people directory must document ${parameter}`,
    );
  }
  for (const status of ["200", "400", "401", "403", "409", "503"]) {
    assert(
      list.responses?.[status] !== undefined,
      `people directory must document ${status}`,
    );
  }
  const tagOptions = paths["/api/v1/people/tag-options"]?.get;
  assert(tagOptions !== undefined, "tag options path must be versioned");
  assert(
    JSON.stringify(tagOptions.security) ===
        JSON.stringify([{ kinship_session: [] }]) &&
      ["X-Workspace-Id", "search", "cursor", "selected"].every((name) =>
        tagOptions.parameters?.some((parameter) => parameter.name === name)
      ),
    "tag options must be tenant-scoped, searchable, and cursor-paginated",
  );
  for (const status of ["200", "400", "401", "403", "503"]) {
    assert(
      tagOptions.responses?.[status] !== undefined,
      `tag options must document ${status}`,
    );
  }

  const schemas = (document.components as {
    readonly schemas?: Readonly<Record<string, unknown>>;
  }).schemas;
  const directoryPerson = schemas?.PeopleDirectoryPerson as {
    readonly additionalProperties?: unknown;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
    readonly type?: string;
  } | undefined;
  assert(
    directoryPerson?.type === "object" &&
      directoryPerson.additionalProperties === false &&
      directoryPerson.required?.includes("id") === true &&
      directoryPerson.required.includes("lifecycle") &&
      directoryPerson.required.includes("tagCount") &&
      directoryPerson.required.includes("tags") &&
      directoryPerson.properties?.givenName !== undefined &&
      (directoryPerson.properties.tags as { readonly maxItems?: number })
          ?.maxItems === 5,
    "directory people must be strict objects with a fixed tag preview",
  );
  const directoryPage = schemas?.PeopleDirectoryPage as {
    readonly properties?: Readonly<Record<string, unknown>>;
  } | undefined;
  const tagOptionsPage = schemas?.PeopleTagOptionsPage as {
    readonly properties?: {
      readonly options?: { readonly maxItems?: number };
    };
  } | undefined;
  assert(
    directoryPage?.properties?.availableTags === undefined &&
      tagOptionsPage?.properties?.options?.maxItems === 20,
    "people pages omit tag vocabulary and tag-option pages declare a fixed bound",
  );
});

Deno.test("PEOPLE-001 OpenAPI describes tenant-safe canonical identity reads", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, {
    readonly get?: {
      readonly parameters?: readonly { readonly name?: string }[];
      readonly responses?: Readonly<Record<string, unknown>>;
      readonly security?: readonly Readonly<
        Record<string, readonly unknown[]>
      >[];
    };
  }>;
  const read = paths["/api/v1/people/{personId}"]?.get;
  assert(read !== undefined, "canonical person read path must be versioned");
  assert(
    JSON.stringify(read.security) === JSON.stringify([{ kinship_session: [] }]),
    "person identity read must require the session cookie",
  );
  assert(
    read.parameters?.some((parameter) => parameter.name === "personId") ===
        true &&
      read.parameters?.some((parameter) =>
          parameter.name === "X-Workspace-Id"
        ) === true,
    "person read must document canonical ID and active workspace",
  );
  for (const status of ["200", "400", "401", "403", "404", "503"]) {
    assert(
      read.responses?.[status] !== undefined,
      `person read must document ${status}`,
    );
  }
});

Deno.test("[APP-003C] OpenAPI describes the canonical workspace summary", () => {
  const document = buildOpenApiDocument();
  const schemas = (document.components as {
    readonly schemas?: Readonly<Record<string, unknown>>;
  }).schemas;
  const ready = schemas?.PersonReady as {
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  } | undefined;
  const identity = schemas?.PersonProfileIdentity as {
    readonly additionalProperties?: unknown;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  } | undefined;
  const due = schemas?.PersonDueInformation as {
    readonly additionalProperties?: unknown;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly required?: readonly string[];
  } | undefined;

  assert(
    ready?.required?.includes("dueInformation") === true &&
      ready.properties?.dueInformation !== undefined,
    "person workspace response requires the due-information summary",
  );
  assert(
    identity?.additionalProperties === false &&
      identity.required?.includes("isStarred") === true &&
      identity.required.includes("isDeceased") &&
      identity.properties?.description !== undefined,
    "profile identity is strict and includes orientation fields",
  );
  assert(
    due?.additionalProperties === false &&
      due.required?.includes("status") === true &&
      due.properties?.detail !== undefined,
    "due-information unavailability is a typed honest contract",
  );
});

Deno.test("PEOPLE-004 OpenAPI versions every tenant-safe lifecycle action", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<
    string,
    Record<string, {
      readonly parameters?: readonly { readonly name?: string }[];
      readonly responses?: Readonly<Record<string, unknown>>;
      readonly security?: readonly Readonly<
        Record<string, readonly unknown[]>
      >[];
    }>
  >;
  for (
    const [path, method] of [
      ["/api/v1/people/{personId}", "patch"],
      ["/api/v1/people/{personId}", "delete"],
      ["/api/v1/people/{personId}/archive", "post"],
      ["/api/v1/people/{personId}/restore", "post"],
      ["/api/v1/people/{personId}/deletion-impact", "get"],
    ] as const
  ) {
    const operation = paths[path]?.[method];
    assert(operation, `${method} ${path} is documented`);
    assert(
      JSON.stringify(operation.security) ===
          JSON.stringify([{ kinship_session: [] }]) &&
        operation.parameters?.some((parameter) =>
            parameter.name === "X-Workspace-Id"
          ) === true &&
        operation.parameters.some((parameter) => parameter.name === "personId"),
      `${method} ${path} is session and workspace scoped`,
    );
    for (const status of ["200", "400", "401", "403", "404", "503"]) {
      assert(operation.responses?.[status], `${method} documents ${status}`);
    }
  }
});

Deno.test("PEOPLE-005 OpenAPI preserves partial and approximate date state", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, unknown>>;
  const collection = paths["/api/v1/people/{personId}/dates"];
  const item = paths["/api/v1/people/{personId}/dates/{dateId}"];
  assert(
    Boolean(collection?.get && collection.post && item?.patch && item.delete),
    "important-date CRUD/list operations are versioned",
  );
  const schemas = (document.components as {
    schemas: Record<string, { properties?: Record<string, unknown> }>;
  }).schemas;
  const input = schemas.ImportantDateInput;
  assert(
    Boolean(input?.properties?.precision) &&
      Boolean(input?.properties?.isYearApproximate),
    "precision and approximation are independent transport fields",
  );

  const objectSchemas = schemas as Readonly<Record<string, ObjectSchema>>;
  const dateInput = {
    day: 29,
    isAgeBased: false,
    isYearApproximate: true,
    kind: "birthday",
    month: 2,
    precision: "full",
    year: 1984,
  };
  const createSchema = objectSchemas.ImportantDateInput;
  const updateSchema = objectSchemas.ImportantDateUpdateInput;
  const responseSchema = objectSchemas.ImportantDate;
  assert(
    createSchema && updateSchema && responseSchema,
    "important-date schemas exist",
  );
  assert(
    acceptsObjectInstance(
      objectSchemas,
      createSchema,
      dateInput,
    ),
    "a representative create input satisfies its closed schema",
  );
  assert(
    acceptsObjectInstance(
      objectSchemas,
      updateSchema,
      {
        ...dateInput,
        expectedUpdatedAt: "2026-08-15T12:00:00.000Z",
      },
    ),
    "a representative update input satisfies its composed schema",
  );
  assert(
    acceptsObjectInstance(objectSchemas, responseSchema, {
      ...dateInput,
      createdAt: "2026-08-15T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000200",
      personId: "00000000-0000-4000-8000-000000000100",
      scheduling: "annual-reminder",
      updatedAt: "2026-08-15T12:00:00.000Z",
    }),
    "a representative response date satisfies its composed schema",
  );
});
