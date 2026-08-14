import { buildOpenApiDocument, renderGeneratedClient } from "./generate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("AUTH-001 OpenAPI is deterministic 3.1 with RFC 9457 problems", () => {
  const first = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const second = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  assert(first === second, "OpenAPI generation must be byte stable");
  const document = buildOpenApiDocument();
  assert(document.openapi === "3.1.0", "contract must use OpenAPI 3.1");
  assert(
    first.includes("application/problem+json"),
    "contract must describe RFC 9457 responses",
  );
  assert(
    !first.includes("entryToken") && !first.includes("verificationToken"),
    "public contract must not expose secret fields",
  );
  assert(
    renderGeneratedClient().includes("/api/v1/registrations"),
    "generated client must consume registration contract",
  );
  const text = JSON.stringify(document);
  assert(
    text.includes('"/api/v1/application-entry":{"post"') &&
      !text.includes('"/api/v1/application-entry":{"get"'),
    "application entry is POST-only",
  );
  assert(
    (text.match(/"503"/g)?.length ?? 0) >= 3,
    "registration, verification, and entry document dependency failures",
  );
  const components = document.components as {
    securitySchemes?: Record<string, unknown>;
  };
  assert(
    JSON.stringify(components.securitySchemes?.kinship_entry).includes(
      '"in":"cookie"',
    ),
    "application entry must declare its cookie handoff security scheme",
  );
  assert(
    text.includes('"security":[{"kinship_entry":[]}]') &&
      text.includes("exact Origin header") &&
      text.includes("SameSite=Strict") && text.includes("Secure"),
    "entry contract must document browser-only origin and cookie semantics",
  );
});
