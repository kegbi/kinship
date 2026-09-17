import { buildOpenApiDocument } from "./document.ts";

const CLIENT = new URL("../../packages/contracts/client/", import.meta.url);

/**
 * The authored client surface, as text, for the assertions that read it.
 *
 * Whitespace is squeezed out so an assertion pins what the client says rather
 * than how `deno fmt` happened to wrap it.
 */
function clientSource(...modules: readonly string[]): string {
  return modules
    .map((module) => Deno.readTextFileSync(new URL(`${module}.ts`, CLIENT)))
    .join(" ")
    .replace(/\s+/g, "")
    .replace(/,\)/g, ")");
}

/** Whether the client says this, ignoring how it is wrapped. */
function says(source: string, snippet: string): boolean {
  return source.includes(snippet.replace(/\s+/g, "").replace(/,\)/g, ")"));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APR-009 preferences have distinct strict writable and resolved read shapes", () => {
  const document = buildOpenApiDocument();
  const schemas = (document.components as {
    schemas: Record<
      "PreferencesInput" | "ResolvedMemberPreferences" | "PreferenceSettings",
      {
        required: string[];
        properties: Record<string, { readOnly?: boolean; $ref?: string }>;
        additionalProperties?: boolean;
      }
    >;
  }).schemas;
  assert(
    !("effectiveTimezone" in schemas.PreferencesInput.properties),
    "write schema must not accept resolved data",
  );
  assert(
    schemas.PreferencesInput.additionalProperties === false,
    "writes remain strict",
  );
  assert(
    schemas.ResolvedMemberPreferences.required.includes("effectiveTimezone"),
    "resolved timezone is required on reads",
  );
  assert(
    schemas.ResolvedMemberPreferences.properties.effectiveTimezone?.readOnly ===
      true,
    "resolved timezone is read-only",
  );
  assert(
    !schemas.ResolvedMemberPreferences.required.includes("timezone"),
    "raw timezone remains optional",
  );
  assert(
    schemas.PreferenceSettings.properties.preferences?.$ref ===
      "#/components/schemas/ResolvedMemberPreferences",
    "responses use the resolved shape",
  );
  const client = clientSource("settings");
  assert(
    says(client, "updateMemberPreferences(input: MemberPreferences"),
    "generated write input remains editable fields only",
  );
});

Deno.test("AUTH-001/AUTH-002/AUTH-003 OpenAPI is deterministic and secret-safe", () => {
  const first = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const second = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  assert(first === second, "OpenAPI generation must be byte stable");
  const document = buildOpenApiDocument();
  const generatedClient = clientSource(
    "registration",
    "authentication",
    "invitations",
    "settings",
  );
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
    says(generatedClient, "/api/v1/registrations"),
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
      says(generatedClient, path),
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
    responseContracts["/api/v1/settings/members/{memberId}"]?.patch
      ?.responses?.["404"] !== undefined,
    "managed-member update must document an unknown or cross-workspace target",
  );
  assert(
    text.includes('"InvitationToken"') && text.includes('"writeOnly":true') &&
      says(generatedClient, "inspectWorkspaceInvitation(token?: string)") &&
      says(generatedClient, "registerInvitedIdentity(input:"),
    "invitation bearer material is request-only and never a response field",
  );
  assert(
    JSON.stringify(
      responseContracts["/api/v1/mfa-challenges"]?.post?.responses?.["200"],
    ).includes("Set-Cookie"),
    "successful MFA must document session issuance and challenge deletion",
  );
});

Deno.test("UXD-002C3 OpenAPI publishes member UI state and optional session composition", () => {
  const document = buildOpenApiDocument();
  const paths = document.paths as Record<
    string,
    Record<string, {
      readonly operationId?: string;
      readonly parameters?: readonly { readonly name?: string }[];
      readonly responses?: Readonly<Record<string, unknown>>;
      readonly security?: readonly Readonly<
        Record<string, readonly unknown[]>
      >[];
    }>
  >;
  const member = paths["/api/v1/member/ui-state"];
  const settings = paths["/api/v1/settings/preferences"];
  assert(
    member?.get?.operationId === "getMemberUiState" &&
      member.patch?.operationId === "saveMemberUiState",
    "member UI-state read and write operations are published",
  );
  assert(
    JSON.stringify(member.get?.security) ===
        JSON.stringify(settings?.get?.security) &&
      JSON.stringify(member.patch?.security) ===
        JSON.stringify(settings?.put?.security),
    "member UI-state operations inherit their sibling auth schemes",
  );
  assert(
    member.get?.parameters?.some((parameter) =>
      parameter.name === "X-Workspace-Id"
    ) &&
      ["Origin", "X-Workspace-Id"].every((name) =>
        member.patch?.parameters?.some((parameter) => parameter.name === name)
      ) &&
      ["200", "401", "403", "503"].every((status) =>
        member.get?.responses?.[status] !== undefined
      ) &&
      ["200", "400", "401", "403", "503"].every((status) =>
        member.patch?.responses?.[status] !== undefined
      ) && JSON.stringify(member.patch).includes("MemberUiStateInput"),
    "member UI-state operations publish tenant, origin, and failure contracts",
  );

  const schemas = (document.components as {
    readonly schemas: Readonly<
      Record<string, {
        readonly additionalProperties?: boolean;
        readonly minProperties?: number;
        readonly properties?: Readonly<Record<string, unknown>>;
        readonly required?: readonly string[];
      }>
    >;
  }).schemas;
  const state = schemas.MemberUiState;
  const input = schemas.MemberUiStateInput;
  const session = schemas.SessionContext;
  assert(
    state?.additionalProperties === false &&
      JSON.stringify(state.properties?.personWorkspaceView).includes(
        '"all","timeline","planning","things","admin"',
      ) &&
      JSON.stringify(state.properties?.theme).includes(
        '"system","light","dark"',
      ),
    "member UI state is a strict recognised presentation contract",
  );
  assert(
    input?.additionalProperties === false &&
      input.minProperties === 1 &&
      input.required === undefined &&
      JSON.stringify(input.properties) === JSON.stringify(state.properties),
    "member UI-state writes require at least one recognised key",
  );
  assert(
    JSON.stringify(session?.properties?.uiState).includes("MemberUiState") &&
      !session?.required?.includes("uiState"),
    "session context composes UI state without making preference reads fatal",
  );

  const client = clientSource("types", "settings");
  assert(
    says(
      client,
      'export type MemberUiState = components["schemas"]["MemberUiState"];',
    ) &&
      says(client, "getMemberUiState(") &&
      says(client, "saveMemberUiState("),
    "the client exposes both operations and aliases the published UI state",
  );
});
