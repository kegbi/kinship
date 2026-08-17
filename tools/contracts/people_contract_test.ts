import { buildOpenApiDocument } from "./generate.ts";
import type {
  PersonalizationCreateInputBySection,
  PersonalizationUpdateInputBySection,
  PersonProfileSectionId,
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

Deno.test("RELATIONSHIP-001 OpenAPI publishes strict directional section operations", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, unknown>>;
    readonly components: {
      readonly schemas: Readonly<
        Record<
          string,
          {
            readonly additionalProperties?: boolean;
            readonly required?: readonly string[];
          }
        >
      >;
    };
  };
  const paths = document.paths;
  assert(
    Boolean(paths["/api/v1/relationship-types"]),
    "relationship type search is missing",
  );
  assert(
    Boolean(paths["/api/v1/people/{personId}/relationships"]),
    "relationship list/create is missing",
  );
  assert(
    Boolean(paths["/api/v1/people/{personId}/relationships/{relationshipId}"]),
    "relationship update/delete is missing",
  );
  assert(
    Boolean(
      paths[
        "/api/v1/people/{personId}/relationships/related-person"
      ],
    ),
    "atomic related-person operation is missing",
  );
  for (
    const name of [
      "RelationshipCreateInput",
      "RelationshipUpdateInput",
      "Relationship",
      "RelationshipDisplay",
      "RelationshipWithDisplay",
      "RelationshipList",
      "RelationshipChanged",
      "RelationshipDeleted",
      "RelatedPersonRelationshipInput",
      "RelatedPersonRelationshipChanged",
    ]
  ) {
    assert(
      document.components.schemas[name]?.additionalProperties === false,
      `${name} is not strict`,
    );
  }
  assert(
    document.components.schemas.RelationshipCreateInput?.required?.join(",") ===
      "relationshipTypeId,targetPersonId",
    "relationship create contract admits romantic metadata",
  );
  const listItem = (document.components.schemas.RelationshipList as {
    readonly properties?: {
      readonly relationships?: { readonly items?: ObjectSchema };
    };
  }).properties?.relationships?.items;
  assert(
    listItem?.$ref === "#/components/schemas/RelationshipWithDisplay" &&
      listItem.allOf === undefined,
    "relationship list still composes a closed base through allOf",
  );
  const changed = document.components.schemas.RelationshipChanged as {
    readonly properties?: Readonly<Record<string, ObjectSchema>>;
    readonly required?: readonly string[];
  };
  assert(
    changed.required?.includes("forward") === true &&
      changed.required.includes("inverse") &&
      changed.properties?.forward?.$ref ===
        "#/components/schemas/RelationshipDisplay" &&
      changed.properties.inverse?.$ref ===
        "#/components/schemas/RelationshipDisplay",
    "relationship mutation directions do not reference the strict display",
  );
});

Deno.test("WORKSPACE-003 OpenAPI binds strict mutation inputs to each section", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly components: {
      readonly schemas: Readonly<Record<string, ObjectSchema>>;
    };
  };
  const schemas = document.components.schemas;
  for (
    const name of [
      "PersonalizationNamedCreate",
      "PersonalizationNameOnlyCreate",
      "PersonalizationRelationshipCreate",
      "PersonalizationReminderCreate",
      "PersonalizationNamedUpdate",
      "PersonalizationGenderUpdate",
      "PersonalizationNameOnlyUpdate",
      "PersonalizationRelationshipUpdate",
      "PersonalizationReminderUpdate",
    ]
  ) {
    assert(
      schemas[name]?.additionalProperties === false,
      `${name} is missing or permissive`,
    );
  }
  assert(
    schemas.PersonalizationCreate?.anyOf?.length === 4 &&
      schemas.PersonalizationUpdate?.anyOf?.length === 5,
    "personalization mutations do not publish their strict shape union",
  );
  const createMapping = schemas.PersonalizationCreate as ObjectSchema & {
    readonly "x-sectionSchemas"?: Readonly<Record<string, string | null>>;
  };
  const updateMapping = schemas.PersonalizationUpdate as ObjectSchema & {
    readonly "x-sectionSchemas"?: Readonly<Record<string, string | null>>;
  };
  assert(
    createMapping["x-sectionSchemas"]?.["reminder-rules"] ===
        "#/components/schemas/PersonalizationReminderCreate" &&
      updateMapping["x-sectionSchemas"]?.["relationship-types"] ===
        "#/components/schemas/PersonalizationRelationshipUpdate" &&
      createMapping["x-sectionSchemas"]?.["pet-categories"] === null &&
      updateMapping["x-sectionSchemas"]?.["emotion-options"] === null,
    "personalization mutation shapes are not bound to path sections",
  );
  assert(
    !acceptsObjectInstance(schemas, schemas.PersonalizationReminderUpdate!, {
      expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
      name: "ignored",
    }) &&
      !acceptsObjectInstance(
        schemas,
        schemas.PersonalizationRelationshipUpdate!,
        {
          expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
          name: "generic label",
        },
      ),
    "section-specific update schemas admit unsupported generic fields",
  );
  assert(
    acceptsObjectInstance(schemas, schemas.PersonalizationGenderUpdate!, {
      expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
      isDefault: true,
    }) &&
      !acceptsObjectInstance(schemas, schemas.PersonalizationGenderUpdate!, {
        expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
        isDefault: false,
      }),
    "gender default action is not published as literal true",
  );
});

