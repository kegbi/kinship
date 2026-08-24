import * as client from "./generated/auth-client.ts";
import document from "./openapi/openapi.json" with { type: "json" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("INTEGRATION-001 OpenAPI publishes scoped DAV management without readable secrets", () => {
  const paths = document.paths as Record<string, Record<string, unknown>>;
  assert(
    paths["/api/v1/settings/integrations/dav"]?.get,
    "DAV list documented",
  );
  assert(
    paths["/api/v1/settings/integrations/dav"]?.post,
    "DAV configure documented",
  );
  assert(
    paths["/api/v1/settings/integrations/dav/{subscriptionId}/sync"]?.post,
    "DAV sync documented",
  );
  assert(
    paths["/api/v1/settings/integrations/dav/{subscriptionId}"]?.delete,
    "DAV disable documented",
  );
  const schemas = document.components.schemas as Record<
    string,
    {
      properties?: Record<
        string,
        { maxLength?: number; writeOnly?: boolean }
      >;
    }
  >;
  assert(
    schemas.DavSubscriptionInput?.properties?.password?.writeOnly === true,
    "DAV secret is write-only",
  );
  assert(
    !schemas.DavSubscription?.properties?.password,
    "DAV response has no secret",
  );
  assert(
    schemas.DavSubscriptionInput?.properties?.remoteUrl?.maxLength === 2_048 &&
      schemas.DavSubscription?.properties?.remoteUrl?.maxLength === 2_048,
    "DAV URL limit is identical on request and response contracts",
  );
  assert(
    typeof client.getDavSubscriptions === "function",
    "generated list client exists",
  );
  assert(
    typeof client.synchronizeDavSubscription === "function",
    "generated sync client exists",
  );
});
