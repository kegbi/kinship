import { assertEquals } from "../testing/assert.ts";
import {
  correlationOf,
  fileCleanupFailed,
  LOG_EVENT_SHAPES,
  silentLogger,
} from "./telemetry.ts";

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
    ["api.request", "worker.job", "file.cleanup"],
    "three events exist, and nothing else is loggable",
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
  assertEquals(
    LOG_EVENT_SHAPES["file.cleanup"],
    { reason: "code", outcome: "code", request_id: "request-id" },
    "the cleanup line names why and how, never the file, person, or workspace",
  );
});

Deno.test("[REL-083] a cleanup that did not complete is correlated when it can be", () => {
  assertEquals(
    fileCleanupFailed("avatar-replaced", { requestId: "3f2a9c0d" }),
    {
      event: "file.cleanup",
      reason: "avatar-replaced",
      outcome: "unavailable",
      request_id: "3f2a9c0d",
    },
  );
  assertEquals(
    Object.keys(fileCleanupFailed("upload-refused", {})),
    ["event", "reason", "outcome"],
    "no request is no request identifier",
  );
  // Only a documented reason code is a reason.
  // @ts-expect-error: `avatar-lost` is not a cleanup reason.
  fileCleanupFailed("avatar-lost", {});
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

Deno.test("[MCP-A1] a correlation carries the request's token, when it has one", () => {
  const apiTokenId = "00000000-0000-4000-8000-000000000009";
  assertEquals(
    correlationOf({ apiTokenId, requestId: "3f2a9c0d" }),
    { requestId: "3f2a9c0d", apiTokenId },
    "both travel together",
  );
  assertEquals(correlationOf({ apiTokenId }), { apiTokenId });
  assertEquals(
    Object.keys(correlationOf({ apiTokenId: "", requestId: "3f2a9c0d" })),
    ["requestId"],
    "an empty token id is no member",
  );
});