Deno.test("WORKSPACE-003 generated client binds mutation inputs to sections", () => {
  const reminder: PersonalizationUpdateInputBySection["reminder-rules"] = {
    daysBefore: 14,
    expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
  };
  const relationship:
    PersonalizationUpdateInputBySection["relationship-types"] = {
      expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
      forwardLabel: "Parent",
      reverseLabel: "Child",
    };
  const gender: PersonalizationUpdateInputBySection["gender-options"] = {
    expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
    isDefault: true,
  };
  const invalidGender: PersonalizationUpdateInputBySection["gender-options"] = {
    expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
    // @ts-expect-error gender default is a one-way literal action.
    isDefault: false,
  };
  const invalidReminder: PersonalizationUpdateInputBySection["reminder-rules"] =
    {
      expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
      // @ts-expect-error reminder rules do not have a generic name.
      name: "ignored",
    };
  // @ts-expect-error directional labels must be updated as a pair.
  const invalidRelationship:
    PersonalizationUpdateInputBySection["relationship-types"] = {
      expectedUpdatedAt: "2026-08-17T12:00:00.000000Z",
      forwardLabel: "Parent",
    };
  // @ts-expect-error shared global pet categories cannot be created.
  const invalidPet: PersonalizationCreateInputBySection["pet-categories"] = {
    name: "Shared",
  };
  assert(
    reminder.daysBefore === 14 &&
      gender.isDefault === true && Object.hasOwn(invalidGender, "isDefault") &&
      relationship.forwardLabel === "Parent" &&
      Object.hasOwn(invalidReminder, "name") &&
      Object.hasOwn(invalidRelationship, "forwardLabel") &&
      Object.hasOwn(invalidPet, "name"),
    "compile-only invalid section fixtures remain observable",
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
  readonly minItems?: number;
  readonly maximum?: number;
  readonly minimum?: number;
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
      name in instance && !acceptsProperty(schemas, property, instance[name])
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

function acceptsProperty(
  schemas: Readonly<Record<string, ObjectSchema>>,
  schema: ObjectSchema,
  value: unknown,
): boolean {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    return name !== undefined && schemas[name] !== undefined &&
      acceptsProperty(schemas, schemas[name], value);
  }
  if (schema.const !== undefined && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
  }
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
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return false;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return false;
    }
    if (
      schema.items &&
      value.some((item) => !acceptsProperty(schemas, schema.items!, item))
    ) return false;
    return true;
  }
  if (typeof value === "object" && value !== null) {
    return acceptsObjectInstance(
      schemas,
      schema,
      value as Readonly<Record<string, unknown>>,
    );
  }
  return true;
}

