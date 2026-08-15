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
