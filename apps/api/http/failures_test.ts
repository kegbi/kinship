/**
 * The pin on every refusal the migrated route files answer with.
 *
 * The web app reads `code`; a person reads `title` and `detail`. Both are
 * contract, and GAP-019 moved every one of them out of a hand-written `if`
 * chain into a table, so the table is compared here against the exact prose
 * the chains produced before the move. A wording change is allowed — it is
 * just not allowed to be silent.
 */

import { Hono } from "hono";
import { SHARED_FAILURE_STATUSES } from "../../../packages/backend/shared-kernel/result.ts";
import {
  assert,
  assertEquals,
  assertStatus,
  assertThrows,
} from "../../../packages/backend/testing/assert.ts";
import { GIFT_FAILURES } from "../gifts.ts";
import { JOURNAL_FAILURES } from "../journal.ts";
import {
  PLANNING_PROBLEMS,
  REMINDER_FAILURES,
  TASK_FAILURES,
} from "../planning.ts";
import {
  failureDefinitions,
  failureResponder,
  type FailureTable,
  KERNEL_FAILURE_STATUS,
} from "./failures.ts";
import type { ProblemDefinition } from "./problem.ts";

/** `status code title detail`, one line per entry, in table order. */
function pinned(table: FailureTable): string {
  const lines = [...failureDefinitions(table)].map(([name, definition]) =>
    [
      name,
      definition.status,
      definition.code,
      definition.title,
      definition.detail,
    ].join(" | ")
  );
  const fallback = table.fallback;
  return [
    ...lines,
    [
      "(fallback)",
      fallback.status,
      fallback.code,
      fallback.title,
      fallback.detail,
    ].join(" | "),
  ].join("\n");
}

Deno.test("[GAP-019] the gifts failure table is what gifts.ts answered", () => {
  assertEquals(
    pinned(GIFT_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the person before changing gifts or debts.",
      "forbidden | 403 | gifts_forbidden | Gifts unavailable | Your active workspace membership no longer permits this action.",
      "invalid-transition | 409 | gift_transition_invalid | Status cannot be changed | Refresh the record and choose a valid next status.",
      "not-found | 404 | gift_not_found | Record unavailable | The person, recipient, attachment, gift, or debt does not exist in the active workspace.",
      "validation-error | 400 | gift_invalid | Invalid gift or debt | Review the amount, currency, recipient, attachment, and other fields.",
      "(fallback) | 503 | gifts_unavailable | Gifts unavailable | Gifts and debts are temporarily unavailable.",
    ].join("\n"),
    "gifts problems",
  );
});

Deno.test("[GAP-019] the journal failure table is what journal.ts answered", () => {
  assertEquals(
    pinned(JOURNAL_FAILURES),
    [
      "forbidden | 403 | journal_forbidden | Journal unavailable | Your active workspace membership no longer permits this action.",
      "not-found | 404 | journal_item_not_found | Journal item unavailable | This item does not exist in the active workspace.",
      "validation-error | 400 | journal_invalid | Invalid journal item | Review the date, rating, title, and content.",
      "(fallback) | 503 | journal_unavailable | Journal unavailable | The journal is temporarily unavailable.",
    ].join("\n"),
    "journal problems",
  );
});

Deno.test("[GAP-019] the task failure table is what planning.ts answered", () => {
  assertEquals(
    pinned(TASK_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the linked person before changing this task.",
      "forbidden | 403 | tasks_forbidden | Tasks unavailable | Your active workspace membership no longer permits this action.",
      "idempotency-conflict | 409 | task_request_conflict | Request identifier already used | Use a new request identifier when the task payload changes.",
      "not-found | 404 | task_not_found | Task unavailable | The task or linked person does not exist in the active workspace.",
      "stale | 409 | task_stale | Task changed | Refresh the task before saving your edits.",
      "stale-cursor | 409 | task_cursor_stale | Task list changed | Reload the first task page before continuing.",
      "(fallback) | 400 | task_validation_failed | Invalid task | Review the task fields and try again.",
    ].join("\n"),
    "task problems",
  );
});

Deno.test("[GAP-019] the reminder failure table is what planning.ts answered", () => {
  assertEquals(
    pinned(REMINDER_FAILURES),
    [
      "archived-write-rejected | 409 | archived_write_rejected | Archived person is read-only | Restore the person before changing reminders.",
      "forbidden | 403 | reminders_forbidden | Reminders unavailable | Your active membership no longer permits this action.",
      "idempotency-conflict | 409 | reminder_request_conflict | Request identifier already used | Use a new request identifier when reminder fields change.",
      "not-found | 404 | reminder_not_found | Reminder unavailable | The reminder or person does not exist in the active workspace.",
      "(fallback) | 400 | reminder_validation_failed | Invalid reminder | Review the calendar reminder fields.",
    ].join("\n"),
    "reminder problems",
  );
});