Deno.test("RELATIONSHIP-001 response schemas validate exact API instances", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly components: {
      readonly schemas: Readonly<Record<string, ObjectSchema>>;
    };
  };
  const schemas = document.components.schemas;
  const relationship = {
    createdAt: "2026-08-16T12:00:00.000Z",
    forwardLabel: "parent",
    fromPersonId: "00000000-0000-4000-8000-000000000100",
    id: "00000000-0000-4000-8000-000000000300",
    relationshipTypeArchived: false,
    relationshipTypeId: "00000000-0000-4000-8000-000000000200",
    reverseLabel: "child",
    status: "active",
    toPersonId: "00000000-0000-4000-8000-000000000101",
    updatedAt: "2026-08-16T12:00:00.000Z",
  };
  const display = {
    label: "parent",
    name: "Target Person",
    personId: relationship.toPersonId,
    relationshipId: relationship.id,
  };
  const list = {
    relationships: [{ ...relationship, display }],
    status: "ready",
  };
  const changed = {
    affectedPersonIds: [relationship.fromPersonId, relationship.toPersonId],
    forward: display,
    inverse: {
      label: "child",
      personId: relationship.fromPersonId,
      relationshipId: relationship.id,
    },
    relationship,
    status: "created",
  };
  const updated = { ...changed, status: "updated" };
  const deleted = {
    affectedPersonIds: changed.affectedPersonIds,
    relationshipId: relationship.id,
    status: "deleted",
  };
  assert(
    acceptsObjectInstance(schemas, schemas.RelationshipList!, list) &&
      acceptsObjectInstance(schemas, schemas.RelationshipChanged!, changed) &&
      acceptsObjectInstance(schemas, schemas.RelationshipChanged!, updated) &&
      acceptsObjectInstance(schemas, schemas.RelationshipDeleted!, deleted),
    "representative list/create/update/unlink response is rejected",
  );
  assert(
    !acceptsObjectInstance(schemas, schemas.RelationshipList!, {
      ...list,
      relationships: [{ ...relationship, display, extra: true }],
    }) &&
      !acceptsObjectInstance(schemas, schemas.RelationshipChanged!, {
        ...changed,
        inverse: { label: "child", personId: relationship.fromPersonId },
      }) &&
      !acceptsObjectInstance(schemas, schemas.RelationshipChanged!, {
        ...changed,
        inverse: { ...changed.inverse, extra: true },
      }) &&
      !acceptsObjectInstance(schemas, schemas.RelationshipDeleted!, {
        ...deleted,
        extra: true,
      }),
    "strict relationship responses admit missing or extra properties",
  );
});

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
  const profileSections = schemas?.PersonProfileSectionId as ObjectSchema;
  const factSections = schemas?.ProfileFactSectionId as ObjectSchema;
  const profileSectionItems = (identity?.properties?.profileSections as {
    readonly items?: ObjectSchema;
  } | undefined)?.items;
  const representative = {
    dueInformation: {
      detail: "Planning and reminders are not delivered yet.",
      status: "unavailable",
    },
    person: {
      givenName: "Ada",
      id: "00000000-0000-4000-8000-000000000100",
      isDeceased: false,
      isPartial: false,
      isSelf: false,
      isStarred: true,
      profileSections: [{ id: "relationships", status: "ready" }],
      tagCount: 0,
      tags: [],
      updatedAt: "2026-08-16T12:00:00.000Z",
    },
    status: "ready",
  };

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
  assert(
    profileSections?.enum?.includes("relationships") === true &&
      factSections?.enum?.includes("relationships") !== true &&
      profileSectionItems?.properties?.id?.$ref ===
        "#/components/schemas/PersonProfileSectionId",
    "person profile sections do not use their distinct section vocabulary",
  );
  assert(
    acceptsObjectInstance(
      schemas as Readonly<Record<string, ObjectSchema>>,
      (schemas as Readonly<Record<string, ObjectSchema>>).PersonReady!,
      representative,
    ) &&
      acceptsObjectInstance(
        schemas as Readonly<Record<string, ObjectSchema>>,
        (schemas as Readonly<Record<string, ObjectSchema>>).PersonReady!,
        {
          ...representative,
          person: {
            ...representative.person,
            profileSections: [
              { id: "calls", status: "ready" },
              { id: "conversations", status: "ready" },
            ],
          },
        },
      ) &&
      !acceptsObjectInstance(
        schemas as Readonly<Record<string, ObjectSchema>>,
        (schemas as Readonly<Record<string, ObjectSchema>>).PersonReady!,
        {
          ...representative,
          person: {
            ...representative.person,
            profileSections: [{ id: "life-events", status: "ready" }],
          },
        },
      ),
    "representative person response does not enforce profile section IDs",
  );
  const relationshipsSection: PersonProfileSectionId = "relationships";
  const callsSection: PersonProfileSectionId = "calls";
  // @ts-expect-error life events remain unavailable in the profile read model.
  const unsupportedSection: PersonProfileSectionId = "life-events";
  assert(
    relationshipsSection === "relationships" &&
      callsSection === "calls" && String(unsupportedSection) === "life-events",
    "generated profile-section type fixtures were not evaluated",
  );
});

Deno.test("collection parameters are unique and publish exact runtime limits", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<
      Record<
        string,
        Readonly<
          Record<string, {
            readonly parameters?: readonly {
              readonly in?: string;
              readonly name?: string;
              readonly schema?: ObjectSchema;
            }[];
          }>
        >
      >
    >;
    readonly components: {
      readonly schemas: Readonly<Record<string, ObjectSchema>>;
    };
  };
  const limit = document.paths["/api/v1/people/{personId}/relationships"]?.get
    ?.parameters?.find((parameter) => parameter.name === "limit")?.schema;
  const peopleLimit = document.paths["/api/v1/people"]?.get?.parameters?.find(
    (parameter) => parameter.name === "limit",
  )?.schema;
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      const parameters = operation.parameters ?? [];
      const keys = parameters.map((parameter) =>
        `${parameter.in ?? ""}:${parameter.name ?? ""}`
      );
      assert(
        new Set(keys).size === keys.length,
        `${method.toUpperCase()} ${path} duplicates an (in,name) parameter`,
      );
    }
  }
  assert(
    peopleLimit?.maximum === 50 &&
      acceptsProperty(document.components.schemas, peopleLimit, 50) &&
      !acceptsProperty(document.components.schemas, peopleLimit, 51) &&
      limit?.maximum === 20 &&
      acceptsProperty(document.components.schemas, limit, 20) &&
      !acceptsProperty(document.components.schemas, limit, 21),
    "people and relationship list limits diverge from runtime",
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
  const optionKind = schemas.ProfileFactOption?.properties?.kind;
  assert(
    input?.oneOf?.length === 7,
    "profile-fact input is a discriminated union of seven closed sections",
  );
  assert(
    updateInput?.oneOf?.length === 7,
    "profile-fact updates use a separate discriminated union",
  );
  assert(
    optionKind?.enum?.includes("organization") === true,
    "work organization choices are a first-class profile option kind",
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
      {
        section: "work",
        isCurrent: true,
        organizationId: "00000000-0000-4000-8000-000000000350",
        title: "Engineer",
      },
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
