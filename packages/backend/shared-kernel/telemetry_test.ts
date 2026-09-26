import { assertEquals } from "../testing/assert.ts";
import { correlationOf, LOG_EVENT_SHAPES, silentLogger } from "./telemetry.ts";

Deno.test("[GAP-039] a correlation is carried only when there is one", () => {
  assertEquals(
    correlationOf({ requestId: "3f2a9c0d" }),
    { requestId: "3f2a9c0d" },
    "a request identifier travels as it arrived",
  );
  assertEquals(
    Object.keys(correlationOf({})),
    [],
    "no identifier is no member, never an empty one",
  );
  assertEquals(
    Object.keys(correlationOf({ requestId: "" })),
    [],
    "an empty identifier is not an identifier",
  );
});

Deno.test("[GAP-039] the catalogue declares every loggable field and its class", () => {
  assertEquals(
    Object.keys(LOG_EVENT_SHAPES),
    ["api.request", "worker.job"],
    "two events exist, and nothing else is loggable",
  );
  assertEquals(
    LOG_EVENT_SHAPES["api.request"],
    {
      method: "method",
      route: "route",
      status: "status",
      duration_ms: "milliseconds",
      request_id: "request-id",
    },
    "the request line has no field for a header, a cookie, a query, or a body",
  );
  assertEquals(
    LOG_EVENT_SHAPES["worker.job"],
    {
      job: "code",
      request_id: "request-id",
      attempt: "count",
      outcome: "code",
      duration_ms: "milliseconds",
    },
    "the job line names the run and how it ended, never what it worked on",
  );
});

Deno.test("[GAP-039] the silent logger drops everything", () => {
  assertEquals(
    silentLogger().log({
      event: "worker.job",
      job: "reminder-delivery",
      request_id: "run-1",
      attempt: 1,
      outcome: "sent",
      duration_ms: 0,
    }),
    undefined,
    "nothing is returned and nothing is written",
  );
});
