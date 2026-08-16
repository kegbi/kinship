import { buildOpenApiDocument } from "./generate.ts";
import type {
  ProfileFactCreateInputBySection,
  ProfileFactListInput,
  ProfileFactUpdateInputBySection,
  ProfileFactValueBySection,
} from "../../packages/contracts/generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PEOPLE-006 generated mutation inputs remain stricter than response values", () => {
  // @ts-expect-error food mutation requires a concrete preference value.
  const emptyFood: ProfileFactCreateInputBySection["food-preferences"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    section: "food-preferences",
  };
  // @ts-expect-error address mutation requires at least one address detail.
  const emptyAddress: ProfileFactCreateInputBySection["addresses"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    isPrimary: false,
    labelIds: [],
    section: "addresses",
  };
  // @ts-expect-error first-meeting mutation requires narrative, place, or introducer.
  const emptyMeeting: ProfileFactCreateInputBySection["first-meeting"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    section: "first-meeting",
  };
  // @ts-expect-error pet mutation requires a name or category.
  const emptyPet: ProfileFactCreateInputBySection["pets"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    section: "pets",
  };
  const foodResponse: ProfileFactValueBySection["food-preferences"] = {
    section: "food-preferences",
  };
  const createWithId: ProfileFactCreateInputBySection["pets"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    // @ts-expect-error create never accepts a client-supplied identity.
    id: "00000000-0000-4000-8000-000000000200",
    name: "Byron",
    section: "pets",
  };
  // @ts-expect-error update requires both the target identity and fact revision.
  const updateWithoutVersion: ProfileFactUpdateInputBySection["pets"] = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    name: "Byron",
    section: "pets",
  };
  const invalidListInput: ProfileFactListInput = {
    // @ts-expect-error options hydration supports only the literal true query.
    includeOptions: false,
  };
  // @ts-expect-error an option cursor requires explicit options mode.
  const cursorWithoutOptions: ProfileFactListInput = {
    optionCursor: "opaque-option-cursor",
  };
  assert(
    emptyFood.section === "food-preferences" &&
      emptyAddress.section === "addresses" &&
      emptyMeeting.section === "first-meeting" &&
      emptyPet.section === "pets" &&
      createWithId.section === "pets" &&
      updateWithoutVersion.section === "pets" &&
      Object.hasOwn(invalidListInput, "includeOptions") &&
      Object.hasOwn(cursorWithoutOptions, "optionCursor") &&
      foodResponse.foodPreferences === undefined,
    "compile-only invalid fixtures and a permissive response DTO stay distinct",
  );
});

interface ObjectSchema {
  readonly $ref?: string;
  readonly additionalProperties?: boolean;
  readonly allOf?: readonly ObjectSchema[];
  readonly anyOf?: readonly ObjectSchema[];
  readonly const?: unknown;
  readonly enum?: readonly unknown[];
  readonly items?: ObjectSchema;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly oneOf?: readonly ObjectSchema[];
  readonly pattern?: string;
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
  if (
    schema.anyOf &&
    !schema.anyOf.some((part) => acceptsObjectInstance(schemas, part, instance))
  ) return false;
  if (schema.oneOf) {
    return schema.oneOf.filter((part) =>
      acceptsObjectInstance(schemas, part, instance)
    ).length === 1;
  }
  if (schema.required?.some((name) => !(name in instance))) return false;
  if (
    Object.entries(schema.properties ?? {}).some(([name, property]) =>
      name in instance && !acceptsProperty(property, instance[name])
    )
  ) return false;
  if (
    schema.additionalProperties === false &&
    Object.keys(instance).some((name) =>
      schema.properties?.[name] === undefined
    )
  ) return false;
  return true;
}

function acceptsProperty(schema: ObjectSchema, value: unknown): boolean {
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return false;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return false;
    }
    if (
      schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)
    ) {
      return false;
    }
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return false;
    }
  }
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
      "excludePersonId",
      "limit",
      "selectedPersonId",
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

