import { assert, assertEquals } from "../../testing/assert.ts";
import type { LogEvent } from "../../shared-kernel/telemetry.ts";
import { acceptsLogValue, jsonLogger, redactLogEvent } from "./json_logger.ts";

const PERSON_ID = "5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f";
const WORKSPACE_ID = "0b6d8e2f-1a3c-4d5e-8f7a-9b0c1d2e3f4a";
const AUTHORIZATION = "Bearer kinship_pat_4c1f9e2d7b";
const COOKIE = "kinship_session=session-secret-8a7b";
const QUERY = "?token=reset-secret-51c2&email=someone%40example.com";
const FREE_FORM =
  "connect ECONNREFUSED 10.0.0.7:5432 while saving Ada Lovelace";

function captured(): { readonly lines: string[]; write(line: string): void } {
  const lines: string[] = [];
  return { lines, write: (line) => void lines.push(line) };
}

/** An event with fields the catalogue does not declare, as a cast allows. */
function smuggled(
  event: LogEvent,
  extra: Readonly<Record<string, unknown>>,
): LogEvent {
  return { ...event, ...extra } as unknown as LogEvent;
}

const REQUEST: LogEvent = {
  event: "api.request",
  method: "GET",
  route: "/api/v1/people/:personId/gifts",
  status: 200,
  duration_ms: 4,
  request_id: "3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d",
};

const JOB: LogEvent = {
  event: "worker.job",
  job: "reminder-delivery",
  request_id: "8b1e6c52-7f0a-4d3e-9c21-5a6b7c8d9e0f",
  attempt: 2,
  outcome: "retry",
  duration_ms: 17,
};

Deno.test("[GAP-039] the api.request line keeps its exact shape and order", () => {
  const sink = captured();
  jsonLogger(sink.write).log(REQUEST);

  assertEquals(
    sink.lines,
    [
      '{"event":"api.request","method":"GET",' +
      '"route":"/api/v1/people/:personId/gifts","status":200,' +
      '"duration_ms":4,"request_id":"3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d"}\n',
    ],
    "one newline-terminated JSON object, fields in the kit's order",
  );
});

Deno.test("[GAP-039] the worker.job line carries attempt, outcome, and duration", () => {
  const sink = captured();
  jsonLogger(sink.write).log(JOB);

  assertEquals(
    sink.lines,
    [
      '{"event":"worker.job","job":"reminder-delivery",' +
      '"request_id":"8b1e6c52-7f0a-4d3e-9c21-5a6b7c8d9e0f",' +
      '"attempt":2,"outcome":"retry","duration_ms":17}\n',
    ],
    "the job line names the run, never the occurrence it worked on",
  );
});

Deno.test("[REL-083] the file.cleanup line names why and how, never which file", () => {
  const sink = captured();
  jsonLogger(sink.write).log(smuggled({
    event: "file.cleanup",
    reason: "avatar-replaced",
    outcome: "unavailable",
    request_id: "3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d",
  }, {
    fileId: PERSON_ID,
    filename: "ada lovelace.png",
    workspaceId: WORKSPACE_ID,
  }));
  jsonLogger(sink.write).log({
    event: "file.cleanup",
    reason: PERSON_ID,
    outcome: FREE_FORM,
  });

  assertEquals(
    sink.lines,
    [
      '{"event":"file.cleanup","reason":"avatar-replaced",' +
      '"outcome":"unavailable",' +
      '"request_id":"3f2a9c0d8e7b6a5f4e3d2c1b0a9f8e7d"}\n',
      '{"event":"file.cleanup"}\n',
    ],
    "an identifier, a filename, or free text never reaches the stream",
  );
});

