/**
 * What `defineRoute` refuses, and why the refusals are worth having.
 *
 * The registry is the one place a route is written down, so the mistakes it
 * can catch are the ones nothing else would: a path template naming a
 * parameter the descriptor never declares, a declared parameter the template
 * never names, an answer filed under something that is not an HTTP status, and
 * two routes claiming one operation id or one method and path. Each of those
 * was a live defect in the hand-written document this replaced — twelve
 * operations declared a path parameter in one place and not the other — so the
 * checks run when a module loads rather than on the request that reaches them.
 */

import { z } from "zod";
import {
  collectRoutes,
  defineRoute,
  honoPath,
  pathParameters,
  routeKey,
} from "./registry.ts";
import { assert, assertThrows } from "../backend/testing/assert.ts";
import { uuid } from "./schemas/shared.ts";
import document from "./openapi/openapi.json" with { type: "json" };

const answered = {
  200: { description: "ok" },
} as const;

Deno.test("[GAP-022] a path template and its declared parameters must agree", () => {
  assertThrows(
    () =>
      defineRoute({
        method: "get",
        path: "api/v1/people",
        operationId: "unrooted",
        responses: answered,
      }),
    "a path that is not rooted is refused",
  );
  assertThrows(
    () =>
      defineRoute({
        method: "get",
        path: "/api/v1/people/{personId}",
        operationId: "undeclared",
        responses: answered,
      }),
    "a template parameter nothing declares is refused",
  );
  assertThrows(
    () =>
      defineRoute({
        method: "get",
        path: "/api/v1/people",
        operationId: "unused",
        request: { params: z.object({ personId: uuid }) },
        responses: answered,
      }),
    "a declared parameter the template never names is refused",
  );
  assertThrows(
    () =>
      defineRoute({
        method: "get",
        path: "/api/v1/people",
        operationId: "misfiled",
        responses: { "2xx": { description: "ok" } },
      }),
    "an answer under something that is not a status is refused",
  );
});

Deno.test("[GAP-022] a descriptor knows the path both sides of it match on", () => {
  const route = defineRoute({
    method: "delete",
    path: "/api/v1/people/{personId}/files/{fileId}",
    operationId: "removePersonFile",
    request: { params: z.object({ personId: uuid, fileId: uuid }) },
    responses: answered,
  });
  assert(
    JSON.stringify(pathParameters(route.path)) ===
      JSON.stringify(["personId", "fileId"]),
    "the template's parameters are read in the order it names them",
  );
  assert(
    honoPath(route.path) === "/api/v1/people/:personId/files/:fileId",
    "Hono matches on the same path the document publishes",
  );
  assert(
    routeKey(route) === "DELETE /api/v1/people/:personId/files/:fileId",
    "a route is identified to both sides by method and matched path",
  );
});

Deno.test("[GAP-022] two routes may not claim one name or one address", () => {
  const first = defineRoute({
    method: "get",
    path: "/api/v1/people",
    operationId: "listPeople",
    responses: answered,
  });
  const renamed = defineRoute({
    method: "get",
    path: "/api/v1/people/tag-options",
    operationId: "listPeople",
    responses: answered,
  });
  const second = defineRoute({
    method: "get",
    path: "/api/v1/people",
    operationId: "listPeopleAgain",
    responses: answered,
  });
  assert(collectRoutes([[first]]).length === 1, "one surface gathers");
  assertThrows(
    () => collectRoutes([[first], [renamed]]),
    "two routes may not share an operation id",
  );
  assertThrows(
    () => collectRoutes([[first], [second]]),
    "two routes may not answer the same method and path",
  );
});

/** A schema as far as the paging convention cares about it. */
interface PagedSchema {
  readonly $ref?: string;
  readonly default?: unknown;
  readonly maxItems?: number;
  readonly maxLength?: number;
  readonly maximum?: number;
  readonly minimum?: number;
  readonly properties?: Readonly<Record<string, PagedSchema>>;
  readonly required?: readonly string[];
  readonly type?: string;
}

interface PagedOperation {
  readonly parameters?: readonly {
    readonly in: string;
    readonly name: string;
    readonly required?: boolean;
    readonly schema: PagedSchema;
  }[];
  readonly responses: Readonly<
    Record<string, {
      readonly content?: Readonly<
        Record<string, { readonly schema: PagedSchema }>
      >;
    }>
  >;
}

/**
 * Every list GAP-023 put under the one convention: the path, the cursor
 * parameters it accepts, the collections it pages, and the continuation each
 * collection answers with.
 */
const PAGED_LISTS = [
  ["/api/v1/tasks", ["cursor"], [["items", "nextCursor"]]],
  [
    "/api/v1/people/{personId}/relationships",
    ["cursor"],
    [["relationships", "nextCursor"]],
  ],
  [
    "/api/v1/people/{personId}/gifts",
    ["giftCursor", "debtCursor"],
    [["gifts", "nextGiftCursor"], ["debts", "nextDebtCursor"]],
  ],
  ["/api/v1/people/{personId}/files", ["cursor"], [["files", "nextCursor"]]],
  [
    "/api/v1/people/{personId}/reminders",
    ["cursor"],
    [["reminders", "nextCursor"]],
  ],
  ["/api/v1/journal", ["cursor"], [["items", "nextCursor"]]],
] as const;

Deno.test("[GAP-023] every paged list publishes the one page convention", () => {
  const published = document as unknown as {
    readonly components: {
      readonly schemas: Readonly<Record<string, PagedSchema>>;
    };
    readonly paths: Readonly<Record<string, { readonly get: PagedOperation }>>;
  };
  for (const [path, cursors, collections] of PAGED_LISTS) {
    const operation = published.paths[path]?.get;
    assert(operation !== undefined, `${path} is not documented`);
    const query = new Map(
      (operation.parameters ?? [])
        .filter((parameter) => parameter.in === "query")
        .map((parameter) => [parameter.name, parameter]),
    );
    const limit = query.get("limit");
    assert(
      limit !== undefined && limit.required !== true &&
        limit.schema.type === "integer" && limit.schema.minimum === 1 &&
        limit.schema.maximum === 50 && limit.schema.default === 20,
      `${path} does not publish limit as 1-50, default 20`,
    );
    for (const name of cursors) {
      const cursor = query.get(name);
      assert(
        cursor !== undefined && cursor.required !== true &&
          cursor.schema.type === "string" && cursor.schema.maxLength === 2000,
        `${path} does not publish an optional bounded ${name}`,
      );
    }
    assert(
      operation.responses["400"] !== undefined,
      `${path} does not document the refusal of a malformed cursor`,
    );
    const reference = operation.responses["200"]?.content?.["application/json"]
      ?.schema.$ref;
    const answer = published.components.schemas[
      reference?.replace("#/components/schemas/", "") ?? ""
    ];
    assert(answer !== undefined, `${path} answers no named page`);
    for (const [collection, continuation] of collections) {
      assert(
        answer.properties?.[collection]?.maxItems === 50,
        `${path} does not bound ${collection} by the page`,
      );
      assert(
        answer.properties?.[continuation]?.type === "string" &&
          !(answer.required ?? []).includes(continuation),
        `${path} does not publish ${continuation} as present only with more rows`,
      );
    }
  }
});