Deno.test("PEOPLE-006 OpenAPI exposes strict section-scoped profile facts", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<string, Record<string, unknown>>;
  const section = paths["/api/v1/people/{personId}/facts/{section}"];
  const item = paths["/api/v1/people/{personId}/facts/{section}/{factId}"];
  assert(
    Boolean(section?.get && section.post && item?.put && item.delete),
    "profile-fact list/create/update/delete operations remain canonical",
  );
  const schemas = (document.components as {
    schemas: Readonly<Record<string, ObjectSchema>>;
  }).schemas;
  const input = schemas.ProfileFactCreateInput;
  const updateInput = schemas.ProfileFactUpdateInput;
  assert(
    input?.oneOf?.length === 7,
    "profile-fact input is a discriminated union of seven closed sections",
  );
  assert(
    updateInput?.oneOf?.length === 7,
    "profile-fact updates use a separate discriminated union",
  );
  const petCreate = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
    name: "Byron",
    section: "pets",
  };
  assert(
    acceptsObjectInstance(schemas, input, petCreate) &&
      !acceptsObjectInstance(schemas, input, {
        ...petCreate,
        id: "00000000-0000-4000-8000-000000000200",
      }) &&
      !acceptsObjectInstance(schemas, updateInput, petCreate) &&
      acceptsObjectInstance(schemas, updateInput, {
        ...petCreate,
        expectedUpdatedAt: "2026-08-16T12:00:00.000000Z",
        id: "00000000-0000-4000-8000-000000000200",
      }),
    "create forbids identity while update requires identity and fact revision",
  );
  assert(
    [
      { section: "addresses", isPrimary: false, labelIds: [], city: "London" },
      {
        section: "contact-methods",
        isPrimary: true,
        labelIds: [],
        typeId: "00000000-0000-4000-8000-000000000300",
        value: "ada@example.test",
      },
      { section: "first-meeting", notes: "Met at a salon" },
      { section: "food-preferences", foodPreferences: "Tea" },
      { section: "pets", name: "Byron", notes: "A quiet companion" },
      { section: "tags", tagIds: [] },
      { section: "work", isCurrent: true, title: "Engineer" },
    ].every((value) =>
      acceptsObjectInstance(schemas, input, {
        ...value,
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
      })
    ),
    "every representative section satisfies exactly one closed input variant",
  );
  const value = schemas.ProfileFactValue;
  assert(value !== undefined, "profile-fact value union is documented");
  assert(
    acceptsObjectInstance(schemas, value, {
      section: "first-meeting",
      notes: "Met at a salon",
    }) &&
      acceptsObjectInstance(schemas, value, {
        section: "pets",
        notes: "A quiet companion",
      }),
    "overlapping notes shapes remain distinguishable by section",
  );
  assert(
    !acceptsObjectInstance(schemas, input, {}) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "food-preferences",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "first-meeting",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "pets",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        city: "",
        isPrimary: false,
        labelIds: [],
        section: "addresses",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        notes: "   ",
        section: "first-meeting",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        name: "",
        section: "pets",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "contact-methods",
        foodPreferences: "Tea",
        isPrimary: true,
        labelIds: [],
        typeId: "00000000-0000-4000-8000-000000000300",
        value: "ada@example.test",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
        section: "addresses",
        isPrimary: true,
        labelIds: [],
        typeId: "00000000-0000-4000-8000-000000000300",
        value: "ada@example.test",
        workspaceId: "00000000-0000-4000-8000-000000000400",
      }),
    "empty facts, discriminator mismatches, cross-section fields, and extras are rejected",
  );
  const base = {
    expectedPersonUpdatedAt: "2026-08-16T12:00:00.000000Z",
  };
  const ids = Array.from(
    { length: 501 },
    (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  assert(
    !acceptsObjectInstance(schemas, input, {
      ...base,
      foodPreferences: "",
      section: "food-preferences",
    }) &&
      acceptsObjectInstance(schemas, input, {
        ...base,
        foodPreferences: "x".repeat(2_000),
        section: "food-preferences",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        ...base,
        foodPreferences: "x".repeat(2_001),
        section: "food-preferences",
      }) &&
      acceptsObjectInstance(schemas, input, {
        ...base,
        isPrimary: false,
        labelIds: ids.slice(0, 20),
        section: "addresses",
        street: "x".repeat(500),
      }) &&
      !acceptsObjectInstance(schemas, input, {
        ...base,
        isPrimary: false,
        labelIds: ids.slice(0, 21),
        section: "addresses",
        street: "x".repeat(501),
      }) &&
      acceptsObjectInstance(schemas, input, {
        ...base,
        section: "tags",
        tagIds: ids.slice(0, 500),
      }) &&
      !acceptsObjectInstance(schemas, input, {
        ...base,
        section: "tags",
        tagIds: ids,
      }) &&
      !acceptsObjectInstance(schemas, input, {
        ...base,
        isCurrent: true,
        section: "work",
        title: "",
      }) &&
      !acceptsObjectInstance(schemas, input, {
        ...base,
        isCurrent: true,
        section: "work",
        title: "x".repeat(201),
      }) &&
      [
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          section: "addresses",
          city: "x".repeat(201),
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          section: "addresses",
          country: "x".repeat(201),
        },
        {
          ...base,
          displayName: "x".repeat(201),
          isPrimary: false,
          labelIds: [],
          section: "addresses",
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          postalCode: "x".repeat(51),
          section: "addresses",
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          region: "x".repeat(201),
          section: "addresses",
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          section: "contact-methods",
          typeId: ids[0],
          value: "x".repeat(2_001),
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          notes: "x".repeat(2_001),
          section: "contact-methods",
          typeId: ids[0],
          value: "x",
        },
        {
          ...base,
          notes: "x".repeat(2_001),
          section: "first-meeting",
        },
        {
          ...base,
          placeText: "x".repeat(501),
          section: "first-meeting",
        },
        {
          ...base,
          name: "x".repeat(201),
          section: "pets",
        },
        {
          ...base,
          name: "Byron",
          notes: "x".repeat(2_001),
          section: "pets",
        },
        {
          ...base,
          description: "x".repeat(2_001),
          isCurrent: true,
          section: "work",
          title: "Engineer",
        },
        {
          ...base,
          isCurrent: true,
          organizationName: "x".repeat(201),
          section: "work",
          title: "Engineer",
        },
      ].every((candidate) =>
        !acceptsObjectInstance(schemas, input, candidate)
      ) &&
      [
        { ...base, foodPreferences: "   ", section: "food-preferences" },
        {
          ...base,
          isCurrent: true,
          section: "work",
          title: "   ",
        },
        {
          ...base,
          isPrimary: false,
          labelIds: [],
          section: "contact-methods",
          typeId: ids[0],
          value: "   ",
        },
      ].every((candidate) => !acceptsObjectInstance(schemas, input, candidate)),
    "input variants enforce the runtime string and collection boundaries",
  );
  assert(
    ([
      ["AddressFactCreateInput", "AddressFactUpdateInput"],
      ["ContactMethodFactCreateInput", "ContactMethodFactUpdateInput"],
      ["FirstMeetingFactCreateInput", "FirstMeetingFactUpdateInput"],
      ["FoodPreferencesFactCreateInput", "FoodPreferencesFactUpdateInput"],
      ["PetFactCreateInput", "PetFactUpdateInput"],
      ["TagsFactCreateInput", "TagsFactUpdateInput"],
      ["OccupationFactCreateInput", "OccupationFactUpdateInput"],
    ] as const).every(([createName, updateName]) => {
      const createProperties = schemas[createName]?.properties ?? {};
      const updateProperties = schemas[updateName]?.properties ?? {};
      return Object.entries(createProperties).every(([name, property]) =>
        JSON.stringify(updateProperties[name]) === JSON.stringify(property)
      );
    }),
    "create and update variants publish identical field boundaries",
  );
  const listOperation = section?.get as {
    readonly parameters?: readonly {
      readonly description?: string;
      readonly name?: string;
      readonly schema?: ObjectSchema;
    }[];
  };
  assert(
    JSON.stringify(
      listOperation.parameters?.find((parameter) =>
        parameter.name === "includeOptions"
      )?.schema?.enum,
    ) === JSON.stringify([true]),
    "includeOptions documents only the literal true query semantic",
  );
  assert(
    listOperation.parameters?.find((parameter) =>
      parameter.name === "optionCursor"
    )?.description === "Requires includeOptions=true.",
    "the documented query relation matches runtime option continuation",
  );
});
