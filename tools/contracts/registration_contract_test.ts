import {
  buildOpenApiDocument,
  renderGeneratedClient,
  renderInvitationClient,
} from "./generate.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("AUTH-001/AUTH-002/AUTH-003 OpenAPI is deterministic and secret-safe", () => {
  const first = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const second = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  assert(first === second, "OpenAPI generation must be byte stable");
  const document = buildOpenApiDocument();
  const generatedClient = renderGeneratedClient() + renderInvitationClient();
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
    generatedClient.includes("/api/v1/registrations"),
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
  for (
    const path of [
      "/api/v1/sessions",
      "/api/v1/mfa-challenges",
      "/api/v1/password-reset-requests",
      "/api/v1/password-resets",
      "/api/v1/session",
      "/api/v1/sign-out",
      "/api/v1/workspace-members",
      "/api/v1/workspace-invitations",
      "/api/v1/workspace-invitations/inspect",
      "/api/v1/workspace-invitations/accept",
    ]
  ) {
    assert(text.includes(JSON.stringify(path)), `${path} must be documented`);
    assert(
      generatedClient.includes(path),
      `${path} must have a generated frontend call`,
    );
  }
  assert(
    JSON.stringify(components.securitySchemes?.kinship_session).includes(
      '"in":"cookie"',
    ) &&
      JSON.stringify(components.securitySchemes?.kinship_mfa).includes(
        '"in":"cookie"',
      ),
    "session and MFA cookies must have explicit security schemes",
  );
  const paths = document.paths as Record<
    string,
    Record<
      string,
      {
        parameters?: Array<{ name?: string; required?: boolean }>;
        security?: Array<Record<string, readonly unknown[]>>;
      }
    >
  >;
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      for (const requirement of operation.security ?? []) {
        for (const scheme of Object.keys(requirement)) {
          assert(
            components.securitySchemes?.[scheme] !== undefined,
            `security requirement ${scheme} must resolve to a declared scheme`,
          );
        }
      }
    }
  }
  assert(
    JSON.stringify(
      paths["/api/v1/workspace-invitations/mfa"]?.post?.security,
    ) === JSON.stringify([{ kinship_mfa: [], kinship_invitation: [] }]),
    "invitation MFA must require both challenge and invitation cookies",
  );
  for (
    const path of [
      "/api/v1/application-entry",
      "/api/v1/sessions",
      "/api/v1/mfa-challenges",
      "/api/v1/password-reset-requests",
      "/api/v1/password-resets",
      "/api/v1/sign-out",
      "/api/v1/workspace-invitations",
      "/api/v1/workspace-invitations/inspect",
      "/api/v1/workspace-invitations/accept",
    ]
  ) {
    const operation = paths[path]?.post;
    assert(
      operation?.parameters?.some((parameter) =>
        parameter.name === "Origin" && parameter.required === true
      ),
      `${path} must require exact Origin explicitly`,
    );
  }
  const responseContracts = document.paths as Record<
    string,
    Record<
      string,
      { responses?: Record<string, unknown> }
    >
  >;
  for (
    const [path, status] of [
      ["/api/v1/mfa-challenges", "200"],
      ["/api/v1/password-reset-requests", "202"],
      ["/api/v1/password-resets", "200"],
      ["/api/v1/sign-out", "200"],
    ] as const
  ) {
    assert(
      JSON.stringify(responseContracts[path]?.post?.responses?.[status])
        .includes("application/json"),
      `${path} ${status} must document its generated-client response body`,
    );
  }
  assert(
    responseContracts["/api/v1/sign-out"]?.post?.responses?.["503"] !==
      undefined,
    "sign-out must document a truthful revocation dependency failure",
  );
  assert(
    text.includes('"InvitationToken"') && text.includes('"writeOnly":true') &&
      generatedClient.includes("inspectWorkspaceInvitation(token?: string)") &&
      generatedClient.includes("registerInvitedIdentity(input:"),
    "invitation bearer material is request-only and never a response field",
  );
  assert(
    JSON.stringify(
      responseContracts["/api/v1/mfa-challenges"]?.post?.responses?.["200"],
    ).includes("Set-Cookie"),
    "successful MFA must document session issuance and challenge deletion",
  );
});
