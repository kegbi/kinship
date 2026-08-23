import document from "./openapi/openapi.json" with { type: "json" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("AUTH-005 contract exposes preview, leave, and reauthenticated identity deletion", () => {
  const paths = document.paths as Record<string, Record<string, unknown>>;
  assert(
    paths["/api/v1/settings/personal-lifecycle"]?.get !== undefined,
    "impact preview operation",
  );
  assert(
    paths["/api/v1/settings/personal-lifecycle"]?.delete !== undefined,
    "personal identity deletion operation",
  );
  assert(
    paths["/api/v1/settings/personal-lifecycle/leave"]?.post !== undefined,
    "leave operation",
  );
  const schemas = document.components.schemas as Record<
    string,
    { readonly required?: readonly string[] }
  >;
  assert(
    schemas.PersonalIdentityDeletionInput?.required?.includes("password"),
    "deletion requires reauthentication credential",
  );
  assert(
    schemas.PersonalIdentityDeletionInput?.required?.includes("confirmation"),
    "deletion requires exact confirmation",
  );
  assert(
    schemas.PersonalLifecycleConfirmation?.required?.includes("password"),
    "leave requires recent authentication",
  );
  assert(
    schemas.PersonalLifecyclePreview?.required?.includes("blockingWorkspaces"),
    "preview includes final-owner impact",
  );
  const leave = paths["/api/v1/settings/personal-lifecycle/leave"]?.post as {
    readonly responses?: Record<string, unknown>;
  };
  assert(leave.responses?.["429"] !== undefined, "step-up rate limit response");
  assert(
    JSON.stringify(schemas.PersonalLifecyclePreview).includes("suspended"),
    "preview includes non-left suspended memberships",
  );
});
