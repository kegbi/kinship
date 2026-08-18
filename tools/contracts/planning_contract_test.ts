import { buildOpenApiDocument } from "./generate.ts";
import type {
  Task,
  TaskChangeInput,
  TaskCreateInput,
} from "../../packages/contracts/generated/auth-client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("PLANNING-001 OpenAPI keeps task mutation and projection boundaries strict", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<
      Record<string, {
        readonly get?: {
          readonly parameters?: readonly { readonly name?: string }[];
        };
      }>
    >;
    readonly components: {
      readonly schemas: Readonly<
        Record<string, {
          readonly additionalProperties?: boolean;
          readonly properties?: Readonly<
            Record<string, {
              readonly type?: string;
              readonly items?: { readonly $ref?: string };
              readonly maxItems?: number;
            }>
          >;
          readonly required?: readonly string[];
        }>
      >;
    };
  };
  for (
    const path of [
      "/api/v1/tasks",
      "/api/v1/tasks/{taskId}",
      "/api/v1/tasks/{taskId}/completion",
      "/api/v1/today/tasks",
    ]
  ) assert(Boolean(document.paths[path]), `${path} is not versioned`);
  for (
    const schema of [
      "TaskCreateInput",
      "TaskChangeInput",
      "TaskCompletionInput",
      "Task",
    ]
  ) {
    assert(
      document.components.schemas[schema]?.additionalProperties === false,
      `${schema} is not closed`,
    );
  }
  assert(
    document.components.schemas.TaskList?.properties?.items?.maxItems === 100 &&
      document.components.schemas.TaskList?.properties?.nextCursor?.type ===
        "string" &&
      document.components.schemas.TodayTasks?.properties?.items?.maxItems ===
        20 &&
      document.components.schemas.TodayTasks?.properties?.items?.items?.$ref ===
        "#/components/schemas/Task",
    "task projections are not bounded and shared",
  );
  assert(
    document.paths["/api/v1/tasks"]?.get?.parameters?.some((parameter) =>
      parameter.name === "cursor"
    ) &&
      document.components.schemas.TaskPerson?.properties?.unavailable?.type ===
        "boolean",
    "task continuation or unavailable-person projection is undocumented",
  );
  assert(
    document.components.schemas.TaskCreateInput?.required?.includes(
      "requestId",
    ) &&
      document.components.schemas.TaskChangeInput?.required?.includes(
        "expectedUpdatedAt",
      ),
    "task idempotency or optimistic change input is undocumented",
  );
  const create: TaskCreateInput = {
    personId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    title: "Call Ada",
  };
  const change: TaskChangeInput = {
    dueAt: null,
    expectedUpdatedAt: new Date().toISOString(),
    status: "cancelled",
  };
  const task = {
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    status: "open",
    title: create.title,
    updatedAt: new Date().toISOString(),
  } satisfies Task;
  const unavailableTask = {
    ...task,
    person: {
      archived: true,
      id: crypto.randomUUID(),
      name: "Deleted/Unavailable person",
      unavailable: true,
    },
  } satisfies Task;
  assert(
    change.status === "cancelled" && task.status === "open" &&
      unavailableTask.person.unavailable,
    "compile fixtures lost",
  );
});
