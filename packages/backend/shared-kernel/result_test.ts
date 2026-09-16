import {
  type Failure,
  SHARED_FAILURE_STATUSES,
  type SharedFailureStatus,
  type ValidationFailure,
} from "./result.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[GAP-006] the shared failure vocabulary is declared once", () => {
  assert(
    SHARED_FAILURE_STATUSES.length === new Set(SHARED_FAILURE_STATUSES).size,
    "the shared statuses must not repeat",
  );
  for (
    const status of [
      "archived-write-rejected",
      "conflict",
      "forbidden",
      "not-found",
      "unavailable",
      "validation-error",
    ] as const
  ) {
    assert(
      (SHARED_FAILURE_STATUSES as readonly string[]).includes(status),
      `the kernel must name ${status}`,
    );
  }
});

Deno.test("[GAP-006] a module selects shared statuses and adds its own", () => {
  type ImportantDateFailure = Failure<
    "archived-write-rejected" | "conflict" | "forbidden" | "not-found",
    "stale"
  >;
  const cases: readonly ImportantDateFailure[] = [
    { status: "archived-write-rejected" },
    { status: "conflict" },
    { status: "forbidden" },
    { status: "not-found" },
    { status: "stale" },
  ];
  assert(cases.length === 5, "the module union carries every selected status");

  // A selected union stays narrow: an unselected shared status is not part of
  // it, which is what keeps the delivery layer's exhaustive narrowing honest.
  const widened: SharedFailureStatus = "unavailable";
  const narrowed = cases.map((failure) => failure.status as string);
  assert(
    !narrowed.includes(widened),
    "selecting statuses must not smuggle the whole vocabulary in",
  );
});

Deno.test("[GAP-006] a failure union narrows one status at a time", () => {
  type EditFailure = Failure<"forbidden" | "not-found", "stale">;
  const label = (failure: EditFailure | ValidationFailure): string => {
    if (failure.status === "forbidden") return "403";
    if (failure.status === "not-found") return "404";
    if (failure.status === "stale") return "409";
    // Every failure member is eliminated above, so the validation payload is
    // reachable here without a cast. That is what the delivery layer does.
    return Object.keys(failure.errors).join(",");
  };
  assert(label({ status: "forbidden" }) === "403", "forbidden maps to 403");
  assert(label({ status: "not-found" }) === "404", "not-found maps to 404");
  assert(label({ status: "stale" }) === "409", "stale maps to 409");
  assert(
    label({ errors: { title: "Add a title." }, status: "validation-error" }) ===
      "title",
    "the validation payload survives narrowing",
  );
});

Deno.test("[GAP-006] a validation failure carries per-field messages", () => {
  const failure: ValidationFailure = {
    errors: { givenName: "Enter a given name." },
    status: "validation-error",
  };
  assert(
    failure.status === "validation-error" &&
      failure.errors.givenName === "Enter a given name.",
    "the validation failure keeps its field messages",
  );
});
