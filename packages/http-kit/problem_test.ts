import { Hono } from "hono";
import {
  assert,
  assertEquals,
  assertStatus,
} from "../backend/testing/assert.ts";
import {
  definedProblem,
  problem,
  PROBLEM_TYPE_PREFIX,
  problemBody,
} from "./problem.ts";

Deno.test("[GAP-019] a problem carries the body every route already emitted", async () => {
  const app = new Hono();
  app.get("/refused", (context) =>
    problem(
      context,
      404,
      "gift_not_found",
      "Record unavailable",
      "The gift does not exist.",
    ));
  const response = await app.request("http://localhost/refused");

  assertStatus(response, 404);
  assertEquals(
    response.headers.get("Content-Type"),
    "application/problem+json",
    "a problem declares the problem media type",
  );
  assertEquals(
    response.headers.get("Cache-Control"),
    "no-store",
    "a refusal is never cached",
  );
  assertEquals(
    await response.text(),
    JSON.stringify({
      type: "https://kinship.test/problems/gift_not_found",
      title: "Record unavailable",
      status: 404,
      detail: "The gift does not exist.",
      code: "gift_not_found",
    }),
    "the body, member by member and in order",
  );
});

Deno.test("[GAP-019] field errors are carried only when a route has them", async () => {
  const app = new Hono();
  app.post("/refused", (context) =>
    problem(
      context,
      400,
      "task_validation_failed",
      "Invalid task",
      "Review.",
      { title: "Give the task a title." },
    ));
  const response = await app.request("http://localhost/refused", {
    method: "POST",
  });
  const body = await response.json() as {
    readonly errors?: Record<string, string>;
  };

  assertStatus(response, 400);
  assertEquals(
    body.errors?.title,
    "Give the task a title.",
    "the field message reaches the client",
  );
  assert(
    !("errors" in problemBody(400, "code", "Title", "Detail")),
    "a problem without field errors omits the member entirely",
  );
});

Deno.test("[GAP-019] the problem type is the code behind the stable prefix", () => {
  assertEquals(
    problemBody(503, "gifts_unavailable", "Gifts unavailable", "Later.").type,
    `${PROBLEM_TYPE_PREFIX}gifts_unavailable`,
    "the type identifies the code",
  );
});

Deno.test("[GAP-019] a named definition answers exactly what it declares", async () => {
  const app = new Hono();
  app.delete("/refused", (context) =>
    definedProblem(context, {
      code: "origin_invalid",
      detail: "Not the configured origin.",
      status: 403,
      title: "Request forbidden",
    }));
  const response = await app.request("http://localhost/refused", {
    method: "DELETE",
  });
  const body = await response.json() as {
    readonly code: string;
    readonly detail: string;
    readonly status: number;
    readonly title: string;
  };

  assertStatus(response, 403);
  assertEquals(
    [body.code, body.title, body.detail, body.status].join("|"),
    ["origin_invalid", "Request forbidden", "Not the configured origin.", 403]
      .join("|"),
    "the definition is reproduced verbatim",
  );
});
