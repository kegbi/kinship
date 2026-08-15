const openApiPath = new URL(
  "../../packages/contracts/openapi/openapi.json",
  import.meta.url,
);
const clientPath = new URL(
  "../../packages/contracts/generated/auth-client.ts",
  import.meta.url,
);

export function buildOpenApiDocument(): Record<string, unknown> & {
  readonly openapi: string;
} {
  const problem = {
    description: "RFC 9457 problem details",
    content: {
      "application/problem+json": {
        schema: { $ref: "#/components/schemas/Problem" },
      },
    },
  };
  const originParameter = {
    name: "Origin",
    in: "header",
    required: true,
    description: "Must exactly match the configured public web origin.",
    schema: { type: "string", format: "uri" },
  };
  const workspaceParameter = {
    name: "X-Workspace-Id",
    in: "header",
    required: false,
    description:
      "Optional requested workspace; validated against active membership.",
    schema: { type: "string", format: "uuid" },
  };
  const personIdParameter = {
    name: "personId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const personMutation = (
    operationId: string,
    input: string,
    output: string,
  ) => ({
    operationId,
    security: [{ kinship_session: [] }],
    parameters: [originParameter, workspaceParameter, personIdParameter],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${input}` },
        },
      },
    },
    responses: {
      "200": {
        description: "Atomic current-workspace person lifecycle change",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${output}` },
          },
        },
      },
      "400": problem,
      "401": problem,
      "403": problem,
      "404": problem,
      "409": problem,
      "503": problem,
    },
  });
  const securedRead = (operationId: string, schema: string) => ({
    get: {
      operationId,
      security: [{ kinship_session: [] }],
      parameters: [workspaceParameter],
      responses: {
        "200": {
          description: "Current member settings",
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
        },
        "401": problem,
        "403": problem,
        "503": problem,
      },
    },
  });
  const securedPut = (
    operationId: string,
    input: string,
    output: string,
  ) => ({
    operationId,
    security: [{ kinship_session: [] }],
    parameters: [originParameter, workspaceParameter],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${input}` },
        },
      },
    },
    responses: {
      "200": {
        description: "Settings saved",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${output}` },
          },
        },
      },
      "400": problem,
      "401": problem,
      "403": problem,
      "409": problem,
      "503": problem,
    },
  });
  return {
    openapi: "3.1.0",
    info: { title: "Kinship API", version: "1.0.0" },
    paths: {
      "/api/v1/registrations": {
        post: {
          operationId: "createFirstWorkspace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegistrationInput" },
              },
            },
          },
          responses: {
            "202": {
              description: "Verification required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RegistrationAccepted" },
                },
              },
            },
            "400": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/email-verifications": {
        post: {
          operationId: "verifyEmail",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["token"],
                  properties: {
                    token: { type: "string", minLength: 32, maxLength: 256 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Email verified",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/VerificationAccepted" },
                },
              },
            },
            "400": problem,
            "409": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/email-verification-deliveries": {
        post: {
          operationId: "retryVerificationDelivery",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email", maxLength: 254 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "202": {
              description:
                "Delivery retry accepted without identity disclosure",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: { status: { const: "accepted" } },
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/application-entry": {
        post: {
          operationId: "consumeApplicationEntry",
          description:
            "Browser-only one-time application entry. Requires the exact Origin header configured for the public web origin and the HttpOnly kinship_entry cookie. The cookie is SameSite=Strict and is Secure outside explicit loopback HTTP development/test use.",
          security: [{ kinship_entry: [] }],
          parameters: [originParameter],
          responses: {
            "200": {
              description: "Narrow application entry context",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApplicationEntry" },
                },
              },
            },
            "403": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/sessions": {
        post: {
          operationId: "signIn",
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SignInInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Authenticated session created and rotated",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Authenticated" },
                },
              },
            },
            "202": {
              description: "MFA challenge required",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MfaRequired" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/mfa-challenges": {
        post: {
          operationId: "completeMfa",
          parameters: [originParameter],
          security: [{ kinship_mfa: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MfaInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "MFA accepted and authenticated session created",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Authenticated" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "410": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/password-reset-requests": {
        post: {
          operationId: "requestPasswordReset",
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email", maxLength: 254 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Request accepted without identity disclosure",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RecoveryAccepted" },
                },
              },
            },
            "400": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/password-resets": {
        post: {
          operationId: "resetPassword",
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PasswordResetInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Password reset and sessions revoked",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PasswordResetAccepted",
                  },
                },
              },
            },
            "400": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/session": {
        get: {
          operationId: "getSession",
          security: [{ kinship_session: [] }],
          parameters: [{
            name: "X-Workspace-Id",
            in: "header",
            required: false,
            description:
              "Optional requested workspace; always validated against active membership.",
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            "200": {
              description: "Resolved principal and active workspace",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionContext" },
                },
              },
            },
            "401": problem,
          },
        },
      },
      "/api/v1/people": {
        get: {
          operationId: "listPeople",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "tag",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "lifecycle",
              in: "query",
              schema: {
                type: "string",
                enum: ["active", "archived"],
                default: "active",
              },
            },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["given-name", "family-name", "recently-added"],
                default: "given-name",
              },
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            },
          ],
          responses: {
            "200": {
              description: "Tenant-scoped people directory page",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PeopleDirectoryPage" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "409": problem,
            "503": problem,
          },
        },
        post: {
          operationId: "createPerson",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PersonInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Workspace-owned person created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonCreated" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/tag-options": {
        get: {
          operationId: "listPeopleTagOptions",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "selected",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Bounded tenant-scoped people tag options",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PeopleTagOptionsPage",
                  },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}": {
        get: {
          operationId: "getPerson",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            personIdParameter,
          ],
          responses: {
            "200": {
              description:
                "Current-workspace person identity, lifecycle, and due-information shell",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonReady" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
        patch: personMutation(
          "editPerson",
          "PersonEditInput",
          "PersonLifecycleChanged",
        ),
        delete: personMutation(
          "deletePerson",
          "PersonDeleteInput",
          "PersonDeleted",
        ),
      },
      "/api/v1/people/{personId}/archive": {
        post: personMutation(
          "archivePerson",
          "PersonTransitionInput",
          "PersonLifecycleChanged",
        ),
      },
      "/api/v1/people/{personId}/restore": {
        post: personMutation(
          "restorePerson",
          "PersonTransitionInput",
          "PersonLifecycleChanged",
        ),
      },
      "/api/v1/people/{personId}/deletion-impact": {
        get: {
          operationId: "getPersonDeletionImpact",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Canonical soft-delete impact and confirmation",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PersonDeletionImpact",
                  },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/settings/profile": {
        ...securedRead("getSettingsProfile", "ProfileSettings"),
        put: securedPut(
          "updateSettingsProfile",
          "ProfileInput",
          "ProfileSettings",
        ),
      },
      "/api/v1/settings/preferences": {
        ...securedRead("getMemberPreferences", "PreferenceSettings"),
        put: securedPut(
          "updateMemberPreferences",
          "PreferencesInput",
          "PreferenceSettings",
        ),
      },
      "/api/v1/settings/sessions": securedRead(
        "listMemberSessions",
        "SessionSettings",
      ),
      "/api/v1/settings/sessions/{sessionId}": {
        delete: {
          operationId: "revokeMemberSession",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            {
              name: "sessionId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "Owned session revoked",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionRevoked" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/settings/workspace": {
        ...securedRead("getWorkspaceSettings", "WorkspaceSettings"),
        put: securedPut(
          "updateWorkspaceSettings",
          "WorkspaceSettingsInput",
          "WorkspaceSettings",
        ),
      },
      "/api/v1/settings/members": securedRead(
        "listManagedMembers",
        "ManagedMembers",
      ),
      "/api/v1/settings/members/{memberId}": {
        patch: {
          ...securedPut(
            "updateManagedMember",
            "MemberUpdateInput",
            "ManagedMemberResult",
          ),
          responses: {
            ...securedPut(
              "updateManagedMember",
              "MemberUpdateInput",
              "ManagedMemberResult",
            ).responses,
            "404": problem,
          },
          parameters: [
            originParameter,
            workspaceParameter,
            {
              name: "memberId",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ],
        },
      },
      "/api/v1/sign-out": {
        post: {
          operationId: "signOut",
          parameters: [originParameter],
          security: [{ kinship_session: [] }],
          responses: {
            "200": {
              description: "Current session revoked",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SignedOut" },
                },
              },
            },
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-members": {
        get: {
          operationId: "listWorkspaceMembers",
          security: [{ kinship_session: [] }],
          parameters: [{
            name: "X-Workspace-Id",
            in: "header",
            required: false,
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            "200": {
              description: "Active members and pending invitations",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WorkspaceMembers" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations": {
        post: {
          operationId: "createWorkspaceInvitation",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, {
            name: "X-Workspace-Id",
            in: "header",
            required: false,
            schema: { type: "string", format: "uuid" },
          }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InvitationInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Invitation created and delivered",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: { status: { const: "invited" } },
                    additionalProperties: false,
                  },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/register": {
        post: {
          operationId: "registerInvitedIdentity",
          description:
            "Creates a pending identity for an invitation without creating another workspace.",
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/InvitationRegistrationInput",
                },
              },
            },
          },
          responses: {
            "202": {
              description: "Verification required",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/RegistrationAccepted",
                  },
                },
              },
            },
            "400": problem,
            "404": problem,
            "409": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/verification-delivery": {
        post: {
          operationId: "retryInvitedVerificationDelivery",
          description:
            "Retries verification delivery only for the identity bound to the scoped pending invitation cookie.",
          security: [{ kinship_invitation: [] }],
          parameters: [originParameter],
          responses: {
            "202": {
              description: "Verification delivery accepted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status"],
                    properties: { status: { const: "accepted" } },
                    additionalProperties: false,
                  },
                },
              },
            },
            "403": problem,
            "404": problem,
            "410": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/authenticate": {
        post: {
          operationId: "authenticateWorkspaceInvitation",
          description:
            "Runs the equalized password challenge for the verified identity matching a pending invitation, without creating a normal workspace session.",
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", format: "email", maxLength: 254 },
                    password: { type: "string", minLength: 1, maxLength: 128 },
                    token: { type: "string", minLength: 32, maxLength: 256 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "One-use verified identity entry issued",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "next"],
                    properties: {
                      status: { const: "authenticated" },
                      next: { const: "/invite/continue" },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "202": {
              description: "Invitation-scoped MFA challenge required",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/MfaRequired" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/mfa": {
        post: {
          operationId: "completeWorkspaceInvitationMfa",
          description:
            "Completes the equalized MFA challenge for the identity matching the scoped pending invitation.",
          security: [{ kinship_mfa: [], kinship_invitation: [] }],
          parameters: [originParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["factor"],
                  properties: {
                    factor: { type: "string", minLength: 6, maxLength: 128 },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "One-use verified identity entry issued",
              headers: {
                "Set-Cookie": { schema: { type: "string", writeOnly: true } },
              },
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["status", "next"],
                    properties: {
                      status: { const: "authenticated" },
                      next: { const: "/invite/continue" },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": problem,
            "403": problem,
            "410": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/inspect": {
        post: {
          operationId: "inspectWorkspaceInvitation",
          description:
            "Inspects an invitation using a bearer token in the request body so gateway logs never contain it.",
          parameters: [originParameter],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OptionalInvitationToken",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Pending invitation",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InvitationInspection" },
                },
              },
            },
            "403": problem,
            "404": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/workspace-invitations/accept": {
        post: {
          operationId: "acceptWorkspaceInvitation",
          description:
            "Atomically consumes a single-use invitation for the authenticated intended user.",
          security: [{ kinship_session: [] }, { kinship_entry: [] }],
          parameters: [originParameter],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/OptionalInvitationToken",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Invitation accepted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InvitationAccepted" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "409": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        kinship_entry: {
          type: "apiKey",
          in: "cookie",
          name: "kinship_entry",
          description:
            "One-time HttpOnly browser handoff; SameSite=Strict and Secure outside loopback.",
        },
        kinship_invitation: {
          type: "apiKey",
          in: "cookie",
          name: "kinship_invitation",
          description:
            "Pending invitation authority scoped to invitation API transitions; HttpOnly, SameSite=Strict, and Secure outside loopback.",
        },
        kinship_mfa: {
          type: "apiKey",
          in: "cookie",
          name: "kinship_mfa",
          description:
            "Short-lived HttpOnly, SameSite=Strict MFA challenge; not an authenticated session.",
        },
        kinship_session: {
          type: "apiKey",
          in: "cookie",
          name: "kinship_session",
          description:
            "Revocable random browser session; HttpOnly, SameSite=Strict, and Secure outside loopback.",
        },
      },
      schemas: {
        RegistrationInput: {
          type: "object",
          required: [
            "email",
            "firstName",
            "lastName",
            "password",
            "workspaceName",
          ],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            firstName: { type: "string", minLength: 1, maxLength: 100 },
            lastName: { type: "string", maxLength: 100 },
            password: {
              type: "string",
              minLength: 12,
              maxLength: 128,
              writeOnly: true,
            },
            workspaceName: { type: "string", minLength: 2, maxLength: 120 },
          },
          additionalProperties: false,
        },
        RegistrationAccepted: {
          type: "object",
          required: ["status"],
          properties: { status: { const: "verification-required" } },
          additionalProperties: false,
        },
        VerificationAccepted: {
          type: "object",
          required: ["status", "next"],
          properties: {
            status: { const: "verified" },
            next: { type: "string", enum: ["/app", "/invite/continue"] },
          },
          additionalProperties: false,
        },
        ApplicationEntry: {
          type: "object",
          required: ["status", "workspace", "member"],
          properties: {
            status: { const: "ready" },
            workspace: {
              type: "object",
              required: ["id", "name"],
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
            member: {
              type: "object",
              required: ["id", "firstName"],
              properties: {
                id: { type: "string", format: "uuid" },
                firstName: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        SignInInput: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            password: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              writeOnly: true,
            },
            workspaceId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        MfaInput: {
          type: "object",
          required: ["factor"],
          properties: {
            factor: {
              type: "string",
              minLength: 6,
              maxLength: 128,
              writeOnly: true,
            },
            workspaceId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        PasswordResetInput: {
          type: "object",
          required: ["password", "token"],
          properties: {
            password: {
              type: "string",
              minLength: 12,
              maxLength: 128,
              writeOnly: true,
            },
            token: {
              type: "string",
              minLength: 32,
              maxLength: 256,
              writeOnly: true,
            },
          },
          additionalProperties: false,
        },
        Authenticated: {
          type: "object",
          required: ["status", "next", "workspace", "member"],
          properties: {
            status: { const: "authenticated" },
            next: { const: "/app" },
            workspace: {
              type: "object",
              required: ["id", "name"],
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
            member: {
              type: "object",
              required: ["id", "role"],
              properties: {
                id: { type: "string", format: "uuid" },
                role: { type: "string", enum: ["owner", "admin", "member"] },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        MfaRequired: {
          type: "object",
          required: ["status", "next"],
          properties: {
            status: { const: "mfa-required" },
            next: { const: "/auth/mfa" },
          },
          additionalProperties: false,
        },
        RecoveryAccepted: {
          type: "object",
          required: ["status"],
          properties: { status: { const: "accepted" } },
          additionalProperties: false,
        },
        PasswordResetAccepted: {
          type: "object",
          required: ["status", "next"],
          properties: {
            status: { const: "reset" },
            next: { const: "/auth/sign-in" },
          },
          additionalProperties: false,
        },
        SignedOut: {
          type: "object",
          required: ["status", "next"],
          properties: {
            status: { const: "signed-out" },
            next: { const: "/auth/sign-in" },
          },
          additionalProperties: false,
        },
        SessionContext: {
          type: "object",
          required: [
            "status",
            "principal",
            "workspace",
            "member",
            "workspaces",
          ],
          properties: {
            status: { const: "authenticated" },
            principal: {
              type: "object",
              required: ["userId"],
              properties: { userId: { type: "string", format: "uuid" } },
              additionalProperties: false,
            },
            workspace: {
              $ref: "#/components/schemas/Authenticated/properties/workspace",
            },
            member: {
              $ref: "#/components/schemas/Authenticated/properties/member",
            },
            workspaces: {
              type: "array",
              minItems: 1,
              items: {
                $ref: "#/components/schemas/Authenticated/properties/workspace",
              },
            },
          },
          additionalProperties: false,
        },
        PersonInput: {
          type: "object",
          required: ["givenName", "isPartial"],
          properties: {
            duplicateOverride: { type: "boolean" },
            familyName: { type: "string", maxLength: 200 },
            givenName: { type: "string", maxLength: 200 },
            isPartial: { type: "boolean" },
            middleName: { type: "string", maxLength: 200 },
            nickname: { type: "string", maxLength: 200 },
          },
          additionalProperties: false,
        },
        PersonIdentity: {
          type: "object",
          required: ["id", "givenName", "isPartial"],
          properties: {
            familyName: { type: "string" },
            givenName: { type: "string" },
            id: { type: "string", format: "uuid" },
            isPartial: { type: "boolean" },
            middleName: { type: "string" },
            nickname: { type: "string" },
          },
          additionalProperties: false,
        },
        PersonProfileIdentity: {
          type: "object",
          required: [
            "id",
            "givenName",
            "isPartial",
            "isStarred",
            "isDeceased",
            "isSelf",
            "tagCount",
            "tags",
            "updatedAt",
          ],
          properties: {
            description: { type: "string" },
            familyName: { type: "string" },
            gender: { type: "string" },
            givenName: { type: "string" },
            id: { type: "string", format: "uuid" },
            isDeceased: { type: "boolean" },
            isPartial: { type: "boolean" },
            isSelf: { type: "boolean" },
            isStarred: { type: "boolean" },
            middleName: { type: "string" },
            nickname: { type: "string" },
            tagCount: { type: "integer", minimum: 0 },
            tags: {
              type: "array",
              maxItems: 8,
              items: { $ref: "#/components/schemas/PeopleDirectoryTag" },
            },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        PersonLifecycleIdentity: {
          type: "object",
          required: [
            "id",
            "givenName",
            "isPartial",
            "lifecycle",
            "updatedAt",
          ],
          properties: {
            familyName: { type: "string" },
            givenName: { type: "string" },
            id: { type: "string", format: "uuid" },
            isPartial: { type: "boolean" },
            lifecycle: {
              type: "string",
              enum: ["active", "archived", "deleted"],
            },
            middleName: { type: "string" },
            nickname: { type: "string" },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        PersonEditInput: {
          type: "object",
          required: ["expectedUpdatedAt", "givenName", "isPartial"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            familyName: { type: "string", maxLength: 200 },
            givenName: { type: "string", maxLength: 200 },
            isPartial: { type: "boolean" },
            middleName: { type: "string", maxLength: 200 },
            nickname: { type: "string", maxLength: 200 },
          },
          additionalProperties: false,
        },
        PersonTransitionInput: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        PersonDeleteInput: {
          type: "object",
          required: ["confirmation", "expectedUpdatedAt"],
          properties: {
            confirmation: { type: "string", minLength: 1, maxLength: 500 },
            expectedUpdatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        PersonLifecycleChanged: {
          type: "object",
          required: ["person", "status"],
          properties: {
            person: { $ref: "#/components/schemas/PersonLifecycleIdentity" },
            status: {
              type: "string",
              enum: ["updated", "archived", "restored"],
            },
          },
          additionalProperties: false,
        },
        PersonDeletionImpact: {
          type: "object",
          required: ["impact", "status"],
          properties: {
            impact: {
              type: "object",
              required: [
                "confirmation",
                "dependentRecordPolicy",
                "person",
              ],
              properties: {
                confirmation: { type: "string" },
                dependentRecordPolicy: { const: "retained" },
                person: {
                  $ref: "#/components/schemas/PersonLifecycleIdentity",
                },
              },
              additionalProperties: false,
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        PersonDeleted: {
          type: "object",
          required: ["next", "personId", "status"],
          properties: {
            next: { const: "/app/people" },
            personId: { type: "string", format: "uuid" },
            status: { const: "deleted" },
          },
          additionalProperties: false,
        },
        PersonDueInformation: {
          type: "object",
          required: ["status", "detail"],
          properties: {
            status: { const: "unavailable" },
            detail: { type: "string" },
          },
          additionalProperties: false,
        },
        PeopleDirectoryTag: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        PeopleDirectoryPerson: {
          type: "object",
          required: [
            "id",
            "givenName",
            "isPartial",
            "isStarred",
            "lifecycle",
            "tagCount",
            "tags",
          ],
          properties: {
            familyName: { type: "string" },
            givenName: { type: "string" },
            id: { type: "string", format: "uuid" },
            isPartial: { type: "boolean" },
            isStarred: { type: "boolean" },
            lifecycle: {
              type: "string",
              enum: ["active", "archived"],
            },
            middleName: { type: "string" },
            nickname: { type: "string" },
            tagCount: { type: "integer", minimum: 0 },
            tags: {
              type: "array",
              maxItems: 5,
              items: { $ref: "#/components/schemas/PeopleDirectoryTag" },
            },
          },
          additionalProperties: false,
        },
        PeopleDirectoryPage: {
          type: "object",
          required: ["status", "lifecycle", "people"],
          properties: {
            status: { const: "ready" },
            lifecycle: { type: "string", enum: ["active", "archived"] },
            people: {
              type: "array",
              items: { $ref: "#/components/schemas/PeopleDirectoryPerson" },
            },
            nextCursor: { type: "string" },
          },
          additionalProperties: false,
        },
        PeopleTagOptionsPage: {
          type: "object",
          required: ["status", "options"],
          properties: {
            status: { const: "ready" },
            options: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/PeopleDirectoryTag" },
            },
            nextCursor: { type: "string" },
            selected: { $ref: "#/components/schemas/PeopleDirectoryTag" },
          },
          additionalProperties: false,
        },
        PersonCreated: {
          type: "object",
          required: ["status", "person", "next"],
          properties: {
            status: { const: "created" },
            person: { $ref: "#/components/schemas/PersonIdentity" },
            next: { type: "string", pattern: "^/app/people/[0-9a-f-]+$" },
          },
          additionalProperties: false,
        },
        PersonReady: {
          type: "object",
          required: ["status", "person", "dueInformation"],
          properties: {
            status: { type: "string", enum: ["ready", "archived"] },
            person: { $ref: "#/components/schemas/PersonProfileIdentity" },
            dueInformation: {
              $ref: "#/components/schemas/PersonDueInformation",
            },
          },
          additionalProperties: false,
        },
        ProfileInput: {
          type: "object",
          required: ["firstName", "lastName"],
          properties: {
            firstName: { type: "string", minLength: 1, maxLength: 100 },
            lastName: { type: "string", maxLength: 100 },
          },
          additionalProperties: false,
        },
        ProfileSettings: {
          type: "object",
          required: ["status", "profile"],
          properties: {
            status: { const: "ready" },
            profile: {
              type: "object",
              required: ["email", "firstName", "lastName"],
              properties: {
                email: { type: "string", format: "email" },
                firstName: { type: "string" },
                lastName: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        PreferencesInput: {
          type: "object",
          required: [
            "contactNameOrder",
            "contactSortOrder",
            "fluidLayout",
            "locale",
            "measurementSystem",
            "temperatureScale",
          ],
          properties: {
            contactNameOrder: {
              type: "string",
              enum: ["given_family_nickname", "family_given_nickname"],
            },
            contactSortOrder: {
              type: "string",
              enum: ["given_name_asc", "family_name_asc"],
            },
            currencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
            fluidLayout: { type: "boolean" },
            locale: { type: "string" },
            measurementSystem: {
              type: "string",
              enum: ["metric", "imperial"],
            },
            temperatureScale: {
              type: "string",
              enum: ["celsius", "fahrenheit"],
            },
            timezone: { type: "string" },
          },
          additionalProperties: false,
        },
        PreferenceSettings: {
          type: "object",
          required: ["status", "preferences"],
          properties: {
            status: { const: "ready" },
            preferences: { $ref: "#/components/schemas/PreferencesInput" },
          },
          additionalProperties: false,
        },
        SessionSettings: {
          type: "object",
          required: ["status", "sessions"],
          properties: {
            status: { const: "ready" },
            sessions: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "current",
                  "createdAt",
                  "lastSeenAt",
                  "expiresAt",
                ],
                properties: {
                  id: { type: "string", format: "uuid" },
                  current: { type: "boolean" },
                  createdAt: { type: "string", format: "date-time" },
                  lastSeenAt: { type: "string", format: "date-time" },
                  expiresAt: { type: "string", format: "date-time" },
                  ipAddress: { type: "string" },
                  userAgent: { type: "string" },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        SessionRevoked: {
          type: "object",
          required: ["status", "current"],
          properties: {
            status: { const: "revoked" },
            current: { type: "boolean" },
          },
          additionalProperties: false,
        },
        WorkspaceSettingsInput: {
          type: "object",
          required: [
            "name",
            "defaultLocale",
            "defaultReminderTime",
          ],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            slug: { type: "string" },
            defaultLocale: { type: "string" },
            defaultTimezone: { type: "string" },
            defaultCurrencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
            defaultReminderTime: {
              type: "string",
              pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
            },
          },
          additionalProperties: false,
        },
        WorkspaceSettings: {
          type: "object",
          required: ["status", "workspace"],
          properties: {
            status: { const: "ready" },
            workspace: { $ref: "#/components/schemas/WorkspaceSettingsInput" },
          },
          additionalProperties: false,
        },
        ManagedMember: {
          type: "object",
          required: ["id", "email", "name", "role", "status"],
          properties: {
            id: { type: "string", format: "uuid" },
            email: { type: "string", format: "email" },
            name: { type: "string" },
            role: { type: "string", enum: ["owner", "admin", "member"] },
            status: { type: "string", enum: ["active", "suspended"] },
          },
          additionalProperties: false,
        },
        ManagedMembers: {
          type: "object",
          required: ["status", "members"],
          properties: {
            status: { const: "ready" },
            members: {
              type: "array",
              items: { $ref: "#/components/schemas/ManagedMember" },
            },
          },
          additionalProperties: false,
        },
        MemberUpdateInput: {
          type: "object",
          required: ["role", "status"],
          properties: {
            role: { type: "string", enum: ["owner", "admin", "member"] },
            status: { type: "string", enum: ["active", "suspended"] },
          },
          additionalProperties: false,
        },
        ManagedMemberResult: {
          type: "object",
          required: ["status", "member"],
          properties: {
            status: { const: "ready" },
            member: { $ref: "#/components/schemas/ManagedMember" },
          },
          additionalProperties: false,
        },
        InvitationInput: {
          type: "object",
          required: ["email", "role"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            role: { type: "string", enum: ["admin", "member"] },
          },
          additionalProperties: false,
        },
        InvitationToken: {
          type: "object",
          required: ["token"],
          properties: {
            token: {
              type: "string",
              minLength: 32,
              maxLength: 256,
              writeOnly: true,
            },
          },
          additionalProperties: false,
        },
        OptionalInvitationToken: {
          type: "object",
          properties: {
            token: {
              type: "string",
              minLength: 32,
              maxLength: 256,
              writeOnly: true,
            },
          },
          additionalProperties: false,
        },
        InvitationRegistrationInput: {
          type: "object",
          required: ["email", "firstName", "lastName", "password", "token"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            firstName: { type: "string", minLength: 1, maxLength: 100 },
            lastName: { type: "string", maxLength: 100 },
            password: {
              type: "string",
              minLength: 12,
              maxLength: 128,
              writeOnly: true,
            },
            token: {
              type: "string",
              minLength: 32,
              maxLength: 256,
              writeOnly: true,
            },
          },
          additionalProperties: false,
        },
        InvitationInspection: {
          type: "object",
          required: ["status", "email", "role", "workspaceName"],
          properties: {
            status: { const: "pending" },
            email: { type: "string", format: "email" },
            role: { type: "string", enum: ["admin", "member"] },
            workspaceName: { type: "string" },
          },
          additionalProperties: false,
        },
        InvitationAccepted: {
          type: "object",
          required: ["status", "next", "workspace"],
          properties: {
            status: { const: "accepted" },
            next: { const: "/app" },
            workspace: {
              $ref: "#/components/schemas/Authenticated/properties/workspace",
            },
          },
          additionalProperties: false,
        },
        WorkspaceMembers: {
          type: "object",
          required: ["status", "members", "invitations"],
          properties: {
            status: { const: "ready" },
            members: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "email", "name", "role", "status"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", format: "email" },
                  name: { type: "string" },
                  role: { type: "string", enum: ["owner", "admin", "member"] },
                  status: { const: "active" },
                },
                additionalProperties: false,
              },
            },
            invitations: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "email",
                  "role",
                  "status",
                  "createdAt",
                  "expiresAt",
                ],
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", format: "email" },
                  role: { type: "string", enum: ["admin", "member"] },
                  status: { const: "pending" },
                  createdAt: { type: "string", format: "date-time" },
                  expiresAt: { type: "string", format: "date-time" },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        Problem: {
          type: "object",
          required: ["type", "title", "status", "detail", "code"],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            code: { type: "string" },
            errors: {
              type: "object",
              additionalProperties: { type: "string" },
            },
          },
          additionalProperties: false,
        },
      },
    },
  };
}

function renderGeneratedClientBase(): string {
  return `// Generated by deno task contracts:generate from packages/contracts/openapi/openapi.json. Do not edit.\n\nexport interface RegistrationInput {\n  readonly email: string;\n  readonly firstName: string;\n  readonly lastName: string;\n  readonly password: string;\n  readonly workspaceName: string;\n}\n\nexport interface ProblemDetails {\n  readonly type: string;\n  readonly title: string;\n  readonly status: number;\n  readonly detail: string;\n  readonly code: string;\n  readonly errors?: Readonly<Record<string, string>>;\n}\n\nexport interface ApplicationEntry {\n  readonly status: \"ready\";\n  readonly workspace: { readonly id: string; readonly name: string };\n  readonly member: { readonly id: string; readonly firstName: string };\n}\n\nexport interface Authenticated {\n  readonly status: \"authenticated\";\n  readonly next: \"/app\";\n  readonly workspace: { readonly id: string; readonly name: string };\n  readonly member: { readonly id: string; readonly role: \"owner\" | \"admin\" | \"member\" };\n}\n\nexport interface SessionContext {\n  readonly status: \"authenticated\";\n  readonly principal: { readonly userId: string };\n  readonly workspace: Authenticated[\"workspace\"];\n  readonly member: Authenticated[\"member\"];\n  readonly workspaces: readonly Authenticated[\"workspace\"][];\n}\n\nexport type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: ProblemDetails };\n\nasync function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {\n  const response = await fetch(path, { ...init, headers: { \"content-type\": \"application/json\", ...init?.headers } });\n  const body = await response.json() as T | ProblemDetails;\n  return response.ok ? { ok: true, value: body as T } : { ok: false, problem: body as ProblemDetails };\n}\n\nexport function register(input: RegistrationInput): Promise<ApiResult<{ readonly status: \"verification-required\" }>> {\n  return request(\"/api/v1/registrations\", { method: \"POST\", body: JSON.stringify(input) });\n}\n\nexport function retryVerificationDelivery(email: string): Promise<ApiResult<{ readonly status: \"accepted\" }>> {\n  return request(\"/api/v1/email-verification-deliveries\", { method: \"POST\", body: JSON.stringify({ email }) });\n}\n\nexport function verifyEmail(token: string): Promise<ApiResult<{ readonly status: \"verified\"; readonly next: \"/app\" }>> {\n  return request(\"/api/v1/email-verifications\", { method: \"POST\", body: JSON.stringify({ token }) });\n}\n\nexport function consumeApplicationEntry(): Promise<ApiResult<ApplicationEntry>> {\n  return request(\"/api/v1/application-entry\", { method: \"POST\" });\n}\n\nexport function signIn(input: { readonly email: string; readonly password: string; readonly workspaceId?: string }): Promise<ApiResult<Authenticated | { readonly status: \"mfa-required\"; readonly next: \"/auth/mfa\" }>> {\n  return request(\"/api/v1/sessions\", { method: \"POST\", body: JSON.stringify(input) });\n}\n\nexport function completeMfa(factor: string, workspaceId?: string): Promise<ApiResult<Authenticated>> {\n  return request(\"/api/v1/mfa-challenges\", { method: \"POST\", body: JSON.stringify({ factor, ...(workspaceId ? { workspaceId } : {}) }) });\n}\n\nexport function requestPasswordReset(email: string): Promise<ApiResult<{ readonly status: \"accepted\" }>> {\n  return request(\"/api/v1/password-reset-requests\", { method: \"POST\", body: JSON.stringify({ email }) });\n}\n\nexport function resetPassword(token: string, password: string): Promise<ApiResult<{ readonly status: \"reset\"; readonly next: \"/auth/sign-in\" }>> {\n  return request(\"/api/v1/password-resets\", { method: \"POST\", body: JSON.stringify({ token, password }) });\n}\n\nexport function getSession(workspaceId?: string): Promise<ApiResult<SessionContext>> {\n  return request(\"/api/v1/session\", { headers: workspaceId ? { \"X-Workspace-Id\": workspaceId } : undefined });\n}\n\nexport function signOut(): Promise<ApiResult<{ readonly status: \"signed-out\"; readonly next: \"/auth/sign-in\" }>> {\n  return request(\"/api/v1/sign-out\", { method: \"POST\" });\n}\n`;
}

export function renderGeneratedClient(): string {
  return renderGeneratedClientBase().replace(
    'verifyEmail(token: string): Promise<ApiResult<{ readonly status: "verified"; readonly next: "/app" }>>',
    'verifyEmail(token: string): Promise<ApiResult<{ readonly status: "verified"; readonly next: "/app" | "/invite/continue" }>>',
  );
}

function renderInvitationClientWithLegacyDestination(): string {
  return `\nexport interface WorkspaceMembers {\n  readonly status: "ready";\n  readonly members: readonly { readonly id: string; readonly email: string; readonly name: string; readonly role: "owner" | "admin" | "member"; readonly status: "active" }[];\n  readonly invitations: readonly { readonly id: string; readonly email: string; readonly role: "admin" | "member"; readonly status: "pending"; readonly createdAt: string; readonly expiresAt: string }[];\n}\n\nexport interface InvitationInspection {\n  readonly status: "pending";\n  readonly email: string;\n  readonly role: "admin" | "member";\n  readonly workspaceName: string;\n}\n\nexport function getWorkspaceMembers(workspaceId?: string): Promise<ApiResult<WorkspaceMembers>> {\n  return request("/api/v1/workspace-members", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });\n}\n\nexport function createWorkspaceInvitation(input: { readonly email: string; readonly role: "admin" | "member" }, workspaceId?: string): Promise<ApiResult<{ readonly status: "invited" }>> {\n  return request("/api/v1/workspace-invitations", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });\n}\n\nexport function registerInvitedIdentity(input: { readonly email: string; readonly firstName: string; readonly lastName: string; readonly password: string; readonly token: string }): Promise<ApiResult<{ readonly status: "verification-required" }>> {\n  return request("/api/v1/workspace-invitations/register", { method: "POST", body: JSON.stringify(input) });\n}\n\nexport function inspectWorkspaceInvitation(token?: string): Promise<ApiResult<InvitationInspection>> {\n  return request("/api/v1/workspace-invitations/inspect", { method: "POST", body: JSON.stringify(token ? { token } : {}) });\n}\n\nexport function acceptWorkspaceInvitation(token?: string): Promise<ApiResult<{ readonly status: "accepted"; readonly next: "/app/settings/members"; readonly workspace: Authenticated["workspace"] }>> {\n  return request("/api/v1/workspace-invitations/accept", { method: "POST", body: JSON.stringify(token ? { token } : {}) });\n}\n`;
}

export function renderInvitationClient(): string {
  return renderInvitationClientWithLegacyDestination().replace(
    'readonly next: "/app/settings/members"',
    'readonly next: "/app"',
  ).replace(
    "export function inspectWorkspaceInvitation",
    `export function retryInvitedVerificationDelivery(): Promise<ApiResult<{ readonly status: "accepted" }>> {
  return request("/api/v1/workspace-invitations/verification-delivery", { method: "POST", body: "{}" });
}

export function authenticateWorkspaceInvitation(input: { readonly email: string; readonly password: string; readonly token?: string }): Promise<ApiResult<{ readonly status: "authenticated"; readonly next: "/invite/continue" } | { readonly status: "mfa-required"; readonly next: "/auth/mfa" }>> {
  return request("/api/v1/workspace-invitations/authenticate", { method: "POST", body: JSON.stringify(input) });
}

export function completeWorkspaceInvitationMfa(factor: string): Promise<ApiResult<{ readonly status: "authenticated"; readonly next: "/invite/continue" }>> {
  return request("/api/v1/workspace-invitations/mfa", { method: "POST", body: JSON.stringify({ factor }) });
}

export function inspectWorkspaceInvitation`,
  );
}

function renderSettingsClient(): string {
  return `
export interface ProfileSettings {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface MemberPreferences {
  readonly contactNameOrder: "given_family_nickname" | "family_given_nickname";
  readonly contactSortOrder: "given_name_asc" | "family_name_asc";
  readonly currencyCode?: string;
  readonly fluidLayout: boolean;
  readonly locale: string;
  readonly measurementSystem: "metric" | "imperial";
  readonly temperatureScale: "celsius" | "fahrenheit";
  readonly timezone?: string;
}

export interface MemberSession {
  readonly id: string;
  readonly current: boolean;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface WorkspaceSettings {
  readonly name: string;
  readonly slug?: string;
  readonly defaultLocale: string;
  readonly defaultTimezone?: string;
  readonly defaultCurrencyCode?: string;
  readonly defaultReminderTime: string;
}

export interface ManagedMember {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "suspended";
}

function workspaceHeader(workspaceId?: string): HeadersInit | undefined {
  return workspaceId ? { "X-Workspace-Id": workspaceId } : undefined;
}

export function getSettingsProfile(workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly profile: ProfileSettings }>> {
  return request("/api/v1/settings/profile", { headers: workspaceHeader(workspaceId) });
}

export function updateSettingsProfile(input: Pick<ProfileSettings, "firstName" | "lastName">, workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly profile: ProfileSettings }>> {
  return request("/api/v1/settings/profile", { method: "PUT", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function getMemberPreferences(workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly preferences: MemberPreferences }>> {
  return request("/api/v1/settings/preferences", { headers: workspaceHeader(workspaceId) });
}

export function updateMemberPreferences(input: MemberPreferences, workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly preferences: MemberPreferences }>> {
  return request("/api/v1/settings/preferences", { method: "PUT", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function listMemberSessions(workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly sessions: readonly MemberSession[] }>> {
  return request("/api/v1/settings/sessions", { headers: workspaceHeader(workspaceId) });
}

export function revokeMemberSession(sessionId: string, workspaceId?: string): Promise<ApiResult<{ readonly status: "revoked"; readonly current: boolean }>> {
  return request(\`/api/v1/settings/sessions/\${encodeURIComponent(sessionId)}\`, { method: "DELETE", headers: workspaceHeader(workspaceId) });
}

export function getWorkspaceSettings(workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly workspace: WorkspaceSettings }>> {
  return request("/api/v1/settings/workspace", { headers: workspaceHeader(workspaceId) });
}

export function updateWorkspaceSettings(input: WorkspaceSettings, workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly workspace: WorkspaceSettings }>> {
  return request("/api/v1/settings/workspace", { method: "PUT", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function listManagedMembers(workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly members: readonly ManagedMember[] }>> {
  return request("/api/v1/settings/members", { headers: workspaceHeader(workspaceId) });
}

export function updateManagedMember(memberId: string, input: Pick<ManagedMember, "role" | "status">, workspaceId?: string): Promise<ApiResult<{ readonly status: "ready"; readonly member: ManagedMember }>> {
  return request(\`/api/v1/settings/members/\${encodeURIComponent(memberId)}\`, { method: "PATCH", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}
`;
}

export function renderPeopleClient(): string {
  return `
export interface PersonIdentity {
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface PersonProfileIdentity extends PersonIdentity {
  readonly description?: string;
  readonly gender?: string;
  readonly isDeceased: boolean;
  readonly isSelf: boolean;
  readonly isStarred: boolean;
  readonly tagCount: number;
  readonly tags: readonly PeopleDirectoryTag[];
  readonly updatedAt: string;
}

export interface PersonLifecycleIdentity extends PersonIdentity {
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly updatedAt: string;
}

export interface PersonEditInput {
  readonly expectedUpdatedAt: string;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface PersonTransitionInput {
  readonly expectedUpdatedAt: string;
}

export interface PersonDeletionImpact {
  readonly impact: {
    readonly confirmation: string;
    readonly dependentRecordPolicy: "retained";
    readonly person: PersonLifecycleIdentity;
  };
  readonly status: "ready";
}

export interface PersonDueInformation {
  readonly detail: string;
  readonly status: "unavailable";
}

export interface PersonInput {
  readonly duplicateOverride?: boolean;
  readonly familyName?: string;
  readonly givenName: string;
  readonly isPartial: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

export type PeopleDirectoryLifecycle = "active" | "archived";
export type PeopleDirectorySort = "given-name" | "family-name" | "recently-added";

export interface PeopleDirectoryTag {
  readonly id: string;
  readonly name: string;
}

export interface PeopleDirectoryPerson extends PersonIdentity {
  readonly isStarred: boolean;
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly tagCount: number;
  readonly tags: readonly PeopleDirectoryTag[];
}

export interface PeopleDirectoryInput {
  readonly cursor?: string;
  readonly lifecycle?: PeopleDirectoryLifecycle;
  readonly limit?: number;
  readonly search?: string;
  readonly sort?: PeopleDirectorySort;
  readonly tagId?: string;
}

export interface PeopleDirectoryPage {
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly nextCursor?: string;
  readonly people: readonly PeopleDirectoryPerson[];
  readonly status: "ready";
}

export interface PeopleTagOptionsInput {
  readonly cursor?: string;
  readonly search?: string;
  readonly selectedTagId?: string;
}

export interface PeopleTagOptionsPage {
  readonly nextCursor?: string;
  readonly options: readonly PeopleDirectoryTag[];
  readonly selected?: PeopleDirectoryTag;
  readonly status: "ready";
}

export function listPeople(input: PeopleDirectoryInput = {}, workspaceId?: string): Promise<ApiResult<PeopleDirectoryPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.lifecycle) query.set("lifecycle", input.lifecycle);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.search) query.set("search", input.search);
  if (input.sort) query.set("sort", input.sort);
  if (input.tagId) query.set("tag", input.tagId);
  const suffix = query.size > 0 ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/people\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listPeopleTagOptions(input: PeopleTagOptionsInput = {}, workspaceId?: string): Promise<ApiResult<PeopleTagOptionsPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.search) query.set("search", input.search);
  if (input.selectedTagId) query.set("selected", input.selectedTagId);
  const suffix = query.size > 0 ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/people/tag-options\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createPerson(input: PersonInput, workspaceId?: string): Promise<ApiResult<{ readonly status: "created"; readonly person: PersonIdentity; readonly next: string }>> {
  return request("/api/v1/people", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function getPerson(personId: string, workspaceId?: string): Promise<ApiResult<{ readonly dueInformation: PersonDueInformation; readonly status: "ready" | "archived"; readonly person: PersonProfileIdentity }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function editPerson(personId: string, input: PersonEditInput, workspaceId?: string): Promise<ApiResult<{ readonly person: PersonLifecycleIdentity; readonly status: "updated" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function archivePerson(personId: string, input: PersonTransitionInput, workspaceId?: string): Promise<ApiResult<{ readonly person: PersonLifecycleIdentity; readonly status: "archived" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/archive\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function restorePerson(personId: string, input: PersonTransitionInput, workspaceId?: string): Promise<ApiResult<{ readonly person: PersonLifecycleIdentity; readonly status: "restored" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/restore\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function getPersonDeletionImpact(personId: string, workspaceId?: string): Promise<ApiResult<PersonDeletionImpact>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/deletion-impact\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function deletePerson(personId: string, input: PersonTransitionInput & { readonly confirmation: string }, workspaceId?: string): Promise<ApiResult<{ readonly next: "/app/people"; readonly personId: string; readonly status: "deleted" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}
`;
}

if (import.meta.main) {
  const openApi = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const client = renderGeneratedClient() + renderInvitationClient() +
    renderSettingsClient() + renderPeopleClient();
  const check = Deno.args.includes("--check");
  if (check) {
    const currentOpenApi = await Deno.readTextFile(openApiPath).catch(() => "");
    const currentClient = await Deno.readTextFile(clientPath).catch(() => "");
    if (currentOpenApi !== openApi || currentClient !== client) {
      throw new Error(
        "Generated API contracts are out of date. Run deno task contracts:generate.",
      );
    }
  } else {
    await Deno.mkdir(
      new URL("../../packages/contracts/openapi/", import.meta.url),
      { recursive: true },
    );
    await Deno.mkdir(
      new URL("../../packages/contracts/generated/", import.meta.url),
      { recursive: true },
    );
    await Deno.writeTextFile(openApiPath, openApi);
    await Deno.writeTextFile(clientPath, client);
  }
}