Deno.test("[GAP-019] the problems planning answers on its own are unchanged", () => {
  assertEquals(
    PLANNING_PROBLEMS.map((definition: ProblemDefinition) =>
      [
        definition.status,
        definition.code,
        definition.title,
        definition.detail,
      ].join(" | ")
    ).join("\n"),
    [
      "400 | cadence_request_invalid | Invalid stay-in-touch cadence | Use a supported calendar interval.",
      "400 | reminder_request_invalid | Invalid reminder | Use a canonical reminder and explicit active state.",
      "400 | reminder_request_invalid | Invalid reminder | Use supported calendar fields and canonical identifiers.",
      "400 | reminder_query_invalid | Invalid reminder query | Use a canonical person identifier.",
      "503 | reminders_unavailable | Reminders unavailable | Nothing was changed.",
      "503 | reminders_unavailable | Reminders unavailable | Nothing was saved.",
      "503 | reminders_unavailable | Reminders unavailable | Other person sections remain available.",
      "400 | task_request_invalid | Invalid task | Use a canonical task and at least one supported change.",
      "400 | task_request_invalid | Invalid task | Use a canonical task and explicit completion state.",
      "400 | task_request_invalid | Invalid task | Use supported task fields and canonical identifiers.",
      "400 | task_query_invalid | Invalid task query | Use a canonical person, supported state, and bounded limit.",
      "503 | tasks_unavailable | Tasks unavailable | Saved tasks were not changed.",
      "503 | tasks_unavailable | Tasks unavailable | Nothing was changed.",
      "503 | tasks_unavailable | Tasks unavailable | Nothing was saved. Try again when the service is available.",
      "503 | today_attention_unavailable | Attention unavailable | Other Today regions remain available. Retry the attention queue.",
      "503 | today_reminders_unavailable | Reminder region unavailable | Other Today regions remain available.",
      "503 | today_tasks_unavailable | Due tasks unavailable | Other Today regions remain available.",
    ].join("\n"),
    "planning's own problems",
  );
});

Deno.test("[GAP-019] every shared kernel failure has one HTTP status", () => {
  const mapped = KERNEL_FAILURE_STATUS as Record<string, number | undefined>;
  for (const status of SHARED_FAILURE_STATUSES) {
    assert(
      mapped[status] !== undefined,
      `the kernel status ${status} has no HTTP status`,
    );
  }
  assertEquals(
    Object.keys(KERNEL_FAILURE_STATUS).length,
    SHARED_FAILURE_STATUSES.length,
    "the map names the shared vocabulary and nothing else",
  );
});

Deno.test("[GAP-019] a responder answers named statuses and falls back to the rest", async () => {
  const respond = failureResponder({
    fallback: {
      code: "widgets_unavailable",
      detail: "Later.",
      status: 503,
      title: "Widgets unavailable",
    },
    statuses: {
      "not-found": {
        code: "widget_not_found",
        detail: "No such widget.",
        title: "Widget unavailable",
      },
    },
  });
  const app = new Hono();
  app.get("/named", (context) => respond(context, "not-found"));
  app.get("/fallback", (context) => respond(context, { status: "exploded" }));
  app.get(
    "/errors",
    (context) =>
      respond(context, { errors: { name: "Too short." }, status: "nope" }),
  );
  app.get(
    "/named-ignores-errors",
    (context) =>
      respond(context, { errors: { name: "Too short." }, status: "not-found" }),
  );

  const named = await app.request("http://localhost/named");
  const fallback = await app.request("http://localhost/fallback");
  const errors = await app.request("http://localhost/errors");
  const ignored = await app.request("http://localhost/named-ignores-errors");

  assertStatus(named, 404);
  assertStatus(fallback, 503);
  assertEquals(
    ((await errors.json()) as { readonly errors?: Record<string, string> })
      .errors?.name,
    "Too short.",
    "the fallback carries the result's field messages",
  );
  assert(
    !("errors" in (await ignored.json() as Record<string, unknown>)),
    "a named failure says only what its table declares",
  );
});

Deno.test("[GAP-019] a status outside the kernel vocabulary must declare its own", () => {
  assertThrows(
    () =>
      failureResponder({
        fallback: {
          code: "widgets_unavailable",
          detail: "Later.",
          status: 503,
          title: "Widgets unavailable",
        },
        statuses: {
          "spun-too-fast": {
            code: "widget_spun",
            detail: "Slow down.",
            title: "Widget spun",
          },
        },
      }),
    "a table with an unmapped status is refused when it is composed",
  );
});
