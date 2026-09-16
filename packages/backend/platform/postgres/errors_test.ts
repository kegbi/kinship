import {
  isUniqueViolation,
  postgresErrorCode,
  postgresFailureStatus,
} from "./errors.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