Deno.test("[GAP-039] forbidden values in undeclared fields never reach the stream", () => {
  const sink = captured();
  const logger = jsonLogger(sink.write);
  logger.log(smuggled(REQUEST, {
    personId: PERSON_ID,
    workspace: WORKSPACE_ID,
    authorization: AUTHORIZATION,
    cookie: COOKIE,
    query: QUERY,
    message: FREE_FORM,
    error: { message: FREE_FORM, stack: "at save (people.ts:1:1)" },
  }));
  logger.log(smuggled(JOB, {
    occurrenceId: PERSON_ID,
    workspaceId: WORKSPACE_ID,
    error: FREE_FORM,
  }));

  const written = sink.lines.join("");
  for (
    const secret of [
      PERSON_ID,
      WORKSPACE_ID,
      AUTHORIZATION,
      "session-secret-8a7b",
      "reset-secret-51c2",
      "example.com",
      "ECONNREFUSED",
      "Ada Lovelace",
      "people.ts",
    ]
  ) {
    assert(!written.includes(secret), `the stream exposed ${secret}`);
  }
  assertEquals(sink.lines.length, 2, "both events are still logged");
  assertEquals(
    Object.keys(JSON.parse(sink.lines[0]!)).join(","),
    "event,method,route,status,duration_ms,request_id",
    "only the declared request fields remain",
  );
  assertEquals(
    Object.keys(JSON.parse(sink.lines[1]!)).join(","),
    "event,job,request_id,attempt,outcome,duration_ms",
    "only the declared job fields remain",
  );
});

Deno.test("[GAP-039] a declared field that carries a forbidden value is stripped", () => {
  const line = redactLogEvent(smuggled(REQUEST, {
    method: "GET /api/v1/people",
    route: `/api/v1/people/${PERSON_ID}/gifts${QUERY}`,
    request_id: "not a token\nwith a newline",
    status: "200",
    duration_ms: -1,
  }));

  assertEquals(
    line,
    { event: "api.request" },
    "a concrete path, a query, a spoofed identifier, and a non-number are not their classes",
  );

  const job = redactLogEvent(smuggled(JOB, {
    job: WORKSPACE_ID,
    outcome: FREE_FORM,
    attempt: 1.5,
  }));
  assertEquals(
    job,
    {
      event: "worker.job",
      request_id: "8b1e6c52-7f0a-4d3e-9c21-5a6b7c8d9e0f",
      duration_ms: 17,
    },
    "an identifier or a message is not a code, and a fraction is not a count",
  );
});

Deno.test("[GAP-039] an event outside the catalogue is refused, not written", () => {
  const sink = captured();
  jsonLogger(sink.write).log(
    { event: "debug", message: FREE_FORM } as unknown as LogEvent,
  );
  jsonLogger(sink.write).log({ message: FREE_FORM } as unknown as LogEvent);

  assertEquals(sink.lines, [], "no line for an undeclared event");
});

Deno.test("[GAP-039] each value class accepts what it names and nothing else", () => {
  const cases: ReadonlyArray<
    readonly [Parameters<typeof acceptsLogValue>[0], unknown, boolean]
  > = [
    ["code", "manual_attention", true],
    ["code", "processing-error", true],
    ["code", "Processing failed", false],
    ["code", PERSON_ID, false],
    ["code", "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", false],
    ["code", 3, false],
    ["count", 0, true],
    ["count", Number.NaN, false],
    ["method", "PATCH", true],
    ["method", "get", false],
    ["milliseconds", 12, true],
    ["milliseconds", "12", false],
    ["request-id", "minted-1", true],
    ["request-id", "x".repeat(129), false],
    ["route", "unmatched", true],
    ["route", "/api/v1/*", true],
    ["route", "/api/v1/people?token=1", false],
    ["route", `/api/v1/people/${PERSON_ID}`, false],
    ["route", "people", false],
    ["route", `/${"a".repeat(300)}`, false],
    ["status", 503, true],
    ["status", 99, false],
    ["status", 600, false],
  ];
  for (const [fieldClass, value, expected] of cases) {
    assertEquals(
      acceptsLogValue(fieldClass, value),
      expected,
      `${fieldClass} ${String(value).slice(0, 40)}`,
    );
  }
});

Deno.test("[GAP-039] the default destination is one JSON line on stdout", () => {
  const written: string[] = [];
  const original = Deno.stdout.writeSync.bind(Deno.stdout);
  Deno.stdout.writeSync = (bytes: Uint8Array) => {
    written.push(new TextDecoder().decode(bytes));
    return bytes.byteLength;
  };
  try {
    jsonLogger().log(JOB);
  } finally {
    Deno.stdout.writeSync = original;
  }

  assertEquals(written.length, 1, "exactly one write");
  assert(
    written[0]!.startsWith('{"event":"worker.job"') &&
      written[0]!.endsWith("}\n"),
    "a newline-terminated JSON object",
  );
});
