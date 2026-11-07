import {
  isConnectionLost,
  isDriverFault,
  isUniqueViolation,
  postgresErrorCode,
  postgresFailureStatus,
} from "./errors.ts";
import { assert } from "../../testing/assert.ts";

Deno.test("[GAP-010] each translated SQLSTATE maps to one kernel status", () => {
  const expected: readonly (readonly [string, string])[] = [
    ["23505", "conflict"],
    ["23503", "not-found"],
    ["40001", "unavailable"],
  ];
  for (const [code, status] of expected) {
    const mapped = postgresFailureStatus({ code });
    assert(
      mapped === status,
      `SQLSTATE ${code} must map to ${status}, received ${mapped}`,
    );
  }
  assert(
    isUniqueViolation({ code: "23505" }) &&
      !isUniqueViolation({ code: "23503" }),
    "only a unique violation is a unique violation",
  );
});

Deno.test("[GAP-010] anything that is not a driver error maps to nothing", () => {
  for (
    const error of [
      new Error("connection reset"),
      { code: 23505 },
      { detail: "no code at all" },
      "23505",
      null,
      undefined,
    ]
  ) {
    assert(
      postgresFailureStatus(error) === undefined,
      `a fault must not be translated, received ${
        postgresFailureStatus(error)
      } for ${JSON.stringify(error)}`,
    );
    assert(
      !isUniqueViolation(error),
      `a fault is not a conflict: ${JSON.stringify(error)}`,
    );
  }
  assert(
    postgresErrorCode({ code: "22P02" }) === "22P02",
    "an untranslated SQLSTATE is still readable",
  );
  assert(
    postgresFailureStatus({ code: "22P02" }) === undefined,
    "an untranslated SQLSTATE stays a fault the adapter rethrows",
  );
});

Deno.test("[AUD-W2] a lost connection is told apart from a failed statement", () => {
  for (
    const code of [
      "CONNECTION_CLOSED",
      "CONNECTION_DESTROYED",
      "CONNECTION_ENDED",
      "CONNECT_TIMEOUT",
      "ECONNRESET",
      "EPIPE",
      "57P01",
      "57P02",
      "57P03",
      "08006",
      "08P01",
    ]
  ) {
    assert(isConnectionLost({ code }), `${code} is a lost connection`);
  }
  assert(
    isConnectionLost(new Error("wrapped", { cause: { code: "57P01" } })),
    "a wrapped termination is a lost connection",
  );
  for (
    const error of [
      { code: "23505" },
      { code: "40001" },
      { code: 57 },
      new Error("plain"),
      "CONNECTION_CLOSED",
      null,
      undefined,
    ]
  ) {
    assert(!isConnectionLost(error), `${String(error)} is not a lost one`);
  }
});

/** An error whose stack is `frames`, as the runtime would render it. */
function raisedAt(message: string, ...frames: readonly string[]): Error {
  const error = new Error(message);
  error.stack = [
    `Error: ${message}`,
    ...frames.map((frame) => `    at ${frame}`),
  ]
    .join("\n");
  return error;
}

Deno.test("[AUD-W2] a fault the driver raised is told apart from application code", () => {
  const driver =
    "file:///C:/Users/u/AppData/Local/deno/npm/registry.npmjs.org/postgres/3.4.9/src/connection.js:255:22";
  for (
    const error of [
      // The audit's crash: the socket is gone when a queued write flushes.
      raisedAt(
        "Cannot read properties of null (reading 'write')",
        `Immediate.nextWrite (${driver})`,
        "ext:deno_node/internal/timers.mjs:1:1",
      ),
      // The same flush into a socket the server ended, raised by the runtime.
      raisedAt(
        "This socket has been ended by the other party",
        "Socket.writeAfterFIN (ext:deno_node/net.ts:10:3)",
        "node:internal/streams/writable:1:1",
        `Immediate.nextWrite (${driver})`,
      ),
      raisedAt(
        "x",
        "Socket.closed (/app/node_modules/.deno/postgres@3.4.9/node_modules/postgres/src/connection.js:453:57)",
      ),
      Object.assign(new Error("write CONNECTION_CLOSED"), {
        code: "CONNECTION_CLOSED",
      }),
    ]
  ) {
    assert(isDriverFault(error), `${error.message} is the driver's fault`);
  }
  for (
    const error of [
      // Application code a driver callback ran is still application code.
      raisedAt(
        "undefined is not a function",
        "deliver (file:///app/packages/backend/modules/planning/application/reminder_delivery.ts:9:1)",
        `Immediate.nextWrite (${driver})`,
      ),
      raisedAt(
        "boom",
        "file:///app/apps/worker/composition.ts:1:1",
      ),
      raisedAt("only the runtime", "ext:deno_node/net.ts:10:3"),
      new Error("no stack frames at all"),
      { code: "23505" },
      "a string",
      null,
    ]
  ) {
    assert(!isDriverFault(error), `${String(error)} is not the driver's fault`);
  }
});

/**
 * A statement error as Postgres.js returns it: built inside the driver as the
 * server's error response arrives, so its stack starts in the driver.
 */
function statementError(code: string, message: string): Error {
  const driver =
    "file:///C:/Users/u/AppData/Local/deno/npm/registry.npmjs.org/postgres/3.4.9/src/connection.js";
  return Object.assign(
    raisedAt(
      message,
      `ErrorResponse (${driver}:815:30)`,
      `handle (${driver}:489:6)`,
      `Socket.data (${driver}:330:9)`,
      "ext:deno_node/internal/streams/readable.mjs:1:1",
    ),
    { name: "PostgresError", code },
  );
}

Deno.test("[AUD-W2] a failed statement is a program fault, wherever the driver built it", () => {
  for (
    const error of [
      statementError("23505", "duplicate key value violates unique constraint"),
      statementError("22012", "division by zero"),
      statementError("23502", "null value in column violates not-null"),
      statementError("42P01", 'relation "missing" does not exist'),
      // Postgres.js's own coded client errors are program faults too.
      statementError("UNDEFINED_VALUE", "Undefined values are not allowed"),
      statementError("MAX_PARAMETERS_EXCEEDED", "Max number of parameters"),
    ]
  ) {
    assert(
      !isDriverFault(error),
      `${(error as Error & { code: string }).code} is not the driver's fault`,
    );
  }
  assert(
    isDriverFault(statementError("57P01", "terminating connection")),
    "a coded lost connection is still the driver's fault",
  );
  assert(
    isDriverFault(
      Object.assign(
        raisedAt(
          "This socket has been ended by the other party",
          "Socket.writeAfterFIN (ext:deno_node/net.ts:10:3)",
          "Immediate.nextWrite (file:///deno/npm/registry.npmjs.org/postgres/3.4.9/src/connection.js:255:22)",
        ),
        { code: "EPIPE" },
      ),
    ),
    "a write into a socket the server ended is a lost connection",
  );
});
