import { buildOpenApiDocument } from "./generate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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
