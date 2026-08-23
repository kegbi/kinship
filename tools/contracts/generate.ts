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
  const workspaceQueryParameter = {
    name: "workspaceId",
    in: "query",
    required: false,
    description:
      "Optional workspace selection for browser download links; validated against active membership.",
    schema: { type: "string", format: "uuid" },
  };
  const personIdParameter = {
    name: "personId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const fileIdParameter = {
    name: "fileId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const giftIdParameter = {
    name: "giftId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const debtIdParameter = {
    name: "debtId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const journalItemIdParameter = {
    name: "itemId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const taskIdParameter = {
    name: "taskId",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
  const reminderIdParameter = {
    name: "reminderId",
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
  const importantDateRequired = [
    "isAgeBased",
    "isYearApproximate",
    "kind",
    "precision",
  ];
  const relationshipRequired = [
    "createdAt",
    "forwardLabel",
    "fromPersonId",
    "id",
    "relationshipTypeId",
    "relationshipTypeArchived",
    "reverseLabel",
    "status",
    "toPersonId",
    "updatedAt",
  ];
  const relationshipProperties = {
    createdAt: { type: "string", format: "date-time" },
    forwardLabel: { type: "string" },
    fromPersonId: { type: "string", format: "uuid" },
    id: { type: "string", format: "uuid" },
    relationshipTypeId: { type: "string", format: "uuid" },
    relationshipTypeArchived: { type: "boolean" },
    reverseLabel: { type: "string" },
    status: { enum: ["active", "ended"] },
    toPersonId: { type: "string", format: "uuid" },
    updatedAt: { type: "string", format: "date-time" },
  };
  const importantDateProperties = {
    day: { type: "integer", minimum: 1, maximum: 31 },
    isAgeBased: { type: "boolean" },
    isYearApproximate: { type: "boolean" },
    kind: {
      type: "string",
      enum: ["birthday", "custom", "deceased", "first_met"],
    },
    label: { type: "string", maxLength: 200 },
    month: { type: "integer", minimum: 1, maximum: 12 },
    notes: { type: "string", maxLength: 2_000 },
    precision: {
      type: "string",
      enum: [
        "day",
        "full",
        "month",
        "month_day",
        "unknown",
        "year",
        "year_month",
      ],
    },
    year: { type: "integer", minimum: 1, maximum: 9999 },
  };
  const profileFactProperties = {
    city: { type: "string", maxLength: 200 },
    country: { type: "string", maxLength: 200 },
    categoryId: { type: "string", format: "uuid" },
    description: { type: "string", maxLength: 2_000 },
    displayName: { type: "string", maxLength: 200 },
    endOn: { type: "string", format: "date" },
    foodPreferences: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
      pattern: "\\S",
    },
    isCurrent: { type: "boolean" },
    isPrimary: { type: "boolean" },
    labelIds: {
      type: "array",
      maxItems: 20,
      items: { type: "string", format: "uuid" },
    },
    name: { type: "string", maxLength: 200 },
    notes: { type: "string", maxLength: 2_000 },
    organizationId: { type: "string", format: "uuid" },
    organizationName: { type: "string", maxLength: 200 },
    introducedByPersonId: { type: "string", format: "uuid" },
    placeText: { type: "string", maxLength: 500 },
    postalCode: { type: "string", maxLength: 50 },
    region: { type: "string", maxLength: 200 },
    section: { type: "string" },
    startOn: { type: "string", format: "date" },
    street: { type: "string", maxLength: 500 },
    tagIds: {
      type: "array",
      maxItems: 500,
      items: { type: "string", format: "uuid" },
    },
    title: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" },
    typeId: { type: "string", format: "uuid" },
    value: {
      type: "string",
      minLength: 1,
      maxLength: 2_000,
      pattern: "\\S",
    },
  };
  const selectedProfileFactProperties = (names: readonly string[]) =>
    Object.fromEntries(names.map((name) => [
      name,
      profileFactProperties[name as keyof typeof profileFactProperties],
    ]));
  const closedSchema = (
    section: string,
    required: readonly string[],
    properties: readonly string[],
    _source: typeof profileFactProperties,
  ) => ({
    type: "object",
    required: ["section", ...required],
    properties: {
      ...selectedProfileFactProperties(properties),
      section: { const: section },
    },
    additionalProperties: false,
  });
  const profileFactInputSchema = (
    section: string,
    required: readonly string[],
    properties: readonly string[],
    source: typeof profileFactProperties,
    update = false,
  ) => ({
    ...closedSchema(
      section,
      [
        "expectedPersonUpdatedAt",
        ...(update ? ["expectedUpdatedAt", "id"] : []),
        ...required,
      ],
      ["section", ...properties],
      source,
    ),
    properties: {
      ...selectedProfileFactProperties(properties),
      expectedPersonUpdatedAt: { type: "string", format: "date-time" },
      ...(update
        ? {
          expectedUpdatedAt: { type: "string", format: "date-time" },
          id: { type: "string", format: "uuid" },
        }
        : {}),
      section: { const: section },
    },
  });
  const requiredNonBlankProfileFactDetail = (name: string) => ({
    required: [name],
    properties: {
      [name]: { type: "string", minLength: 1, pattern: "\\S" },
    },
  });
  const todayAttentionItem = (
    kind: string,
    required: readonly string[],
    properties: Readonly<Record<string, unknown>> = {},
  ) => ({
    type: "object",
    required: ["dueAt", "id", "kind", ...required, "title"],
    properties: {
      dueAt: { type: "string", format: "date-time" },
      id: { type: "string", format: "uuid" },
      kind: { const: kind },
      person: { $ref: "#/components/schemas/TodayAttentionPerson" },
      ...properties,
      title: { type: "string" },
    },
    additionalProperties: false,
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
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "excludePersonId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "selectedPersonId",
              in: "query",
              schema: { type: "string", format: "uuid" },
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
            "409": problem,
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
            "409": problem,
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
      "/api/v1/people/{personId}/life-events": {
        get: {
          operationId: "listPersonLifeEvents",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description:
                "Bounded precision-aware life-event history from the person profile read model",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PersonLifeEventsReady",
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
      "/api/v1/people/{personId}/view": {
        post: {
          operationId: "recordPersonView",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Member-scoped recent-person view recorded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonViewRecorded" },
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
      "/api/v1/people/{personId}/archive": {
        post: personMutation(
          "archivePerson",
          "PersonTransitionInput",
          "PersonLifecycleChanged",
        ),
      },
      "/api/v1/relationship-types": {
        get: {
          operationId: "listRelationshipTypes",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "search",
              in: "query",
              schema: { type: "string", maxLength: 200 },
            },
            {
              name: "selected",
              in: "query",
              style: "form",
              explode: false,
              schema: {
                type: "array",
                maxItems: 20,
                items: { type: "string", format: "uuid" },
              },
            },
          ],
          responses: {
            "200": {
              description: "Bounded active workspace relationship types",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipTypeList" },
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
      "/api/v1/interactions": {
        post: {
          operationId: "recordInteraction",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/InteractionInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Interaction or communication persisted atomically",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InteractionCreated" },
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
        },
      },
      "/api/v1/interaction-options": {
        get: {
          operationId: "listInteractionOptions",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            ...[
              "activityTypeCursor",
              "activityTypeSearch",
              "emotionCursor",
              "emotionSearch",
            ].map((name) => ({
              name,
              in: "query",
              schema: {
                type: "string",
                maxLength: name.endsWith("Cursor") ? 2_000 : 100,
              },
            })),
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 20, default: 20 },
            },
          ],
          responses: {
            "200": {
              description: "Bounded active activity types and emotions",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/InteractionOptions" },
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
      "/api/v1/communication-options": {
        get: {
          operationId: "listCommunicationOptions",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description:
                "Active communication channels, emotions, and availability",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CommunicationOptions" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/communications": {
        get: {
          operationId: "listPersonCommunications",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Tenant-scoped person communication history",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CommunicationList" },
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
      "/api/v1/people/{personId}/activity-report": {
        get: {
          operationId: "getActivityReport",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            personIdParameter,
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "kind",
              in: "query",
              schema: { type: "string", enum: ["activity", "note"] },
            },
            {
              name: "year",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 9999 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            },
          ],
          responses: {
            "200": {
              description: "Tenant-scoped person activity report",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ActivityReport" },
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
        },
      },
      "/api/v1/audit-events": {
        get: {
          operationId: "listWorkspaceAudit",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "personId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "actorMemberId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "action",
              in: "query",
              schema: { type: "string", minLength: 1, maxLength: 200 },
            },
            {
              name: "from",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "to",
              in: "query",
              schema: { type: "string", format: "date-time" },
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
              description: "Authorized redacted workspace audit history",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditHistory" },
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
        },
      },
      "/api/v1/legal-documents/{documentType}": {
        get: {
          operationId: "getPublicLegalDocument",
          parameters: [{
            name: "documentType",
            in: "path",
            required: true,
            schema: { type: "string", enum: ["privacy", "terms"] },
          }],
          responses: {
            "200": {
              description: "Exact active public legal-document version",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LegalDocumentReady" },
                },
              },
            },
            "404": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/legal-requirements": {
        get: {
          operationId: "getLegalRequirements",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description:
                "Unaccepted active versions for the current identity and workspace",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LegalRequirements" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/legal-acceptances": {
        post: {
          operationId: "acceptLegalDocument",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["documentId"],
                  properties: {
                    documentId: { type: "string", format: "uuid" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Previously recorded immutable acceptance",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LegalAccepted" },
                },
              },
            },
            "201": {
              description: "Immutable acceptance recorded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/LegalAccepted" },
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
      "/api/v1/people/{personId}/audit": {
        get: {
          operationId: "listPersonAudit",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            personIdParameter,
            {
              name: "actorMemberId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "action",
              in: "query",
              schema: { type: "string", minLength: 1, maxLength: 200 },
            },
            {
              name: "from",
              in: "query",
              schema: { type: "string", format: "date-time" },
            },
            {
              name: "to",
              in: "query",
              schema: { type: "string", format: "date-time" },
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
              description: "Authorized redacted person audit history",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditHistory" },
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
        },
      },
      "/api/v1/people/{personId}/files": {
        get: {
          operationId: "listPersonFiles",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Explicit document and photo states for one person",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonFileList" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
        post: {
          operationId: "uploadPersonFile",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            personIdParameter,
            {
              name: "X-File-Kind",
              in: "header",
              required: true,
              schema: { type: "string", enum: ["document", "photo"] },
            },
            {
              name: "X-File-Name",
              in: "header",
              required: true,
              schema: { type: "string", maxLength: 500 },
            },
            {
              name: "X-File-Title",
              in: "header",
              required: true,
              schema: { type: "string", maxLength: 500 },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/pdf": {
                schema: {
                  type: "string",
                  format: "binary",
                  maxLength: 10_485_760,
                },
              },
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                {
                  schema: {
                    type: "string",
                    format: "binary",
                    maxLength: 10_485_760,
                  },
                },
              "image/jpeg": {
                schema: {
                  type: "string",
                  format: "binary",
                  maxLength: 10_485_760,
                },
              },
              "image/png": {
                schema: {
                  type: "string",
                  format: "binary",
                  maxLength: 10_485_760,
                },
              },
              "image/webp": {
                schema: {
                  type: "string",
                  format: "binary",
                  maxLength: 10_485_760,
                },
              },
              "text/plain": {
                schema: {
                  type: "string",
                  format: "binary",
                  maxLength: 10_485_760,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Stored metadata and typed person link created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonFileCreated" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "404": problem,
            "413": problem,
            "415": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/files/{fileId}": {
        delete: {
          operationId: "removePersonFile",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            personIdParameter,
            fileIdParameter,
          ],
          responses: {
            "200": {
              description: "Person file safely removed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["fileId", "status"],
                    properties: {
                      fileId: { type: "string", format: "uuid" },
                      status: { const: "removed" },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "409": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/files/{fileId}/content": {
        get: {
          operationId: "downloadPersonFile",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter, fileIdParameter],
          responses: {
            "200": {
              description: "Authorized private file bytes",
              content: {
                "application/pdf": {
                  schema: { type: "string", format: "binary" },
                },
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                  {
                    schema: { type: "string", format: "binary" },
                  },
                "text/plain": {
                  schema: { type: "string", format: "binary" },
                },
                "image/jpeg": {
                  schema: { type: "string", format: "binary" },
                },
                "image/png": {
                  schema: { type: "string", format: "binary" },
                },
                "image/webp": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "410": problem,
            "423": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/journal": {
        get: {
          operationId: "listJournal",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Ordered personal journal",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JournalTimelineList" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/journal/items/{itemId}": {
        get: {
          operationId: "getJournalItem",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, journalItemIdParameter],
          responses: {
            "200": {
              description: "One journal item",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JournalItemReady" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
        delete: {
          operationId: "deleteJournalItem",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            journalItemIdParameter,
          ],
          responses: {
            "200": {
              description: "Journal item removed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JournalDeleted" },
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
      "/api/v1/journal/posts": {
        post: {
          operationId: "createJournalPost",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JournalPostInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Journal post created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/JournalPostCreated",
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
      "/api/v1/journal/posts/{itemId}": {
        put: {
          operationId: "updateJournalPost",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            journalItemIdParameter,
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JournalPostInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Journal post updated",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/JournalPostUpdated",
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
      "/api/v1/journal/day-ratings": {
        put: {
          operationId: "saveJournalDayRating",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JournalDayRatingInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Day rating updated",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/JournalDayRatingSaved",
                  },
                },
              },
            },
            "201": {
              description: "Day rating created",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/JournalDayRatingSaved",
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
      "/api/v1/journal/activities": {
        post: {
          operationId: "linkJournalActivity",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["activityId"],
                  properties: {
                    activityId: { type: "string", format: "uuid" },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Activity linked",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/JournalActivityLinked",
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
      "/api/v1/people/{personId}/gifts": {
        get: {
          operationId: "listPersonGiftsAndDebts",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Person gift and debt sections",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GiftDebtList" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
        post: {
          operationId: "createGift",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GiftCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Gift created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GiftCreated" },
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
        },
      },
      "/api/v1/people/{personId}/gifts/{giftId}/status": {
        patch: {
          operationId: "changeGiftStatus",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            personIdParameter,
            giftIdParameter,
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GiftStatusInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Gift status changed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GiftSaved" },
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
        },
      },
      "/api/v1/people/{personId}/debts": {
        post: {
          operationId: "createDebt",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DebtCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Debt created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DebtCreated" },
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
        },
      },
      "/api/v1/people/{personId}/debts/{debtId}/status": {
        patch: {
          operationId: "changeDebtStatus",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            personIdParameter,
            debtIdParameter,
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DebtStatusInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Debt status changed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DebtSaved" },
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
        },
      },
      "/api/v1/tasks": {
        get: {
          operationId: "listTasks",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "personId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "status",
              in: "query",
              schema: { enum: ["cancelled", "completed", "open"] },
            },
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 100,
              },
            },
          ],
          responses: {
            "200": {
              description: "Bounded tenant-scoped task list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskList" },
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
          operationId: "createTask",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Task created idempotently",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskCreated" },
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
        },
      },
      "/api/v1/tasks/{taskId}": {
        patch: {
          operationId: "changeTask",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, taskIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskChangeInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Task changed or already equal",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskChanged" },
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
        },
      },
      "/api/v1/tasks/{taskId}/completion": {
        put: {
          operationId: "setTaskCompletion",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, taskIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TaskCompletionInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Idempotent task completion state",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TaskChanged" },
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
        },
      },
      "/api/v1/today/tasks": {
        get: {
          operationId: "getTodayTasks",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Read-only due-task Today region",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TodayTasks" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/today/attention": {
        get: {
          operationId: "getTodayAttention",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description:
                "Unified member-local Today attention and upcoming projection",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TodayAttention" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/today/recent-people": {
        get: {
          operationId: "getTodayRecentPeople",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description:
                "Bounded actual member-scoped recently viewed people",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TodayRecentPeople" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/reminders": {
        get: {
          operationId: "listPersonReminders",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Person reminder and cadence section",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonReminders" },
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
      "/api/v1/reminders": {
        post: {
          operationId: "createReminder",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReminderCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Calendar reminder created with unique future occurrences",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReminderCreated" },
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
        },
      },
      "/api/v1/stay-in-touch-cadences": {
        post: {
          operationId: "createStayInTouchCadence",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CadenceCreateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Stay-in-touch cadence created or changed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CadenceCreated" },
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
        },
      },
      "/api/v1/reminders/{reminderId}/active": {
        put: {
          operationId: "setReminderActive",
          security: [{ kinship_session: [] }],
          parameters: [
            originParameter,
            workspaceParameter,
            reminderIdParameter,
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["active"],
                  properties: { active: { type: "boolean" } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Reminder active state changed; safe unattempted work is cancelled when disabled, in-flight delivery is preserved, and future work is regenerated when re-enabled",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReminderSaved" },
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
        },
      },
      "/api/v1/today/reminders": {
        get: {
          operationId: "getTodayReminders",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Independent Today reminder and cadence regions",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TodayReminders" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/today/favorite-notes": {
        get: {
          operationId: "getTodayFavoriteNotes",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Read-only favorite-note Today region",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/TodayFavoriteNotes" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/today/recent-activity": {
        get: {
          operationId: "getTodayRecentActivity",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Read-only recent-activity Today region",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/TodayRecentActivity",
                  },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/relationships": {
        get: {
          operationId: "listRelationships",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            personIdParameter,
            {
              name: "cursor",
              in: "query",
              schema: { type: "string", maxLength: 2_000 },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: 20, default: 20 },
            },
          ],
          responses: {
            "200": {
              description:
                "Directional relationships for one person profile section",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipList" },
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
        },
        post: {
          operationId: "createRelationship",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelationshipCreateInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Idempotent existing relationship",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipChanged" },
                },
              },
            },
            "201": {
              description: "Relationship created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipChanged" },
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
        },
      },
      "/api/v1/people/{personId}/relationships/{relationshipId}": {
        parameters: [{
          name: "relationshipId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
        patch: {
          operationId: "updateRelationship",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelationshipUpdateInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Relationship updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipChanged" },
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
        },
        delete: {
          operationId: "deleteRelationship",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PersonTransitionInput" },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Relationship unlinked without deleting either person",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RelationshipDeleted" },
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
        },
      },
      "/api/v1/people/{personId}/relationships/related-person": {
        post: {
          operationId: "createRelatedPersonRelationship",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RelatedPersonRelationshipInput",
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Person and relationship created atomically",
              content: {
                "application/json": {
                  schema: {
                    $ref:
                      "#/components/schemas/RelatedPersonRelationshipChanged",
                  },
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
        },
      },
      "/api/v1/people/{personId}/dates": {
        get: {
          operationId: "listImportantDates",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter],
          responses: {
            "200": {
              description: "Exact important-date list for one workspace person",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportantDateList" },
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
        post: {
          operationId: "createImportantDate",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ImportantDateInput" },
              },
            },
          },
          responses: {
            "201": {
              description: "Important date created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportantDateChanged" },
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
        },
      },
      "/api/v1/people/{personId}/dates/{dateId}": {
        parameters: [{
          name: "dateId",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
        patch: {
          operationId: "updateImportantDate",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ImportantDateUpdateInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Important date updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportantDateChanged" },
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
        },
        delete: {
          operationId: "deleteImportantDate",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PersonTransitionInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Important date deleted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportantDateDeleted" },
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
        },
      },
      "/api/v1/people/{personId}/facts/{section}": {
        parameters: [{
          name: "section",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/ProfileFactSectionId" },
        }],
        get: {
          operationId: "listProfileFacts",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, personIdParameter, {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 2_000 },
          }, {
            name: "includeOptions",
            in: "query",
            required: false,
            schema: { type: "boolean", enum: [true] },
          }, {
            name: "optionCursor",
            in: "query",
            required: false,
            description: "Requires includeOptions=true.",
            schema: { type: "string", maxLength: 2_000 },
          }, {
            name: "optionSearch",
            in: "query",
            required: false,
            schema: { type: "string", maxLength: 200 },
          }],
          responses: {
            "200": {
              description: "One enabled person profile-fact section",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileFactSection" },
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
        },
        post: {
          operationId: "createProfileFact",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileFactCreateInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Profile fact saved",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileFactChanged" },
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
        },
      },
      "/api/v1/people/{personId}/facts/{section}/{factId}": {
        parameters: [
          {
            name: "section",
            in: "path",
            required: true,
            schema: { $ref: "#/components/schemas/ProfileFactSectionId" },
          },
          {
            name: "factId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        put: {
          operationId: "updateProfileFact",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileFactUpdateInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Profile fact updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileFactChanged" },
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
        },
        delete: {
          operationId: "deleteProfileFact",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, personIdParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProfileFactDeleteInput" },
              },
            },
          },
          responses: {
            "200": {
              description: "Profile fact deleted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileFactDeleted" },
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
        },
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
      "/api/v1/settings/personal-lifecycle": {
        ...securedRead(
          "getPersonalLifecyclePreview",
          "PersonalLifecyclePreview",
        ),
        delete: {
          operationId: "deletePersonalIdentity",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PersonalIdentityDeletionInput",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Personal identity deleted and sessions revoked",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PersonalIdentityDeleted",
                  },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "409": problem,
            "429": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/settings/personal-lifecycle/leave": {
        post: {
          operationId: "leaveCurrentWorkspace",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PersonalLifecycleConfirmation",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Current workspace left with next valid destination",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/WorkspaceLeft" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "409": problem,
            "429": problem,
            "503": problem,
          },
        },
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
      "/api/v1/settings/storage": {
        get: {
          operationId: "getStorageSettings",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            {
              name: "query",
              in: "query",
              schema: { type: "string", maxLength: 100 },
            },
          ],
          responses: {
            "200": {
              description: "Admin-only safe workspace storage diagnostics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/StorageSettings" },
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
      "/api/v1/imports": {
        get: {
          operationId: "listImports",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Admin-only import history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["imports"],
                    properties: {
                      imports: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ImportSummary" },
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/imports/dry-runs": {
        post: {
          operationId: "createImportDryRun",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["source"],
                  properties: { source: { type: "object" } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Validated bounded Monica dry-run",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportDryRun" },
                },
              },
            },
            "400": problem,
            "401": problem,
            "403": problem,
            "413": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/imports/{importId}": {
        get: {
          operationId: "getImportReport",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, {
            name: "importId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            "200": {
              description: "Import report",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ImportSummary" },
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
      "/api/v1/imports/{importId}/commit": {
        post: {
          operationId: "commitImport",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, {
            name: "importId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["confirmed"],
                  properties: { confirmed: { const: true } },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Atomic idempotent import commit",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "importId",
                      "peopleCreated",
                      "peopleReused",
                      "status",
                    ],
                    properties: {
                      importId: { type: "string", format: "uuid" },
                      peopleCreated: { type: "integer", minimum: 0 },
                      peopleReused: { type: "integer", minimum: 0 },
                      status: { const: "completed" },
                    },
                    additionalProperties: false,
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
      "/api/v1/exports": {
        get: {
          operationId: "listExports",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Admin-only export history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["exports"],
                    properties: {
                      exports: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ExportSummary" },
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            "401": problem,
            "403": problem,
            "503": problem,
          },
        },
        post: {
          operationId: "createWorkspaceExport",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          responses: {
            "201": {
              description: "Completed portable workspace export",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ExportSummary" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "413": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/exports/{exportId}/downloads": {
        post: {
          operationId: "createExportDownload",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, {
            name: "exportId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            "201": {
              description: "Short-lived authorized download reference",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ExportDownload" },
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
      "/api/v1/exports/{exportId}/download": {
        get: {
          operationId: "downloadExport",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter, {
            name: "exportId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          }, {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 200 },
          }, workspaceQueryParameter],
          responses: {
            "200": {
              description: "Private portable export artifact",
              content: {
                "application/json": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "410": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/people/{personId}/vcard": {
        get: {
          operationId: "exportPersonVCard",
          security: [{ kinship_session: [] }],
          parameters: [
            workspaceParameter,
            workspaceQueryParameter,
            personIdParameter,
          ],
          responses: {
            "200": {
              description: "Member-authorized person vCard",
              content: {
                "text/vcard": { schema: { type: "string", format: "binary" } },
              },
            },
            "401": problem,
            "404": problem,
            "503": problem,
          },
        },
      },
      "/api/v1/settings/personalization/{section}": {
        parameters: [{
          name: "section",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/PersonalizationSection" },
        }],
        get: {
          operationId: "listPersonalizationEntries",
          security: [{ kinship_session: [] }],
          parameters: [workspaceParameter],
          responses: {
            "200": {
              description: "Active-workspace personalization section",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonalizationList" },
                },
              },
            },
            "401": problem,
            "403": problem,
            "404": problem,
            "503": problem,
          },
        },
        post: {
          operationId: "createPersonalizationEntry",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PersonalizationCreate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Personalization entry created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonalizationSaved" },
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
      "/api/v1/settings/personalization/{section}/{id}": {
        parameters: [
          {
            name: "section",
            in: "path",
            required: true,
            schema: { $ref: "#/components/schemas/PersonalizationSection" },
          },
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        patch: {
          operationId: "updatePersonalizationEntry",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PersonalizationUpdate" },
              },
            },
          },
          responses: {
            "200": {
              description: "Personalization entry updated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PersonalizationSaved" },
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
        },
        delete: {
          operationId: "deletePersonalizationEntry",
          security: [{ kinship_session: [] }],
          parameters: [originParameter, workspaceParameter, {
            name: "expectedUpdatedAt",
            in: "query",
            required: true,
            schema: { type: "string", format: "date-time" },
          }, {
            name: "replacementId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            "200": {
              description: "Personalization entry deleted",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/PersonalizationDeleted",
                  },
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
        },
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
            "requiredLegalDocuments",
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
            requiredLegalDocuments: {
              type: "array",
              items: { $ref: "#/components/schemas/LegalDocument" },
            },
          },
          additionalProperties: false,
        },
        LegalDocument: {
          type: "object",
          required: ["content", "documentType", "id", "version"],
          properties: {
            content: { type: "string" },
            documentType: { type: "string" },
            id: { type: "string", format: "uuid" },
            publishedAt: { type: "string", format: "date-time" },
            version: { type: "string" },
          },
          additionalProperties: false,
        },
        LegalDocumentReady: {
          type: "object",
          required: ["document", "status"],
          properties: {
            document: { $ref: "#/components/schemas/LegalDocument" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        LegalRequirements: {
          type: "object",
          required: ["documents", "status"],
          properties: {
            documents: {
              type: "array",
              items: { $ref: "#/components/schemas/LegalDocument" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        LegalAccepted: {
          type: "object",
          required: ["acceptedAt", "documentId", "status"],
          properties: {
            acceptedAt: { type: "string", format: "date-time" },
            documentId: { type: "string", format: "uuid" },
            status: { enum: ["accepted", "already-accepted"] },
          },
          additionalProperties: false,
        },
        PersonFile: {
          type: "object",
          required: [
            "byteSize",
            "createdAt",
            "fileId",
            "filename",
            "kind",
            "mimeType",
            "personId",
            "status",
            "title",
          ],
          properties: {
            byteSize: { type: "integer", minimum: 0, maximum: 10_485_760 },
            createdAt: { type: "string", format: "date-time" },
            fileId: { type: "string", format: "uuid" },
            filename: { type: "string" },
            kind: { type: "string" },
            mimeType: { type: "string" },
            personId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["available", "missing", "processing", "quarantined"],
            },
            title: { type: "string" },
          },
          additionalProperties: false,
        },
        PersonFileList: {
          type: "object",
          required: ["files", "status"],
          properties: {
            files: {
              type: "array",
              items: { $ref: "#/components/schemas/PersonFile" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        PersonFileCreated: {
          type: "object",
          required: ["file", "status"],
          properties: {
            file: { $ref: "#/components/schemas/PersonFile" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        JournalPostInput: {
          type: "object",
          required: ["body", "occurredAt"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 50_000 },
            occurredAt: { type: "string", format: "date-time" },
            title: { type: "string", minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        JournalDayRatingInput: {
          type: "object",
          required: ["ratedOn", "rating"],
          properties: {
            comment: { type: "string", minLength: 1, maxLength: 10_000 },
            ratedOn: { type: "string", format: "date" },
            rating: { type: "integer", minimum: 1, maximum: 5 },
          },
          additionalProperties: false,
        },
        JournalStoredPost: {
          type: "object",
          required: [
            "body",
            "createdAt",
            "id",
            "occurredAt",
            "updatedAt",
          ],
          properties: {
            body: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            title: { type: "string" },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        JournalStoredDayRating: {
          type: "object",
          required: ["createdAt", "id", "ratedOn", "rating", "updatedAt"],
          properties: {
            comment: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            ratedOn: { type: "string", format: "date" },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        JournalActivityItem: {
          type: "object",
          required: ["activity", "id", "occurredAt", "type"],
          properties: {
            activity: {
              type: "object",
              required: ["id", "summary"],
              properties: {
                id: { type: "string", format: "uuid" },
                summary: { type: "string" },
              },
              additionalProperties: false,
            },
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            type: { const: "activity" },
          },
          additionalProperties: false,
        },
        JournalDayRatingItem: {
          type: "object",
          required: ["dayRating", "id", "occurredAt", "type"],
          properties: {
            dayRating: {
              type: "object",
              required: ["id", "ratedOn", "rating"],
              properties: {
                comment: { type: "string" },
                id: { type: "string", format: "uuid" },
                ratedOn: { type: "string", format: "date" },
                rating: { type: "integer", minimum: 1, maximum: 5 },
              },
              additionalProperties: false,
            },
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            type: { const: "day-rating" },
          },
          additionalProperties: false,
        },
        JournalPostItem: {
          type: "object",
          required: ["id", "occurredAt", "post", "type"],
          properties: {
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            post: {
              type: "object",
              required: ["body", "id", "updatedAt"],
              properties: {
                body: { type: "string" },
                id: { type: "string", format: "uuid" },
                title: { type: "string" },
                updatedAt: { type: "string", format: "date-time" },
              },
              additionalProperties: false,
            },
            type: { const: "post" },
          },
          additionalProperties: false,
        },
        JournalTimelineItem: {
          oneOf: [
            { $ref: "#/components/schemas/JournalActivityItem" },
            { $ref: "#/components/schemas/JournalDayRatingItem" },
            { $ref: "#/components/schemas/JournalPostItem" },
          ],
          discriminator: {
            propertyName: "type",
            mapping: {
              activity: "#/components/schemas/JournalActivityItem",
              "day-rating": "#/components/schemas/JournalDayRatingItem",
              post: "#/components/schemas/JournalPostItem",
            },
          },
        },
        JournalLinkableActivity: {
          type: "object",
          required: ["happenedAt", "id", "summary"],
          properties: {
            happenedAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            summary: { type: "string" },
          },
          additionalProperties: false,
        },
        JournalTimelineList: {
          type: "object",
          required: ["activities", "items", "status"],
          properties: {
            activities: {
              type: "array",
              items: { $ref: "#/components/schemas/JournalLinkableActivity" },
            },
            items: {
              type: "array",
              items: { $ref: "#/components/schemas/JournalTimelineItem" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        JournalPostCreated: {
          type: "object",
          required: ["post", "status"],
          properties: {
            post: { $ref: "#/components/schemas/JournalStoredPost" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        JournalPostUpdated: {
          type: "object",
          required: ["post", "status"],
          properties: {
            post: { $ref: "#/components/schemas/JournalStoredPost" },
            status: { const: "updated" },
          },
          additionalProperties: false,
        },
        JournalDayRatingSaved: {
          type: "object",
          required: ["rating", "status"],
          properties: {
            rating: { $ref: "#/components/schemas/JournalStoredDayRating" },
            status: { enum: ["created", "updated"] },
          },
          additionalProperties: false,
        },
        JournalActivityLinked: {
          type: "object",
          required: ["activityId", "id", "occurredAt", "status"],
          properties: {
            activityId: { type: "string", format: "uuid" },
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        JournalDeleted: {
          type: "object",
          required: ["itemType", "status"],
          properties: {
            itemType: { enum: ["activity", "day-rating", "post"] },
            status: { const: "deleted" },
          },
          additionalProperties: false,
        },
        JournalItemReady: {
          type: "object",
          required: ["item", "status"],
          properties: {
            item: { $ref: "#/components/schemas/JournalTimelineItem" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        Gift: {
          type: "object",
          required: [
            "createdAt",
            "id",
            "name",
            "personId",
            "status",
            "updatedAt",
          ],
          properties: {
            amount: { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" },
            attachmentFileId: { type: "string", format: "uuid" },
            comment: { type: "string", maxLength: 10_000 },
            createdAt: { type: "string", format: "date-time" },
            currencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
            eventAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            name: { type: "string", minLength: 1, maxLength: 500 },
            personId: { type: "string", format: "uuid" },
            recipientPersonId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["idea", "planned", "given", "received", "archived"],
            },
            updatedAt: { type: "string", format: "date-time" },
            url: { type: "string", format: "uri", maxLength: 2_000 },
          },
          additionalProperties: false,
        },
        Debt: {
          type: "object",
          required: [
            "amount",
            "createdAt",
            "direction",
            "id",
            "personId",
            "status",
            "updatedAt",
          ],
          properties: {
            amount: { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" },
            createdAt: { type: "string", format: "date-time" },
            currencyCode: { type: "string", pattern: "^[A-Z]{3}$" },
            direction: { type: "string", enum: ["i_owe", "they_owe"] },
            id: { type: "string", format: "uuid" },
            personId: { type: "string", format: "uuid" },
            reason: { type: "string", maxLength: 10_000 },
            settledAt: { type: "string", format: "date-time" },
            status: { type: "string", enum: ["open", "settled", "cancelled"] },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        GiftDebtList: {
          type: "object",
          required: ["debts", "gifts", "status", "supportedCurrencyCodes"],
          properties: {
            debts: {
              type: "array",
              items: { $ref: "#/components/schemas/Debt" },
            },
            gifts: {
              type: "array",
              items: { $ref: "#/components/schemas/Gift" },
            },
            status: { const: "ready" },
            supportedCurrencyCodes: {
              type: "array",
              items: { type: "string", pattern: "^[A-Z]{3}$" },
            },
          },
          additionalProperties: false,
        },
        GiftCreateInput: {
          type: "object",
          required: ["name", "status"],
          properties: {
            amount: { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" },
            attachmentFileId: { type: "string", format: "uuid" },
            comment: { type: "string", minLength: 1, maxLength: 10_000 },
            currencyCode: { type: "string", pattern: "^[A-Za-z]{3}$" },
            eventAt: { type: "string", format: "date-time" },
            name: { type: "string", minLength: 1, maxLength: 500 },
            recipientPersonId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["idea", "planned", "given", "received", "archived"],
            },
            url: { type: "string", format: "uri", maxLength: 2_000 },
          },
          additionalProperties: false,
        },
        DebtCreateInput: {
          type: "object",
          required: ["amount", "currencyCode", "direction", "status"],
          properties: {
            amount: { type: "string", pattern: "^\\d{1,15}(?:\\.\\d{1,4})?$" },
            currencyCode: { type: "string", pattern: "^[A-Za-z]{3}$" },
            direction: { type: "string", enum: ["i_owe", "they_owe"] },
            reason: { type: "string", minLength: 1, maxLength: 10_000 },
            status: { type: "string", enum: ["open", "settled", "cancelled"] },
          },
          additionalProperties: false,
        },
        GiftStatusInput: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["idea", "planned", "given", "received", "archived"],
            },
          },
          additionalProperties: false,
        },
        DebtStatusInput: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["open", "settled", "cancelled"] },
          },
          additionalProperties: false,
        },
        GiftCreated: {
          type: "object",
          required: ["gift", "status"],
          properties: {
            gift: { $ref: "#/components/schemas/Gift" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        GiftSaved: {
          type: "object",
          required: ["gift", "status"],
          properties: {
            gift: { $ref: "#/components/schemas/Gift" },
            status: { enum: ["saved", "unchanged"] },
          },
          additionalProperties: false,
        },
        DebtCreated: {
          type: "object",
          required: ["debt", "status"],
          properties: {
            debt: { $ref: "#/components/schemas/Debt" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        DebtSaved: {
          type: "object",
          required: ["debt", "status"],
          properties: {
            debt: { $ref: "#/components/schemas/Debt" },
            status: { enum: ["saved", "unchanged"] },
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
            lastContactAt: { type: "string", format: "date-time" },
            middleName: { type: "string" },
            nickname: { type: "string" },
            profileSections: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "status"],
                properties: {
                  id: { $ref: "#/components/schemas/PersonProfileSectionId" },
                  status: { type: "string", enum: ["hidden", "ready"] },
                },
                additionalProperties: false,
              },
            },
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
        InteractionOption: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        InteractionParticipant: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        ActivityInteraction: {
          type: "object",
          required: [
            "emotions",
            "happenedAt",
            "id",
            "kind",
            "participants",
            "summary",
          ],
          properties: {
            activityType: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            description: { type: "string" },
            emotions: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            happenedAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            kind: { const: "activity" },
            participants: {
              type: "array",
              maxItems: 50,
              items: { $ref: "#/components/schemas/InteractionParticipant" },
            },
            summary: { type: "string" },
          },
          additionalProperties: false,
        },
        NoteInteraction: {
          type: "object",
          required: ["body", "createdAt", "id", "isFavorited", "kind"],
          properties: {
            body: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            isFavorited: { type: "boolean" },
            kind: { const: "note" },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
            participants: {
              type: "array",
              minItems: 1,
              maxItems: 1,
              items: { $ref: "#/components/schemas/InteractionParticipant" },
            },
          },
          additionalProperties: false,
        },
        CallInteraction: {
          type: "object",
          required: [
            "calledAt",
            "contactWasCaller",
            "createdAt",
            "emotions",
            "id",
            "kind",
            "person",
          ],
          properties: {
            calledAt: { type: "string", format: "date-time" },
            contactWasCaller: { type: "boolean" },
            content: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
            emotions: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            id: { type: "string", format: "uuid" },
            kind: { const: "call" },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
          },
          additionalProperties: false,
        },
        CommunicationMessage: {
          type: "object",
          required: ["content", "direction", "id", "writtenAt"],
          properties: {
            content: { type: "string" },
            direction: { enum: ["inbound", "outbound"] },
            id: { type: "string", format: "uuid" },
            writtenAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        ConversationInteraction: {
          type: "object",
          required: [
            "createdAt",
            "happenedAt",
            "id",
            "kind",
            "messages",
            "person",
          ],
          properties: {
            channelType: { $ref: "#/components/schemas/InteractionOption" },
            contactMethod: {
              type: "object",
              required: ["id", "value"],
              properties: {
                id: { type: "string", format: "uuid" },
                value: { type: "string" },
              },
              additionalProperties: false,
            },
            createdAt: { type: "string", format: "date-time" },
            happenedAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            kind: { const: "conversation" },
            messages: {
              type: "array",
              maxItems: 50,
              items: { $ref: "#/components/schemas/CommunicationMessage" },
            },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
            title: { type: "string" },
          },
          additionalProperties: false,
        },
        Interaction: {
          oneOf: [
            { $ref: "#/components/schemas/ActivityInteraction" },
            { $ref: "#/components/schemas/NoteInteraction" },
            { $ref: "#/components/schemas/CallInteraction" },
            { $ref: "#/components/schemas/ConversationInteraction" },
          ],
        },
        ActivityOrNoteInteraction: {
          oneOf: [
            { $ref: "#/components/schemas/ActivityInteraction" },
            { $ref: "#/components/schemas/NoteInteraction" },
          ],
        },
        ActivityInteractionInput: {
          type: "object",
          required: [
            "happenedAt",
            "kind",
            "participantIds",
            "requestId",
            "summary",
          ],
          properties: {
            activityTypeId: { type: "string", format: "uuid" },
            description: { type: "string", minLength: 1, maxLength: 10_000 },
            emotionIds: {
              type: "array",
              maxItems: 20,
              items: { type: "string", format: "uuid" },
            },
            happenedAt: { type: "string", format: "date-time" },
            kind: { const: "activity" },
            participantIds: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: { type: "string", format: "uuid" },
            },
            requestId: {
              type: "string",
              format: "uuid",
              description:
                "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
            },
            summary: { type: "string", minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        NoteInteractionInput: {
          type: "object",
          required: ["body", "kind", "personId", "requestId"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 10_000 },
            isFavorited: { type: "boolean" },
            kind: { const: "note" },
            personId: { type: "string", format: "uuid" },
            requestId: {
              type: "string",
              format: "uuid",
              description:
                "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
            },
          },
          additionalProperties: false,
        },
        CallInteractionInput: {
          type: "object",
          required: [
            "calledAt",
            "contactWasCaller",
            "kind",
            "personId",
            "requestId",
          ],
          properties: {
            calledAt: { type: "string", format: "date-time" },
            contactWasCaller: { type: "boolean" },
            content: { type: "string", minLength: 1, maxLength: 10_000 },
            emotionIds: {
              type: "array",
              maxItems: 20,
              items: { type: "string", format: "uuid" },
            },
            kind: { const: "call" },
            personId: { type: "string", format: "uuid" },
            requestId: {
              type: "string",
              format: "uuid",
              description:
                "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
            },
          },
          additionalProperties: false,
        },
        ConversationInteractionInput: {
          type: "object",
          required: [
            "channelTypeId",
            "happenedAt",
            "kind",
            "personId",
            "requestId",
          ],
          properties: {
            channelTypeId: { type: "string", format: "uuid" },
            contactMethodId: { type: "string", format: "uuid" },
            happenedAt: { type: "string", format: "date-time" },
            kind: { const: "conversation" },
            messages: {
              type: "array",
              maxItems: 50,
              items: {
                type: "object",
                required: ["content", "direction", "writtenAt"],
                properties: {
                  content: { type: "string", minLength: 1, maxLength: 10_000 },
                  direction: { enum: ["inbound", "outbound"] },
                  writtenAt: { type: "string", format: "date-time" },
                },
                additionalProperties: false,
              },
            },
            personId: { type: "string", format: "uuid" },
            requestId: {
              type: "string",
              format: "uuid",
              description:
                "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
            },
            title: { type: "string", minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        InteractionInput: {
          oneOf: [
            { $ref: "#/components/schemas/ActivityInteractionInput" },
            { $ref: "#/components/schemas/NoteInteractionInput" },
            { $ref: "#/components/schemas/CallInteractionInput" },
            { $ref: "#/components/schemas/ConversationInteractionInput" },
          ],
        },
        InteractionCreated: {
          type: "object",
          required: ["record", "status"],
          properties: {
            record: { $ref: "#/components/schemas/Interaction" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        InteractionOptions: {
          type: "object",
          required: ["activityTypes", "availability", "emotions", "status"],
          properties: {
            activityTypes: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            activityTypesNextCursor: { type: "string" },
            availability: {
              type: "object",
              required: ["activity", "note"],
              properties: {
                activity: { type: "boolean" },
                note: { type: "boolean" },
              },
              additionalProperties: false,
            },
            emotions: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            emotionsNextCursor: { type: "string" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        CommunicationOptions: {
          type: "object",
          required: ["availability", "channelTypes", "emotions", "status"],
          properties: {
            availability: {
              type: "object",
              required: ["call", "conversation"],
              properties: {
                call: { type: "boolean" },
                conversation: { type: "boolean" },
              },
              additionalProperties: false,
            },
            channelTypes: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            emotions: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/InteractionOption" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        CommunicationList: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 50,
              items: {
                oneOf: [{ $ref: "#/components/schemas/CallInteraction" }, {
                  $ref: "#/components/schemas/ConversationInteraction",
                }],
              },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        ActivityReport: {
          type: "object",
          required: ["items", "person", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 50,
              items: {
                $ref: "#/components/schemas/ActivityOrNoteInteraction",
              },
            },
            nextCursor: { type: "string" },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
            status: { enum: ["archived", "ready"] },
          },
          additionalProperties: false,
        },
        AuditDateDetail: {
          type: "object",
          required: ["isYearApproximate", "precision"],
          properties: {
            isYearApproximate: { type: "boolean" },
            precision: {
              enum: [
                "day",
                "full",
                "month",
                "month_day",
                "unknown",
                "year",
                "year_month",
              ],
            },
          },
          additionalProperties: false,
        },
        AuditTransitionDetail: {
          oneOf: [
            { type: "null" },
            {
              enum: ["active", "archived", "deleted"],
            },
            { $ref: "#/components/schemas/AuditDateDetail" },
          ],
        },
        AuditEvent: {
          type: "object",
          required: [
            "action",
            "actor",
            "details",
            "id",
            "occurredAt",
            "redacted",
            "subject",
          ],
          properties: {
            action: { type: "string" },
            actor: {
              type: "object",
              required: ["name"],
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
            details: {
              type: "object",
              properties: {
                action: {
                  enum: [
                    "changed",
                    "completed",
                    "create",
                    "created",
                    "delete",
                    "reopened",
                    "save",
                    "update",
                  ],
                },
                current: { type: "boolean" },
                from: {
                  $ref: "#/components/schemas/AuditTransitionDetail",
                },
                fromPersonId: { type: "string", format: "uuid" },
                isPartial: { type: "boolean" },
                kind: { enum: ["activity", "call", "conversation", "note"] },
                participantIds: {
                  type: "array",
                  maxItems: 50,
                  items: { type: "string", format: "uuid" },
                },
                personId: { type: "string", format: "uuid" },
                relationshipTypeId: { type: "string", format: "uuid" },
                role: { enum: ["admin", "member", "owner"] },
                section: {
                  enum: [
                    "activity-types",
                    "addresses",
                    "contact-labels",
                    "contact-method-types",
                    "contact-methods",
                    "emotion-options",
                    "first-meeting",
                    "food-preferences",
                    "gender-options",
                    "identity-summary",
                    "life-event-types",
                    "pet-categories",
                    "pets",
                    "profile-modules",
                    "relationship-types",
                    "reminder-rules",
                    "security",
                    "tags",
                    "work",
                  ],
                },
                status: {
                  enum: [
                    "active",
                    "cancelled",
                    "completed",
                    "open",
                    "suspended",
                  ],
                },
                to: {
                  $ref: "#/components/schemas/AuditTransitionDetail",
                },
                toPersonId: { type: "string", format: "uuid" },
              },
              additionalProperties: false,
            },
            id: { type: "string", format: "uuid" },
            occurredAt: { type: "string", format: "date-time" },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
            redacted: { type: "boolean" },
            subject: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                type: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        AuditHistory: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 50,
              items: { $ref: "#/components/schemas/AuditEvent" },
            },
            nextCursor: { type: "string" },
            person: { $ref: "#/components/schemas/InteractionParticipant" },
            status: { enum: ["archived", "ready"] },
          },
          additionalProperties: false,
        },
        TaskPerson: {
          type: "object",
          required: ["archived", "id", "name"],
          properties: {
            archived: { type: "boolean" },
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            unavailable: { type: "boolean" },
          },
          additionalProperties: false,
        },
        Task: {
          type: "object",
          required: ["createdAt", "id", "status", "title", "updatedAt"],
          properties: {
            completedAt: { type: "string", format: "date-time" },
            completedByMemberId: { type: "string", format: "uuid" },
            createdAt: { type: "string", format: "date-time" },
            createdByMemberId: { type: "string", format: "uuid" },
            description: { type: "string" },
            dueAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            person: { $ref: "#/components/schemas/TaskPerson" },
            status: { enum: ["cancelled", "completed", "open"] },
            title: { type: "string" },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        TaskList: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/Task" },
            },
            nextCursor: { type: "string" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        TaskCreateInput: {
          type: "object",
          required: ["requestId", "title"],
          properties: {
            description: {
              type: "string",
              minLength: 1,
              maxLength: 10000,
              pattern: "\\S",
            },
            dueAt: { type: "string", format: "date-time" },
            personId: { type: "string", format: "uuid" },
            requestId: { type: "string", format: "uuid" },
            title: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              pattern: "\\S",
            },
          },
          additionalProperties: false,
        },
        TaskChangeInput: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            description: {
              anyOf: [{
                type: "string",
                minLength: 1,
                maxLength: 10000,
                pattern: "\\S",
              }, { type: "null" }],
            },
            dueAt: {
              anyOf: [{ type: "string", format: "date-time" }, {
                type: "null",
              }],
            },
            expectedUpdatedAt: { type: "string", format: "date-time" },
            personId: {
              anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
            },
            status: { enum: ["cancelled", "open"] },
            title: {
              type: "string",
              minLength: 1,
              maxLength: 500,
              pattern: "\\S",
            },
          },
          additionalProperties: false,
        },
        TaskCompletionInput: {
          type: "object",
          required: ["completed"],
          properties: { completed: { type: "boolean" } },
          additionalProperties: false,
        },
        TaskCreated: {
          type: "object",
          required: ["status", "task"],
          properties: {
            status: { const: "created" },
            task: { $ref: "#/components/schemas/Task" },
          },
          additionalProperties: false,
        },
        TaskChanged: {
          type: "object",
          required: ["status", "task"],
          properties: {
            status: { enum: ["saved", "unchanged"] },
            task: { $ref: "#/components/schemas/Task" },
          },
          additionalProperties: false,
        },
        TodayTasks: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/Task" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        TodayAttentionPerson: {
          type: "object",
          required: ["archived", "id", "name"],
          properties: {
            archived: { type: "boolean" },
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            unavailable: { type: "boolean" },
          },
          additionalProperties: false,
        },
        TodayTaskAttentionItem: todayAttentionItem("task", []),
        TodayReminderAttentionItem: todayAttentionItem(
          "reminder",
          ["occursOn", "reminderStatus"],
          {
            occursOn: { type: "string", format: "date" },
            reminderStatus: {
              enum: ["failed", "manual_attention", "pending", "retry"],
            },
          },
        ),
        TodayImportantDateAttentionItem: todayAttentionItem(
          "important-date",
          ["occursOn", "reminderStatus"],
          {
            occursOn: { type: "string", format: "date" },
            reminderStatus: {
              enum: ["failed", "manual_attention", "pending", "retry"],
            },
          },
        ),
        TodayLifeEventAttentionItem: todayAttentionItem(
          "life-event",
          ["occursOn", "reminderStatus"],
          {
            occursOn: { type: "string", format: "date" },
            reminderStatus: {
              enum: ["failed", "manual_attention", "pending", "retry"],
            },
          },
        ),
        TodayCadenceAttentionItem: todayAttentionItem(
          "cadence",
          ["person"],
          {
            lastContactedAt: { type: "string", format: "date-time" },
          },
        ),
        TodayAttentionItem: {
          oneOf: [
            { $ref: "#/components/schemas/TodayTaskAttentionItem" },
            { $ref: "#/components/schemas/TodayReminderAttentionItem" },
            { $ref: "#/components/schemas/TodayImportantDateAttentionItem" },
            { $ref: "#/components/schemas/TodayLifeEventAttentionItem" },
            { $ref: "#/components/schemas/TodayCadenceAttentionItem" },
          ],
        },
        TodayAttentionGroup: {
          type: "object",
          required: ["nextSevenDays", "overdue", "today"],
          properties: Object.fromEntries(
            ["nextSevenDays", "overdue", "today"].map((name) => [name, {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/TodayAttentionItem" },
            }]),
          ),
          additionalProperties: false,
        },
        TodayAttention: {
          type: "object",
          required: ["attention", "date", "status", "timezone", "upcoming"],
          properties: {
            attention: { $ref: "#/components/schemas/TodayAttentionGroup" },
            date: { type: "string", format: "date" },
            status: { const: "ready" },
            timezone: { type: "string", minLength: 1 },
            upcoming: {
              type: "array",
              maxItems: 30,
              items: { $ref: "#/components/schemas/TodayAttentionItem" },
            },
          },
          additionalProperties: false,
        },
        PersonViewRecorded: {
          type: "object",
          required: ["status"],
          properties: { status: { const: "recorded" } },
          additionalProperties: false,
        },
        TodayRecentPerson: {
          type: "object",
          required: ["archived", "id", "name"],
          properties: {
            archived: { type: "boolean" },
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        TodayRecentPeople: {
          type: "object",
          required: ["people", "status"],
          properties: {
            people: {
              type: "array",
              maxItems: 8,
              items: { $ref: "#/components/schemas/TodayRecentPerson" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        ReminderOccurrence: {
          type: "object",
          required: ["attemptCount", "deliverAt", "id", "occursOn", "status"],
          properties: {
            attemptCount: { type: "integer", minimum: 0 },
            deliverAt: { type: "string", format: "date-time" },
            error: { type: "string" },
            id: { type: "string", format: "uuid" },
            occursOn: { type: "string", format: "date" },
            providerEffectAt: { type: "string", format: "date-time" },
            sentAt: { type: "string", format: "date-time" },
            status: {
              enum: [
                "pending",
                "claimed",
                "retry",
                "sent",
                "skipped",
                "failed",
                "cancelled",
                "manual_attention",
              ],
            },
            visibleAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        Reminder: {
          type: "object",
          required: [
            "anchorOn",
            "createdAt",
            "id",
            "isActive",
            "personId",
            "recurrenceInterval",
            "recurrenceUnit",
            "sendTime",
            "title",
            "updatedAt",
          ],
          properties: {
            anchorOn: { type: "string", format: "date" },
            createdAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            isActive: { type: "boolean" },
            nextOccurrence: { $ref: "#/components/schemas/ReminderOccurrence" },
            personId: { type: "string", format: "uuid" },
            recurrenceInterval: { type: "integer", minimum: 1, maximum: 100 },
            recurrenceUnit: { enum: ["none", "day", "week", "month", "year"] },
            sendTime: { type: "string" },
            title: { type: "string" },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        StayInTouchCadence: {
          type: "object",
          required: [
            "id",
            "intervalCount",
            "intervalUnit",
            "isActive",
            "nextDueAt",
            "personId",
            "updatedAt",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            intervalCount: { type: "integer", minimum: 1, maximum: 100 },
            intervalUnit: { enum: ["day", "week", "month", "year"] },
            isActive: { type: "boolean" },
            lastContactedAt: { type: "string", format: "date-time" },
            nextDueAt: { type: "string", format: "date-time" },
            personId: { type: "string", format: "uuid" },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        ReminderCreateInput: {
          type: "object",
          required: [
            "anchorOn",
            "personId",
            "recurrenceInterval",
            "recurrenceUnit",
            "requestId",
            "sendTime",
            "title",
          ],
          properties: {
            anchorOn: { type: "string", format: "date" },
            personId: { type: "string", format: "uuid" },
            recurrenceInterval: { type: "integer", minimum: 1, maximum: 100 },
            recurrenceUnit: { enum: ["none", "day", "week", "month", "year"] },
            requestId: { type: "string", format: "uuid" },
            sendTime: {
              type: "string",
              pattern: "^([01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$",
            },
            title: { type: "string", minLength: 1, maxLength: 500 },
          },
          additionalProperties: false,
        },
        CadenceCreateInput: {
          type: "object",
          required: ["intervalCount", "intervalUnit", "personId", "requestId"],
          properties: {
            intervalCount: { type: "integer", minimum: 1, maximum: 100 },
            intervalUnit: { enum: ["day", "week", "month", "year"] },
            personId: { type: "string", format: "uuid" },
            requestId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        ReminderCreated: {
          type: "object",
          required: ["reminder", "status"],
          properties: {
            reminder: { $ref: "#/components/schemas/Reminder" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        ReminderSaved: {
          type: "object",
          required: ["reminder", "status"],
          properties: {
            reminder: { $ref: "#/components/schemas/Reminder" },
            status: { const: "saved" },
          },
          additionalProperties: false,
        },
        CadenceCreated: {
          type: "object",
          required: ["cadence", "status"],
          properties: {
            cadence: { $ref: "#/components/schemas/StayInTouchCadence" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        PersonReminders: {
          type: "object",
          required: ["cadences", "reminders", "status"],
          properties: {
            cadences: {
              type: "array",
              maxItems: 1,
              items: { $ref: "#/components/schemas/StayInTouchCadence" },
            },
            reminders: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/Reminder" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        TodayReminderPerson: {
          type: "object",
          required: ["archived", "id", "name"],
          properties: {
            archived: { type: "boolean" },
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        TodayReminderItem: {
          type: "object",
          required: [
            "attemptCount",
            "deliverAt",
            "id",
            "person",
            "status",
            "title",
          ],
          properties: {
            attemptCount: { type: "integer", minimum: 0 },
            deliverAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            nextAttemptAt: { type: "string", format: "date-time" },
            person: { $ref: "#/components/schemas/TodayReminderPerson" },
            status: {
              enum: [
                "pending",
                "claimed",
                "retry",
                "sent",
                "failed",
                "manual_attention",
              ],
            },
            title: { type: "string" },
            visibleAt: { type: "string", format: "date-time" },
          },
          oneOf: [
            {
              required: ["nextAttemptAt"],
              properties: { status: { const: "retry" } },
            },
            {
              not: { required: ["nextAttemptAt"] },
              properties: {
                status: {
                  enum: [
                    "pending",
                    "claimed",
                    "sent",
                    "failed",
                    "manual_attention",
                  ],
                },
              },
            },
          ],
          additionalProperties: false,
        },
        TodayCadenceItem: {
          type: "object",
          required: ["dueAt", "id", "person"],
          properties: {
            dueAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            lastContactedAt: { type: "string", format: "date-time" },
            person: { $ref: "#/components/schemas/TodayReminderPerson" },
          },
          additionalProperties: false,
        },
        TodayReminders: {
          type: "object",
          required: ["cadences", "reminders", "status", "timezone"],
          properties: {
            cadences: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/TodayCadenceItem" },
            },
            reminders: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/TodayReminderItem" },
            },
            status: { const: "ready" },
            timezone: { type: "string" },
          },
          additionalProperties: false,
        },
        TodayFavoriteNotes: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 8,
              items: { $ref: "#/components/schemas/NoteInteraction" },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        TodayRecentActivity: {
          type: "object",
          required: ["items", "status"],
          properties: {
            items: {
              type: "array",
              maxItems: 20,
              items: {
                $ref: "#/components/schemas/ActivityOrNoteInteraction",
              },
            },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        RelationshipType: {
          type: "object",
          required: ["archived", "forwardLabel", "id", "reverseLabel"],
          properties: {
            archived: { type: "boolean" },
            forwardLabel: { type: "string" },
            id: { type: "string", format: "uuid" },
            reverseLabel: { type: "string" },
          },
          additionalProperties: false,
        },
        RelationshipTypeList: {
          type: "object",
          required: ["options", "selected", "status"],
          properties: {
            nextCursor: { type: "string" },
            options: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/RelationshipType" },
            },
            selected: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/RelationshipType" },
            },
            status: { enum: ["hidden", "ready"] },
          },
          additionalProperties: false,
        },
        Relationship: {
          type: "object",
          required: relationshipRequired,
          properties: relationshipProperties,
          additionalProperties: false,
        },
        RelationshipDisplay: {
          type: "object",
          required: ["label", "personId", "relationshipId"],
          properties: {
            label: { type: "string" },
            name: { type: "string" },
            personId: { type: "string", format: "uuid" },
            relationshipId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        RelationshipWithDisplay: {
          type: "object",
          required: [...relationshipRequired, "display"],
          properties: {
            ...relationshipProperties,
            display: { $ref: "#/components/schemas/RelationshipDisplay" },
          },
          additionalProperties: false,
        },
        RelationshipCreateInput: {
          type: "object",
          required: ["relationshipTypeId", "targetPersonId"],
          properties: {
            relationshipTypeId: { type: "string", format: "uuid" },
            targetPersonId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        RelationshipUpdateInput: {
          type: "object",
          required: ["expectedUpdatedAt", "relationshipTypeId"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            relationshipTypeId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        RelationshipList: {
          type: "object",
          required: ["relationships", "status"],
          properties: {
            nextCursor: { type: "string" },
            relationships: {
              type: "array",
              maxItems: 20,
              items: {
                $ref: "#/components/schemas/RelationshipWithDisplay",
              },
            },
            status: { enum: ["archived", "hidden", "ready"] },
          },
          additionalProperties: false,
        },
        RelationshipChanged: {
          type: "object",
          required: [
            "affectedPersonIds",
            "forward",
            "inverse",
            "relationship",
            "status",
          ],
          properties: {
            affectedPersonIds: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "string", format: "uuid" },
            },
            forward: { $ref: "#/components/schemas/RelationshipDisplay" },
            inverse: { $ref: "#/components/schemas/RelationshipDisplay" },
            relationship: { $ref: "#/components/schemas/Relationship" },
            status: { enum: ["created", "existing", "updated"] },
          },
          additionalProperties: false,
        },
        RelatedPersonRelationshipInput: {
          type: "object",
          required: ["person", "relationshipTypeId"],
          properties: {
            person: { $ref: "#/components/schemas/PersonInput" },
            relationshipTypeId: { type: "string", format: "uuid" },
          },
          additionalProperties: false,
        },
        RelatedPersonRelationshipChanged: {
          type: "object",
          required: [
            "affectedPersonIds",
            "forward",
            "inverse",
            "person",
            "relationship",
            "status",
          ],
          properties: {
            affectedPersonIds: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "string", format: "uuid" },
            },
            forward: { $ref: "#/components/schemas/RelationshipDisplay" },
            inverse: { $ref: "#/components/schemas/RelationshipDisplay" },
            person: { $ref: "#/components/schemas/PersonIdentity" },
            relationship: { $ref: "#/components/schemas/Relationship" },
            status: { const: "created" },
          },
          additionalProperties: false,
        },
        RelationshipDeleted: {
          type: "object",
          required: ["affectedPersonIds", "relationshipId", "status"],
          properties: {
            affectedPersonIds: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "string", format: "uuid" },
            },
            relationshipId: { type: "string", format: "uuid" },
            status: { const: "deleted" },
          },
          additionalProperties: false,
        },
        PersonLifeEventDate: {
          type: "object",
          required: ["precision"],
          properties: {
            day: { type: "integer", minimum: 1, maximum: 31 },
            happenedAt: { type: "string", format: "date-time" },
            month: { type: "integer", minimum: 1, maximum: 12 },
            precision: {
              type: "string",
              enum: [
                "day",
                "full",
                "month",
                "month_day",
                "unknown",
                "year",
                "year_month",
              ],
            },
            year: { type: "integer", minimum: 1, maximum: 9_999 },
          },
          additionalProperties: false,
        },
        PersonLifeEvent: {
          type: "object",
          required: ["date", "id"],
          properties: {
            date: { $ref: "#/components/schemas/PersonLifeEventDate" },
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
            note: { type: "string" },
            typeName: { type: "string" },
          },
          additionalProperties: false,
        },
        PersonLifeEventsReady: {
          type: "object",
          required: ["events", "status"],
          properties: {
            events: {
              type: "array",
              maxItems: 100,
              items: { $ref: "#/components/schemas/PersonLifeEvent" },
            },
            status: { type: "string", enum: ["hidden", "ready"] },
          },
          additionalProperties: false,
        },
        PersonDueInformation: {
          type: "object",
          required: ["status", "detail", "openTaskCount"],
          properties: {
            status: { const: "ready" },
            detail: { type: "string" },
            nextReminderAt: { type: "string", format: "date-time" },
            openTaskCount: { type: "integer", minimum: 0 },
            stayInTouchAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        ImportantDateInput: {
          type: "object",
          required: importantDateRequired,
          properties: importantDateProperties,
          additionalProperties: false,
        },
        ImportantDateUpdateInput: {
          type: "object",
          required: [...importantDateRequired, "expectedUpdatedAt"],
          properties: {
            ...importantDateProperties,
            expectedUpdatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        ImportantDate: {
          type: "object",
          required: [
            ...importantDateRequired,
            "createdAt",
            "id",
            "personId",
            "scheduling",
            "updatedAt",
          ],
          properties: {
            ...importantDateProperties,
            createdAt: { type: "string", format: "date-time" },
            id: { type: "string", format: "uuid" },
            personId: { type: "string", format: "uuid" },
            scheduling: {
              type: "string",
              enum: ["annual-reminder", "not-schedulable"],
            },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        ImportantDateList: {
          type: "object",
          required: ["dates", "status"],
          properties: {
            dates: {
              type: "array",
              items: { $ref: "#/components/schemas/ImportantDate" },
            },
            status: { type: "string", enum: ["ready", "archived"] },
          },
          additionalProperties: false,
        },
        ImportantDateChanged: {
          type: "object",
          required: ["date", "status"],
          properties: {
            date: { $ref: "#/components/schemas/ImportantDate" },
            status: { type: "string", enum: ["created", "updated"] },
          },
          additionalProperties: false,
        },
        ImportantDateDeleted: {
          type: "object",
          required: ["dateId", "status"],
          properties: {
            dateId: { type: "string", format: "uuid" },
            status: { const: "deleted" },
          },
          additionalProperties: false,
        },
        PersonProfileSectionId: {
          type: "string",
          enum: [
            "activities",
            "addresses",
            "calls",
            "contact-methods",
            "conversations",
            "first-meeting",
            "food-preferences",
            "life-events",
            "notes",
            "pets",
            "relationships",
            "tasks",
            "tags",
            "work",
          ],
        },
        ProfileFactSectionId: {
          type: "string",
          enum: [
            "addresses",
            "contact-methods",
            "first-meeting",
            "food-preferences",
            "pets",
            "tags",
            "work",
          ],
        },
        ProfileFactOption: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            kind: {
              type: "string",
              enum: [
                "contact-label",
                "contact-type",
                "organization",
                "pet-category",
              ],
            },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        ProfileFactValue: {
          discriminator: { propertyName: "section" },
          oneOf: [
            "AddressFact",
            "ContactMethodFact",
            "FirstMeetingFact",
            "FoodPreferencesFact",
            "PetFact",
            "TagsFact",
            "OccupationFact",
          ].map((name) => ({ $ref: `#/components/schemas/${name}` })),
        },
        AddressFact: closedSchema(
          "addresses",
          ["isPrimary", "labelIds"],
          [
            "city",
            "country",
            "displayName",
            "isPrimary",
            "labelIds",
            "postalCode",
            "region",
            "street",
          ],
          profileFactProperties,
        ),
        ContactMethodFact: closedSchema(
          "contact-methods",
          ["isPrimary", "labelIds", "typeId", "value"],
          ["isPrimary", "labelIds", "notes", "typeId", "value"],
          profileFactProperties,
        ),
        FirstMeetingFact: closedSchema(
          "first-meeting",
          [],
          ["introducedByPersonId", "notes", "placeText"],
          profileFactProperties,
        ),
        FoodPreferencesFact: closedSchema(
          "food-preferences",
          [],
          ["foodPreferences"],
          profileFactProperties,
        ),
        PetFact: closedSchema(
          "pets",
          [],
          ["categoryId", "name", "notes"],
          profileFactProperties,
        ),
        TagsFact: closedSchema(
          "tags",
          ["tagIds"],
          ["tagIds"],
          profileFactProperties,
        ),
        OccupationFact: closedSchema(
          "work",
          ["isCurrent", "title"],
          [
            "description",
            "endOn",
            "isCurrent",
            "organizationId",
            "organizationName",
            "startOn",
            "title",
          ],
          profileFactProperties,
        ),
        ProfileFactCreateInput: {
          discriminator: { propertyName: "section" },
          oneOf: [
            "AddressFactCreateInput",
            "ContactMethodFactCreateInput",
            "FirstMeetingFactCreateInput",
            "FoodPreferencesFactCreateInput",
            "PetFactCreateInput",
            "TagsFactCreateInput",
            "OccupationFactCreateInput",
          ].map((name) => ({ $ref: `#/components/schemas/${name}` })),
        },
        AddressFactCreateInput: {
          ...profileFactInputSchema("addresses", ["isPrimary", "labelIds"], [
            "city",
            "country",
            "displayName",
            "isPrimary",
            "labelIds",
            "postalCode",
            "region",
            "street",
          ], profileFactProperties),
          anyOf: [
            "city",
            "country",
            "displayName",
            "postalCode",
            "region",
            "street",
          ]
            .map(requiredNonBlankProfileFactDetail),
        },
        ContactMethodFactCreateInput: profileFactInputSchema(
          "contact-methods",
          ["isPrimary", "labelIds", "typeId", "value"],
          ["isPrimary", "labelIds", "notes", "typeId", "value"],
          profileFactProperties,
        ),
        FirstMeetingFactCreateInput: {
          ...profileFactInputSchema("first-meeting", [], [
            "introducedByPersonId",
            "notes",
            "placeText",
          ], profileFactProperties),
          anyOf: [
            { required: ["introducedByPersonId"] },
            requiredNonBlankProfileFactDetail("notes"),
            requiredNonBlankProfileFactDetail("placeText"),
          ],
        },
        FoodPreferencesFactCreateInput: profileFactInputSchema(
          "food-preferences",
          [
            "foodPreferences",
          ],
          [
            "foodPreferences",
          ],
          profileFactProperties,
        ),
        PetFactCreateInput: {
          ...profileFactInputSchema("pets", [], [
            "categoryId",
            "name",
            "notes",
          ], profileFactProperties),
          anyOf: [
            { required: ["categoryId"] },
            requiredNonBlankProfileFactDetail("name"),
          ],
        },
        TagsFactCreateInput: profileFactInputSchema(
          "tags",
          ["tagIds"],
          ["tagIds"],
          profileFactProperties,
        ),
        OccupationFactCreateInput: profileFactInputSchema("work", [
          "isCurrent",
          "title",
        ], [
          "description",
          "endOn",
          "isCurrent",
          "organizationId",
          "organizationName",
          "startOn",
          "title",
        ], profileFactProperties),
        ProfileFactUpdateInput: {
          discriminator: { propertyName: "section" },
          oneOf: [
            "AddressFactUpdateInput",
            "ContactMethodFactUpdateInput",
            "FirstMeetingFactUpdateInput",
            "FoodPreferencesFactUpdateInput",
            "PetFactUpdateInput",
            "TagsFactUpdateInput",
            "OccupationFactUpdateInput",
          ].map((name) => ({ $ref: `#/components/schemas/${name}` })),
        },
        AddressFactUpdateInput: {
          ...profileFactInputSchema(
            "addresses",
            ["isPrimary", "labelIds"],
            [
              "city",
              "country",
              "displayName",
              "isPrimary",
              "labelIds",
              "postalCode",
              "region",
              "street",
            ],
            profileFactProperties,
            true,
          ),
          anyOf: [
            "city",
            "country",
            "displayName",
            "postalCode",
            "region",
            "street",
          ].map(requiredNonBlankProfileFactDetail),
        },
        ContactMethodFactUpdateInput: profileFactInputSchema(
          "contact-methods",
          ["isPrimary", "labelIds", "typeId", "value"],
          ["isPrimary", "labelIds", "notes", "typeId", "value"],
          profileFactProperties,
          true,
        ),
        FirstMeetingFactUpdateInput: {
          ...profileFactInputSchema(
            "first-meeting",
            [],
            [
              "introducedByPersonId",
              "notes",
              "placeText",
            ],
            profileFactProperties,
            true,
          ),
          anyOf: [
            { required: ["introducedByPersonId"] },
            requiredNonBlankProfileFactDetail("notes"),
            requiredNonBlankProfileFactDetail("placeText"),
          ],
        },
        FoodPreferencesFactUpdateInput: profileFactInputSchema(
          "food-preferences",
          ["foodPreferences"],
          ["foodPreferences"],
          profileFactProperties,
          true,
        ),
        PetFactUpdateInput: {
          ...profileFactInputSchema(
            "pets",
            [],
            [
              "categoryId",
              "name",
              "notes",
            ],
            profileFactProperties,
            true,
          ),
          anyOf: [
            { required: ["categoryId"] },
            requiredNonBlankProfileFactDetail("name"),
          ],
        },
        TagsFactUpdateInput: profileFactInputSchema(
          "tags",
          ["tagIds"],
          ["tagIds"],
          profileFactProperties,
          true,
        ),
        OccupationFactUpdateInput: profileFactInputSchema(
          "work",
          ["isCurrent", "title"],
          [
            "description",
            "endOn",
            "isCurrent",
            "organizationId",
            "organizationName",
            "startOn",
            "title",
          ],
          profileFactProperties,
          true,
        ),
        ProfileFactDeleteInput: {
          type: "object",
          required: ["expectedPersonUpdatedAt", "expectedUpdatedAt", "section"],
          properties: {
            expectedPersonUpdatedAt: { type: "string", format: "date-time" },
            expectedUpdatedAt: { type: "string", format: "date-time" },
            section: { $ref: "#/components/schemas/ProfileFactSectionId" },
          },
          additionalProperties: false,
        },
        ProfileFactRecord: {
          type: "object",
          required: ["id", "section", "updatedAt", "value"],
          properties: {
            id: { type: "string", format: "uuid" },
            referencesResolved: { type: "boolean" },
            section: { $ref: "#/components/schemas/ProfileFactSectionId" },
            selectedOptions: {
              type: "array",
              items: { $ref: "#/components/schemas/ProfileFactOption" },
            },
            updatedAt: { type: "string", format: "date-time" },
            value: { $ref: "#/components/schemas/ProfileFactValue" },
          },
          additionalProperties: false,
        },
        ProfileFactSection: {
          type: "object",
          required: ["status", "options", "personUpdatedAt", "records"],
          properties: {
            nextCursor: { type: "string" },
            nextOptionsCursor: { type: "string" },
            status: { type: "string", enum: ["ready", "archived", "hidden"] },
            options: {
              type: "array",
              items: { $ref: "#/components/schemas/ProfileFactOption" },
            },
            personUpdatedAt: { type: "string", format: "date-time" },
            records: {
              type: "array",
              items: { $ref: "#/components/schemas/ProfileFactRecord" },
            },
          },
          additionalProperties: false,
        },
        ProfileFactChanged: {
          type: "object",
          required: ["status", "personUpdatedAt", "record"],
          properties: {
            status: { const: "saved" },
            personUpdatedAt: { type: "string", format: "date-time" },
            record: { $ref: "#/components/schemas/ProfileFactRecord" },
          },
          additionalProperties: false,
        },
        ProfileFactDeleted: {
          type: "object",
          required: ["status", "factId", "personUpdatedAt"],
          properties: {
            status: { const: "deleted" },
            factId: { type: "string", format: "uuid" },
            personUpdatedAt: { type: "string", format: "date-time" },
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
            selected: { $ref: "#/components/schemas/PeopleDirectoryPerson" },
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
        BlockingWorkspace: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string", format: "uuid" },
            name: { type: "string" },
          },
          additionalProperties: false,
        },
        PersonalLifecycleConfirmation: {
          type: "object",
          required: ["confirmation", "password"],
          properties: {
            confirmation: { type: "string", minLength: 1, maxLength: 300 },
            password: { type: "string", minLength: 1, maxLength: 1024 },
          },
          additionalProperties: false,
        },
        PersonalIdentityDeletionInput: {
          type: "object",
          required: ["confirmation", "password"],
          properties: {
            confirmation: { type: "string", minLength: 1, maxLength: 300 },
            password: { type: "string", minLength: 1, maxLength: 1024 },
          },
          additionalProperties: false,
        },
        PersonalLifecyclePreview: {
          type: "object",
          required: [
            "activeSessionCount",
            "blockingWorkspaces",
            "confirmations",
            "memberships",
            "retainedLegalRecords",
            "status",
          ],
          properties: {
            activeSessionCount: { type: "integer", minimum: 0 },
            blockingWorkspaces: {
              type: "array",
              items: { $ref: "#/components/schemas/BlockingWorkspace" },
            },
            confirmations: {
              type: "object",
              required: ["deleteIdentity", "leaveWorkspace"],
              properties: {
                deleteIdentity: { type: "string" },
                leaveWorkspace: { type: "string" },
              },
              additionalProperties: false,
            },
            memberships: {
              type: "array",
              items: {
                type: "object",
                required: ["finalOwner", "id", "role", "status", "workspace"],
                properties: {
                  finalOwner: { type: "boolean" },
                  id: { type: "string", format: "uuid" },
                  role: { type: "string", enum: ["owner", "admin", "member"] },
                  status: { type: "string", enum: ["active", "suspended"] },
                  workspace: { $ref: "#/components/schemas/BlockingWorkspace" },
                },
                additionalProperties: false,
              },
            },
            retainedLegalRecords: { const: true },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        WorkspaceLeft: {
          type: "object",
          required: ["next", "status"],
          properties: {
            next: { type: "string", enum: ["/app", "/auth/sign-in"] },
            nextWorkspaceId: { type: "string", format: "uuid" },
            status: { const: "left" },
          },
          additionalProperties: false,
        },
        PersonalIdentityDeleted: {
          type: "object",
          required: ["next", "status"],
          properties: {
            next: { const: "/auth/sign-in" },
            status: { const: "deleted" },
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
        ImportReport: {
          type: "object",
          required: ["counts", "diagnostics"],
          properties: {
            counts: {
              type: "object",
              required: [
                "contacts",
                "legacyCredentialsDiscarded",
                "missingFiles",
                "orphans",
                "unsupported",
              ],
              properties: {
                contacts: { type: "integer", minimum: 0 },
                legacyCredentialsDiscarded: { type: "integer", minimum: 0 },
                missingFiles: { type: "integer", minimum: 0 },
                orphans: { type: "integer", minimum: 0 },
                unsupported: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
            diagnostics: {
              type: "array",
              items: {
                type: "object",
                required: ["code", "message", "severity"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  severity: { enum: ["info", "skipped", "warning"] },
                },
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
        ImportDryRun: {
          type: "object",
          required: ["importId", "report", "status"],
          properties: {
            importId: { type: "string", format: "uuid" },
            report: { $ref: "#/components/schemas/ImportReport" },
            status: { const: "dry_run" },
          },
          additionalProperties: false,
        },
        ImportSummary: {
          type: "object",
          required: [
            "createdAt",
            "importId",
            "report",
            "sourceProfile",
            "status",
          ],
          properties: {
            completedAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            importId: { type: "string", format: "uuid" },
            report: { $ref: "#/components/schemas/ImportReport" },
            sourceProfile: { const: "json_export" },
            status: { enum: ["completed", "dry_run", "failed"] },
          },
          additionalProperties: false,
        },
        ExportManifest: {
          type: "object",
          required: [
            "attachments",
            "limitations",
            "profile",
            "rows",
            "version",
          ],
          properties: {
            attachments: {
              type: "object",
              required: ["count", "items", "sha256"],
              properties: {
                count: { type: "integer", minimum: 0 },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["byteSize", "filename", "sha256"],
                    properties: {
                      byteSize: { type: "integer", minimum: 0 },
                      filename: { type: "string" },
                      sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                    },
                    additionalProperties: false,
                  },
                },
                sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
              },
              additionalProperties: false,
            },
            limitations: { type: "array", items: { type: "string" } },
            profile: { const: "monica-json" },
            rows: {
              type: "object",
              required: ["people"],
              properties: {
                people: {
                  type: "object",
                  required: ["count", "sha256"],
                  properties: {
                    count: { type: "integer", minimum: 0 },
                    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
                  },
                  additionalProperties: false,
                },
              },
              additionalProperties: false,
            },
            version: { const: 1 },
          },
          additionalProperties: false,
        },
        ExportSummary: {
          type: "object",
          required: ["createdAt", "exportId", "format", "manifest", "status"],
          properties: {
            completedAt: { type: "string", format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            error: { type: "string" },
            expiresAt: { type: "string", format: "date-time" },
            exportId: { type: "string", format: "uuid" },
            format: { const: "json" },
            manifest: { $ref: "#/components/schemas/ExportManifest" },
            status: {
              enum: [
                "cancelled",
                "completed",
                "expired",
                "failed",
                "pending",
                "running",
              ],
            },
          },
          additionalProperties: false,
        },
        ExportDownload: {
          type: "object",
          required: ["expiresAt", "href", "status"],
          properties: {
            expiresAt: { type: "string", format: "date-time" },
            href: { type: "string" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        StorageFileLookupItem: {
          type: "object",
          required: [
            "byteSize",
            "createdAt",
            "fileId",
            "filename",
            "kind",
            "mimeType",
            "status",
            "title",
          ],
          properties: {
            byteSize: { type: "integer", minimum: 0 },
            createdAt: { type: "string", format: "date-time" },
            fileId: { type: "string", format: "uuid" },
            filename: { type: "string" },
            kind: { type: "string" },
            mimeType: { type: "string" },
            personId: { type: "string", format: "uuid" },
            personName: { type: "string" },
            status: {
              type: "string",
              enum: ["available", "missing", "processing", "quarantined"],
            },
            title: { type: "string" },
          },
          additionalProperties: false,
        },
        StorageSettings: {
          type: "object",
          required: [
            "files",
            "maximumUploadBytes",
            "provider",
            "status",
            "usage",
          ],
          properties: {
            files: {
              type: "array",
              maxItems: 20,
              items: { $ref: "#/components/schemas/StorageFileLookupItem" },
            },
            maximumUploadBytes: { type: "integer", minimum: 1 },
            provider: {
              type: "object",
              required: ["bucket", "health", "name"],
              properties: {
                bucket: { type: "string" },
                health: {
                  type: "string",
                  enum: ["available", "not-initialized", "unavailable"],
                },
                name: { type: "string" },
              },
              additionalProperties: false,
            },
            status: { const: "ready" },
            usage: {
              type: "object",
              required: [
                "available",
                "missing",
                "processing",
                "quarantined",
                "totalBytes",
                "totalFiles",
              ],
              properties: {
                available: { type: "integer", minimum: 0 },
                missing: { type: "integer", minimum: 0 },
                processing: { type: "integer", minimum: 0 },
                quarantined: { type: "integer", minimum: 0 },
                totalBytes: { type: "integer", minimum: 0 },
                totalFiles: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        PersonalizationSection: {
          type: "string",
          enum: [
            "profile-modules",
            "gender-options",
            "contact-method-types",
            "contact-labels",
            "activity-types",
            "emotion-options",
            "life-event-types",
            "relationship-types",
            "pet-categories",
            "reminder-rules",
            "tags",
          ],
        },
        PersonalizationEntry: {
          type: "object",
          required: [
            "capabilities",
            "canDelete",
            "id",
            "isActive",
            "isDefault",
            "kind",
            "name",
            "readOnly",
            "referenceCount",
            "sortOrder",
            "updatedAt",
          ],
          properties: {
            capabilities: {
              type: "object",
              required: [
                "delete",
                "disable",
                "editValue",
                "rename",
                "reorder",
                "replace",
                "setDefault",
              ],
              properties: {
                delete: { type: "boolean" },
                disable: { type: "boolean" },
                editValue: { type: "boolean" },
                rename: { type: "boolean" },
                reorder: { type: "boolean" },
                replace: { type: "boolean" },
                setDefault: { type: "boolean" },
              },
              additionalProperties: false,
            },
            canDelete: { type: "boolean" },
            daysBefore: { type: "integer", minimum: 0, maximum: 3650 },
            forwardLabel: { type: "string" },
            id: { type: "string", format: "uuid" },
            isActive: { type: "boolean" },
            isDefault: { type: "boolean" },
            kind: {
              type: "string",
              enum: ["named", "relationship-type", "reminder-rule"],
            },
            name: { type: "string" },
            readOnly: { type: "boolean" },
            referenceCount: { type: "integer", minimum: 0 },
            reverseLabel: { type: "string" },
            sortOrder: { type: "integer", minimum: 0 },
            updatedAt: { type: "string", format: "date-time" },
          },
          additionalProperties: false,
        },
        PersonalizationList: {
          type: "object",
          required: [
            "capabilities",
            "entries",
            "readOnly",
            "section",
            "status",
          ],
          properties: {
            capabilities: {
              type: "object",
              required: ["create", "editValue"],
              properties: {
                create: { type: "boolean" },
                editValue: { type: "boolean" },
              },
              additionalProperties: false,
            },
            entries: {
              type: "array",
              items: { $ref: "#/components/schemas/PersonalizationEntry" },
            },
            readOnly: { type: "boolean" },
            section: { $ref: "#/components/schemas/PersonalizationSection" },
            status: { const: "ready" },
          },
          additionalProperties: false,
        },
        PersonalizationNamedCreate: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
          },
          additionalProperties: false,
        },
        PersonalizationNameOnlyCreate: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
          },
          additionalProperties: false,
        },
        PersonalizationRelationshipCreate: {
          type: "object",
          required: ["forwardLabel", "reverseLabel"],
          properties: {
            forwardLabel: { type: "string", minLength: 1, maxLength: 200 },
            reverseLabel: { type: "string", minLength: 1, maxLength: 200 },
            sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
          },
          additionalProperties: false,
        },
        PersonalizationReminderCreate: {
          type: "object",
          required: ["daysBefore"],
          properties: {
            daysBefore: { type: "integer", minimum: 0, maximum: 3650 },
          },
          additionalProperties: false,
        },
        PersonalizationCreate: {
          anyOf: [
            { $ref: "#/components/schemas/PersonalizationNamedCreate" },
            { $ref: "#/components/schemas/PersonalizationNameOnlyCreate" },
            {
              $ref: "#/components/schemas/PersonalizationRelationshipCreate",
            },
            { $ref: "#/components/schemas/PersonalizationReminderCreate" },
          ],
          "x-sectionSchemas": {
            "profile-modules":
              "#/components/schemas/PersonalizationNamedCreate",
            "gender-options": "#/components/schemas/PersonalizationNamedCreate",
            "contact-method-types":
              "#/components/schemas/PersonalizationNamedCreate",
            "contact-labels":
              "#/components/schemas/PersonalizationNameOnlyCreate",
            "activity-types": "#/components/schemas/PersonalizationNamedCreate",
            "emotion-options": null,
            "life-event-types":
              "#/components/schemas/PersonalizationNamedCreate",
            "relationship-types":
              "#/components/schemas/PersonalizationRelationshipCreate",
            "pet-categories": null,
            "reminder-rules":
              "#/components/schemas/PersonalizationReminderCreate",
            tags: "#/components/schemas/PersonalizationNameOnlyCreate",
          },
        },
        PersonalizationNamedUpdate: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            isActive: { type: "boolean" },
            name: { type: "string", minLength: 1, maxLength: 200 },
            sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
          },
          anyOf: [
            { required: ["isActive"] },
            { required: ["name"] },
            { required: ["sortOrder"] },
          ],
          additionalProperties: false,
        },
        PersonalizationGenderUpdate: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            isActive: { type: "boolean" },
            isDefault: { type: "boolean", const: true },
            name: { type: "string", minLength: 1, maxLength: 200 },
            sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
          },
          anyOf: [
            { required: ["isActive"] },
            { required: ["isDefault"] },
            { required: ["name"] },
            { required: ["sortOrder"] },
          ],
          additionalProperties: false,
        },
        PersonalizationNameOnlyUpdate: {
          type: "object",
          required: ["expectedUpdatedAt", "name"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            name: { type: "string", minLength: 1, maxLength: 200 },
          },
          additionalProperties: false,
        },
        PersonalizationRelationshipUpdate: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            forwardLabel: { type: "string", minLength: 1, maxLength: 200 },
            isActive: { type: "boolean" },
            reverseLabel: { type: "string", minLength: 1, maxLength: 200 },
            sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
          },
          dependentRequired: {
            forwardLabel: ["reverseLabel"],
            reverseLabel: ["forwardLabel"],
          },
          anyOf: [
            { required: ["forwardLabel", "reverseLabel"] },
            { required: ["isActive"] },
            { required: ["sortOrder"] },
          ],
          additionalProperties: false,
        },
        PersonalizationReminderUpdate: {
          type: "object",
          required: ["expectedUpdatedAt"],
          properties: {
            expectedUpdatedAt: { type: "string", format: "date-time" },
            daysBefore: { type: "integer", minimum: 0, maximum: 3650 },
            isActive: { type: "boolean" },
          },
          anyOf: [
            { required: ["daysBefore"] },
            { required: ["isActive"] },
          ],
          additionalProperties: false,
        },
        PersonalizationUpdate: {
          anyOf: [
            { $ref: "#/components/schemas/PersonalizationNamedUpdate" },
            { $ref: "#/components/schemas/PersonalizationGenderUpdate" },
            { $ref: "#/components/schemas/PersonalizationNameOnlyUpdate" },
            {
              $ref: "#/components/schemas/PersonalizationRelationshipUpdate",
            },
            { $ref: "#/components/schemas/PersonalizationReminderUpdate" },
          ],
          "x-sectionSchemas": {
            "profile-modules":
              "#/components/schemas/PersonalizationNamedUpdate",
            "gender-options":
              "#/components/schemas/PersonalizationGenderUpdate",
            "contact-method-types":
              "#/components/schemas/PersonalizationNamedUpdate",
            "contact-labels":
              "#/components/schemas/PersonalizationNameOnlyUpdate",
            "activity-types": "#/components/schemas/PersonalizationNamedUpdate",
            "emotion-options": null,
            "life-event-types":
              "#/components/schemas/PersonalizationNamedUpdate",
            "relationship-types":
              "#/components/schemas/PersonalizationRelationshipUpdate",
            "pet-categories": null,
            "reminder-rules":
              "#/components/schemas/PersonalizationReminderUpdate",
            tags: "#/components/schemas/PersonalizationNameOnlyUpdate",
          },
        },
        PersonalizationSaved: {
          type: "object",
          required: ["entry", "status"],
          properties: {
            entry: { $ref: "#/components/schemas/PersonalizationEntry" },
            status: { const: "saved" },
          },
          additionalProperties: false,
        },
        PersonalizationDeleted: {
          type: "object",
          required: ["id", "status"],
          properties: {
            id: { type: "string", format: "uuid" },
            status: { const: "deleted" },
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
            blockingWorkspaces: {
              type: "array",
              items: { $ref: "#/components/schemas/BlockingWorkspace" },
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
  return renderGeneratedClientBase()
    .replace(
      'verifyEmail(token: string): Promise<ApiResult<{ readonly status: "verified"; readonly next: "/app" }>>',
      'verifyEmail(token: string): Promise<ApiResult<{ readonly status: "verified"; readonly next: "/app" | "/invite/continue" }>>',
    )
    .replace(
      "async function request<T>(path: string, init?: RequestInit)",
      'type RequestOptions = Omit<RequestInit, "headers"> & { readonly headers?: HeadersInit | undefined };\n\nasync function request<T>(path: string, init?: RequestOptions)',
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

export interface BlockingWorkspace {
  readonly id: string;
  readonly name: string;
}

export interface PersonalLifecyclePreview {
  readonly activeSessionCount: number;
  readonly blockingWorkspaces: readonly BlockingWorkspace[];
  readonly confirmations: {
    readonly deleteIdentity: string;
    readonly leaveWorkspace: string;
  };
  readonly memberships: readonly {
    readonly finalOwner: boolean;
    readonly id: string;
    readonly role: "owner" | "admin" | "member";
    readonly status: "active" | "suspended";
    readonly workspace: BlockingWorkspace;
  }[];
  readonly retainedLegalRecords: true;
  readonly status: "ready";
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

export interface ImportReport {
  readonly counts: { readonly contacts: number; readonly legacyCredentialsDiscarded: number; readonly missingFiles: number; readonly orphans: number; readonly unsupported: number };
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly severity: "info" | "skipped" | "warning" }[];
}

export interface ImportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly sourceProfile: "json_export";
  readonly status: "completed" | "dry_run" | "failed";
}

export interface ExportManifest {
  readonly attachments: { readonly count: number; readonly items: readonly { readonly byteSize: number; readonly filename: string; readonly sha256: string }[]; readonly sha256: string };
  readonly limitations: readonly string[];
  readonly profile: "monica-json";
  readonly rows: { readonly people: { readonly count: number; readonly sha256: string } };
  readonly version: 1;
}

export interface ExportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly error?: string;
  readonly expiresAt?: string;
  readonly exportId: string;
  readonly format: "json";
  readonly manifest: ExportManifest;
  readonly status: "cancelled" | "completed" | "expired" | "failed" | "pending" | "running";
}

export interface StorageFileLookupItem {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly personId?: string;
  readonly personName?: string;
  readonly status: "available" | "missing" | "processing" | "quarantined";
  readonly title: string;
}

export interface StorageSettings {
  readonly files: readonly StorageFileLookupItem[];
  readonly maximumUploadBytes: number;
  readonly provider: {
    readonly bucket: string;
    readonly health: "available" | "not-initialized" | "unavailable";
    readonly name: string;
  };
  readonly status: "ready";
  readonly usage: {
    readonly available: number;
    readonly missing: number;
    readonly processing: number;
    readonly quarantined: number;
    readonly totalBytes: number;
    readonly totalFiles: number;
  };
}

export interface ManagedMember {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: "owner" | "admin" | "member";
  readonly status: "active" | "suspended";
}

export type PersonalizationSection = "profile-modules" | "gender-options" | "contact-method-types" | "contact-labels" | "activity-types" | "emotion-options" | "life-event-types" | "relationship-types" | "pet-categories" | "reminder-rules" | "tags";

type PersonalizationAtLeastOne<T, K extends keyof T = keyof T> = K extends keyof T ? Required<Pick<T, K>> & Partial<Omit<T, K>> : never;

export interface PersonalizationNamedCreateInput {
  readonly name: string;
  readonly sortOrder?: number;
}

export interface PersonalizationNameOnlyCreateInput {
  readonly name: string;
}

export interface PersonalizationRelationshipCreateInput {
  readonly forwardLabel: string;
  readonly reverseLabel: string;
  readonly sortOrder?: number;
}

export interface PersonalizationReminderCreateInput {
  readonly daysBefore: number;
}

export type PersonalizationNamedUpdateInput = { readonly expectedUpdatedAt: string } & PersonalizationAtLeastOne<{
  readonly isActive: boolean;
  readonly name: string;
  readonly sortOrder: number;
}>;

export type PersonalizationGenderUpdateInput = { readonly expectedUpdatedAt: string } & PersonalizationAtLeastOne<{
  readonly isActive: boolean;
  readonly isDefault: true;
  readonly name: string;
  readonly sortOrder: number;
}>;

export interface PersonalizationNameOnlyUpdateInput {
  readonly expectedUpdatedAt: string;
  readonly name: string;
}

export type PersonalizationRelationshipUpdateInput = { readonly expectedUpdatedAt: string } & (
  | {
    readonly forwardLabel: string;
    readonly isActive?: boolean;
    readonly reverseLabel: string;
    readonly sortOrder?: number;
  }
  | ({ readonly forwardLabel?: never; readonly reverseLabel?: never } & PersonalizationAtLeastOne<{
    readonly isActive: boolean;
    readonly sortOrder: number;
  }>)
);

export type PersonalizationReminderUpdateInput = { readonly expectedUpdatedAt: string } & PersonalizationAtLeastOne<{
  readonly daysBefore: number;
  readonly isActive: boolean;
}>;

export interface PersonalizationCreateInputBySection {
  readonly "profile-modules": PersonalizationNamedCreateInput;
  readonly "gender-options": PersonalizationNamedCreateInput;
  readonly "contact-method-types": PersonalizationNamedCreateInput;
  readonly "contact-labels": PersonalizationNameOnlyCreateInput;
  readonly "activity-types": PersonalizationNamedCreateInput;
  readonly "emotion-options": never;
  readonly "life-event-types": PersonalizationNamedCreateInput;
  readonly "relationship-types": PersonalizationRelationshipCreateInput;
  readonly "pet-categories": never;
  readonly "reminder-rules": PersonalizationReminderCreateInput;
  readonly tags: PersonalizationNameOnlyCreateInput;
}

export interface PersonalizationUpdateInputBySection {
  readonly "profile-modules": PersonalizationNamedUpdateInput;
  readonly "gender-options": PersonalizationGenderUpdateInput;
  readonly "contact-method-types": PersonalizationNamedUpdateInput;
  readonly "contact-labels": PersonalizationNameOnlyUpdateInput;
  readonly "activity-types": PersonalizationNamedUpdateInput;
  readonly "emotion-options": never;
  readonly "life-event-types": PersonalizationNamedUpdateInput;
  readonly "relationship-types": PersonalizationRelationshipUpdateInput;
  readonly "pet-categories": never;
  readonly "reminder-rules": PersonalizationReminderUpdateInput;
  readonly tags: PersonalizationNameOnlyUpdateInput;
}

export interface PersonalizationEntry {
  readonly capabilities: { readonly delete: boolean; readonly disable: boolean; readonly editValue: boolean; readonly rename: boolean; readonly reorder: boolean; readonly replace: boolean; readonly setDefault: boolean };
  readonly canDelete: boolean;
  readonly daysBefore?: number;
  readonly forwardLabel?: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly kind: "named" | "relationship-type" | "reminder-rule";
  readonly name: string;
  readonly readOnly: boolean;
  readonly referenceCount: number;
  readonly reverseLabel?: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
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

export function getPersonalLifecyclePreview(workspaceId?: string): Promise<ApiResult<PersonalLifecyclePreview>> {
  return request("/api/v1/settings/personal-lifecycle", { headers: workspaceHeader(workspaceId) });
}

export function leaveCurrentWorkspace(input: { readonly confirmation: string; readonly password: string }, workspaceId?: string): Promise<ApiResult<{ readonly next: "/app" | "/auth/sign-in"; readonly nextWorkspaceId?: string; readonly status: "left" }>> {
  return request("/api/v1/settings/personal-lifecycle/leave", { method: "POST", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function deletePersonalIdentity(input: { readonly confirmation: string; readonly password: string }, workspaceId?: string): Promise<ApiResult<{ readonly next: "/auth/sign-in"; readonly status: "deleted" }>> {
  return request("/api/v1/settings/personal-lifecycle", { method: "DELETE", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
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

export function getStorageSettings(query?: string, workspaceId?: string): Promise<ApiResult<StorageSettings>> {
  const search = query ? \`?query=\${encodeURIComponent(query)}\` : "";
  return request(\`/api/v1/settings/storage\${search}\`, { headers: workspaceHeader(workspaceId) });
}

export function listImports(workspaceId?: string): Promise<ApiResult<{ readonly imports: readonly ImportSummary[] }>> {
  return request("/api/v1/imports", { headers: workspaceHeader(workspaceId) });
}

export function createImportDryRun(source: unknown, workspaceId?: string): Promise<ApiResult<{ readonly importId: string; readonly report: ImportReport; readonly status: "dry_run" }>> {
  return request("/api/v1/imports/dry-runs", { method: "POST", headers: workspaceHeader(workspaceId), body: JSON.stringify({ source }) });
}

export function getImportReport(importId: string, workspaceId?: string): Promise<ApiResult<ImportSummary>> {
  return request(\`/api/v1/imports/\${encodeURIComponent(importId)}\`, { headers: workspaceHeader(workspaceId) });
}

export function commitImport(importId: string, workspaceId?: string): Promise<ApiResult<{ readonly importId: string; readonly peopleCreated: number; readonly peopleReused: number; readonly status: "completed" }>> {
  return request(\`/api/v1/imports/\${encodeURIComponent(importId)}/commit\`, { method: "POST", headers: workspaceHeader(workspaceId), body: JSON.stringify({ confirmed: true }) });
}

export function listExports(workspaceId?: string): Promise<ApiResult<{ readonly exports: readonly ExportSummary[] }>> {
  return request("/api/v1/exports", { headers: workspaceHeader(workspaceId) });
}

export function createWorkspaceExport(workspaceId?: string): Promise<ApiResult<ExportSummary>> {
  return request("/api/v1/exports", { method: "POST", headers: workspaceHeader(workspaceId) });
}

export function createExportDownload(exportId: string, workspaceId?: string): Promise<ApiResult<{ readonly expiresAt: string; readonly href: string; readonly status: "ready" }>> {
  return request(\`/api/v1/exports/\${encodeURIComponent(exportId)}/downloads\`, { method: "POST", headers: workspaceHeader(workspaceId) });
}

export function listPersonalizationEntries(section: PersonalizationSection, workspaceId?: string): Promise<ApiResult<{ readonly capabilities: { readonly create: boolean; readonly editValue: boolean }; readonly entries: readonly PersonalizationEntry[]; readonly readOnly: boolean; readonly section: PersonalizationSection; readonly status: "ready" }>> {
  return request(\`/api/v1/settings/personalization/\${encodeURIComponent(section)}\`, { headers: workspaceHeader(workspaceId) });
}

export function createPersonalizationEntry<S extends PersonalizationSection>(section: S, input: PersonalizationCreateInputBySection[S], workspaceId?: string): Promise<ApiResult<{ readonly entry: PersonalizationEntry; readonly status: "saved" }>> {
  return request(\`/api/v1/settings/personalization/\${encodeURIComponent(section)}\`, { method: "POST", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function updatePersonalizationEntry<S extends PersonalizationSection>(section: S, id: string, input: PersonalizationUpdateInputBySection[S], workspaceId?: string): Promise<ApiResult<{ readonly entry: PersonalizationEntry; readonly status: "saved" }>> {
  return request(\`/api/v1/settings/personalization/\${encodeURIComponent(section)}/\${encodeURIComponent(id)}\`, { method: "PATCH", headers: workspaceHeader(workspaceId), body: JSON.stringify(input) });
}

export function deletePersonalizationEntry(section: PersonalizationSection, id: string, expectedUpdatedAt: string, replacementId?: string, workspaceId?: string): Promise<ApiResult<{ readonly id: string; readonly status: "deleted" }>> {
  const query = new URLSearchParams({ expectedUpdatedAt });
  if (replacementId) query.set("replacementId", replacementId);
  return request(\`/api/v1/settings/personalization/\${encodeURIComponent(section)}/\${encodeURIComponent(id)}?\${query}\`, { method: "DELETE", headers: workspaceHeader(workspaceId) });
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
  readonly lastContactAt?: string;
  readonly profileSections?: readonly { readonly id: PersonProfileSectionId; readonly status: "hidden" | "ready" }[];
  readonly tagCount: number;
  readonly tags: readonly PeopleDirectoryTag[];
  readonly updatedAt: string;
}

export interface PersonFile {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: "document" | "photo";
  readonly mimeType: string;
  readonly personId: string;
  readonly status: "available" | "missing" | "processing" | "quarantined";
  readonly title: string;
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

export interface InteractionOption {
  readonly id: string;
  readonly name: string;
}

export interface InteractionParticipant {
  readonly id: string;
  readonly name: string;
}

export type Interaction =
  | {
    readonly activityType?: string;
    readonly createdAt?: string;
    readonly description?: string;
    readonly emotions: readonly InteractionOption[];
    readonly happenedAt: string;
    readonly id: string;
    readonly kind: "activity";
    readonly participants: readonly InteractionParticipant[];
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly createdAt: string;
    readonly id: string;
    readonly isFavorited: boolean;
    readonly kind: "note";
    readonly person?: InteractionParticipant;
    readonly participants?: readonly [InteractionParticipant];
  }
  | {
    readonly calledAt: string;
    readonly contactWasCaller: boolean;
    readonly content?: string;
    readonly createdAt: string;
    readonly emotions: readonly InteractionOption[];
    readonly id: string;
    readonly kind: "call";
    readonly person: InteractionParticipant;
  }
  | {
    readonly channelType?: InteractionOption;
    readonly contactMethod?: { readonly id: string; readonly value: string };
    readonly createdAt: string;
    readonly happenedAt: string;
    readonly id: string;
    readonly kind: "conversation";
    readonly messages: readonly { readonly content: string; readonly direction: "inbound" | "outbound"; readonly id: string; readonly writtenAt: string }[];
    readonly person: InteractionParticipant;
    readonly title?: string;
  };

export type InteractionInput =
  | {
    readonly activityTypeId?: string;
    readonly description?: string;
    readonly emotionIds?: readonly string[];
    readonly happenedAt: string;
    readonly kind: "activity";
    readonly participantIds: readonly string[];
    readonly requestId: string;
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly isFavorited?: boolean;
    readonly kind: "note";
    readonly personId: string;
    readonly requestId: string;
  }
  | {
    readonly calledAt: string;
    readonly contactWasCaller: boolean;
    readonly content?: string;
    readonly emotionIds?: readonly string[];
    readonly kind: "call";
    readonly personId: string;
    readonly requestId: string;
  }
  | {
    readonly channelTypeId: string;
    readonly contactMethodId?: string;
    readonly happenedAt: string;
    readonly kind: "conversation";
    readonly messages?: readonly { readonly content: string; readonly direction: "inbound" | "outbound"; readonly writtenAt: string }[];
    readonly personId: string;
    readonly requestId: string;
    readonly title?: string;
  };

export type ActivityOrNoteInteraction = Extract<
  Interaction,
  { readonly kind: "activity" | "note" }
>;

export interface CommunicationOptions {
  readonly availability: { readonly call: boolean; readonly conversation: boolean };
  readonly channelTypes: readonly InteractionOption[];
  readonly emotions: readonly InteractionOption[];
  readonly status: "ready";
}

export interface CommunicationList {
  readonly items: readonly Extract<Interaction, { readonly kind: "call" | "conversation" }>[];
  readonly status: "ready";
}

export interface ActivityReport {
  readonly items: readonly ActivityOrNoteInteraction[];
  readonly nextCursor?: string;
  readonly person: InteractionParticipant;
  readonly status: "archived" | "ready";
}

export interface AuditDateDetail {
  readonly isYearApproximate: boolean;
  readonly precision: "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
}

export type AuditDetail = boolean | string | null | readonly string[] | AuditDateDetail;

export interface AuditEvent {
  readonly action: string;
  readonly actor: { readonly id?: string; readonly name: string };
  readonly details: Readonly<Record<string, AuditDetail>>;
  readonly id: string;
  readonly occurredAt: string;
  readonly person?: InteractionParticipant;
  readonly redacted: boolean;
  readonly subject: { readonly id?: string; readonly type?: string };
}

export interface AuditHistory {
  readonly items: readonly AuditEvent[];
  readonly nextCursor?: string;
  readonly person?: InteractionParticipant;
  readonly status: "archived" | "ready";
}

export interface AuditHistoryInput {
  readonly action?: string;
  readonly actorMemberId?: string;
  readonly cursor?: string;
  readonly from?: string;
  readonly limit?: number;
  readonly personId?: string;
  readonly to?: string;
}

export interface TodayFavoriteNotes {
  readonly items: readonly Extract<Interaction, { readonly kind: "note" }>[];
  readonly status: "ready";
}

export interface TodayRecentActivity {
  readonly items: readonly ActivityOrNoteInteraction[];
  readonly status: "ready";
}

export interface TaskPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
  readonly unavailable?: boolean;
}

export interface Task {
  readonly completedAt?: string;
  readonly completedByMemberId?: string;
  readonly createdAt: string;
  readonly createdByMemberId?: string;
  readonly description?: string;
  readonly dueAt?: string;
  readonly id: string;
  readonly person?: TaskPerson;
  readonly status: "cancelled" | "completed" | "open";
  readonly title: string;
  readonly updatedAt: string;
}

export interface TaskCreateInput {
  readonly description?: string;
  readonly dueAt?: string;
  readonly personId?: string;
  readonly requestId: string;
  readonly title: string;
}

export interface TaskChangeInput {
  readonly description?: string | null;
  readonly dueAt?: string | null;
  readonly expectedUpdatedAt: string;
  readonly personId?: string | null;
  readonly status?: "cancelled" | "open";
  readonly title?: string;
}

export interface TaskList {
  readonly items: readonly Task[];
  readonly nextCursor?: string;
  readonly status: "ready";
}

export type ReminderOccurrenceStatus = "pending" | "claimed" | "retry" | "sent" | "skipped" | "failed" | "cancelled" | "manual_attention";
export interface ReminderOccurrence { readonly attemptCount: number; readonly deliverAt: string; readonly error?: string; readonly id: string; readonly occursOn: string; readonly providerEffectAt?: string; readonly sentAt?: string; readonly status: ReminderOccurrenceStatus; readonly visibleAt?: string; }
export interface Reminder { readonly anchorOn: string; readonly createdAt: string; readonly id: string; readonly isActive: boolean; readonly nextOccurrence?: ReminderOccurrence; readonly personId: string; readonly recurrenceInterval: number; readonly recurrenceUnit: "none" | "day" | "week" | "month" | "year"; readonly sendTime: string; readonly title: string; readonly updatedAt: string; }
export interface StayInTouchCadence { readonly id: string; readonly intervalCount: number; readonly intervalUnit: "day" | "week" | "month" | "year"; readonly isActive: boolean; readonly lastContactedAt?: string; readonly nextDueAt: string; readonly personId: string; readonly updatedAt: string; }
export interface ReminderCreateInput { readonly anchorOn: string; readonly personId: string; readonly recurrenceInterval: number; readonly recurrenceUnit: Reminder["recurrenceUnit"]; readonly requestId: string; readonly sendTime: string; readonly title: string; }
export interface CadenceCreateInput { readonly intervalCount: number; readonly intervalUnit: StayInTouchCadence["intervalUnit"]; readonly personId: string; readonly requestId: string; }
export interface PersonReminders { readonly cadences: readonly StayInTouchCadence[]; readonly reminders: readonly Reminder[]; readonly status: "ready"; }
export interface TodayAttentionPerson { readonly archived: boolean; readonly id: string; readonly name: string; readonly unavailable?: boolean; }
export type TodayAttentionItem =
  | { readonly dueAt: string; readonly id: string; readonly kind: "task"; readonly person?: TodayAttentionPerson; readonly title: string }
  | { readonly dueAt: string; readonly id: string; readonly kind: "reminder"; readonly occursOn: string; readonly person?: TodayAttentionPerson; readonly reminderStatus: "failed" | "manual_attention" | "pending" | "retry"; readonly title: string }
  | { readonly dueAt: string; readonly id: string; readonly kind: "important-date"; readonly occursOn: string; readonly person?: TodayAttentionPerson; readonly reminderStatus: "failed" | "manual_attention" | "pending" | "retry"; readonly title: string }
  | { readonly dueAt: string; readonly id: string; readonly kind: "life-event"; readonly occursOn: string; readonly person?: TodayAttentionPerson; readonly reminderStatus: "failed" | "manual_attention" | "pending" | "retry"; readonly title: string }
  | { readonly dueAt: string; readonly id: string; readonly kind: "cadence"; readonly lastContactedAt?: string; readonly person: TodayAttentionPerson; readonly title: string };
export interface TodayAttention { readonly attention: { readonly nextSevenDays: readonly TodayAttentionItem[]; readonly overdue: readonly TodayAttentionItem[]; readonly today: readonly TodayAttentionItem[] }; readonly date: string; readonly status: "ready"; readonly timezone: string; readonly upcoming: readonly TodayAttentionItem[]; }
export interface TodayRecentPerson { readonly archived: boolean; readonly id: string; readonly name: string; }
export interface TodayRecentPeople { readonly people: readonly TodayRecentPerson[]; readonly status: "ready"; }
export interface TodayReminderPerson { readonly archived: boolean; readonly id: string; readonly name: string; }
interface TodayReminderBase { readonly attemptCount: number; readonly deliverAt: string; readonly id: string; readonly person: TodayReminderPerson; readonly title: string; readonly visibleAt?: string; }
export type TodayReminderItem =
  | (TodayReminderBase & { readonly nextAttemptAt: string; readonly status: "retry" })
  | (TodayReminderBase & { readonly nextAttemptAt?: never; readonly status: "pending" | "claimed" | "sent" | "failed" | "manual_attention" });
export interface TodayCadenceItem { readonly dueAt: string; readonly id: string; readonly lastContactedAt?: string; readonly person: TodayReminderPerson; }
export interface TodayReminders { readonly cadences: readonly TodayCadenceItem[]; readonly reminders: readonly TodayReminderItem[]; readonly status: "ready"; readonly timezone: string; }

const todayReminderUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-58][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const todayRfc3339Instant = /^(\\d{4})-(\\d{2})-(\\d{2})[Tt](\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?([Zz]|[+-](\\d{2}):(\\d{2}))$/;
function exactTodayRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    Object.keys(record).every((key) => allowed.has(key));
}
function validTodayPerson(value: unknown): value is TodayReminderPerson {
  return exactTodayRecord(value, ["archived", "id", "name"]) &&
    typeof value.archived === "boolean" && typeof value.id === "string" &&
    todayReminderUuid.test(value.id) && typeof value.name === "string";
}
function validTodayInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = todayRfc3339Instant.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  return day >= 1 && day <= daysInMonth && hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value));
}
function validTodayTimezone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}
export function parseTodayReminders(value: unknown): TodayReminders {
  const valid = exactTodayRecord(value, ["cadences", "reminders", "status", "timezone"]) &&
    value.status === "ready" && validTodayTimezone(value.timezone) &&
    Array.isArray(value.reminders) && value.reminders.length <= 100 &&
    value.reminders.every((item) =>
      exactTodayRecord(item, ["attemptCount", "deliverAt", "id", "person", "status", "title"], ["nextAttemptAt", "visibleAt"]) &&
      typeof item.attemptCount === "number" && Number.isInteger(item.attemptCount) && item.attemptCount >= 0 &&
      validTodayInstant(item.deliverAt) && typeof item.id === "string" && todayReminderUuid.test(item.id) &&
      validTodayPerson(item.person) && ["pending", "claimed", "retry", "sent", "failed", "manual_attention"].includes(String(item.status)) &&
      (item.status === "retry" ? validTodayInstant(item.nextAttemptAt) : item.nextAttemptAt === undefined) &&
      typeof item.title === "string" && (item.visibleAt === undefined || validTodayInstant(item.visibleAt))
    ) &&
    Array.isArray(value.cadences) && value.cadences.length <= 100 &&
    value.cadences.every((item) =>
      exactTodayRecord(item, ["dueAt", "id", "person"], ["lastContactedAt"]) &&
      validTodayInstant(item.dueAt) && typeof item.id === "string" && todayReminderUuid.test(item.id) &&
      validTodayPerson(item.person) && (item.lastContactedAt === undefined || validTodayInstant(item.lastContactedAt))
    );
  if (!valid) throw new TypeError("Invalid Today reminders response.");
  return value as unknown as TodayReminders;
}

function validTodayAttentionPerson(value: unknown): value is TodayAttentionPerson {
  return exactTodayRecord(value, ["archived", "id", "name"], ["unavailable"]) &&
    typeof value.archived === "boolean" && typeof value.id === "string" && todayReminderUuid.test(value.id) &&
    typeof value.name === "string" && (value.unavailable === undefined || typeof value.unavailable === "boolean");
}
function validTodayDate(value: unknown): value is string {
  return typeof value === "string" && /^\\d{4}-\\d{2}-\\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().startsWith(value);
}
function validTodayAttentionItem(value: unknown): value is TodayAttentionItem {
  const base = ["dueAt", "id", "kind", "title"];
  if (!exactTodayRecord(value, base, ["lastContactedAt", "occursOn", "person", "reminderStatus"])) return false;
  if (!validTodayInstant(value.dueAt) || typeof value.id !== "string" || !todayReminderUuid.test(value.id) || typeof value.title !== "string") return false;
  if (value.person !== undefined && !validTodayAttentionPerson(value.person)) return false;
  if (value.kind === "task") return exactTodayRecord(value, base, ["person"]);
  if (value.kind === "important-date" || value.kind === "life-event" || value.kind === "reminder") return exactTodayRecord(value, [...base, "occursOn", "reminderStatus"], ["person"]) && validTodayDate(value.occursOn) &&
    ["failed", "manual_attention", "pending", "retry"].includes(String(value.reminderStatus));
  return value.kind === "cadence" && exactTodayRecord(value, [...base, "person"], ["lastContactedAt"]) && validTodayAttentionPerson(value.person) &&
    (value.lastContactedAt === undefined || validTodayInstant(value.lastContactedAt));
}
export function parseTodayAttention(value: unknown): TodayAttention {
  const validGroup = (group: unknown) => exactTodayRecord(group, ["nextSevenDays", "overdue", "today"]) &&
    [group.nextSevenDays, group.overdue, group.today].every((items) =>
      Array.isArray(items) && items.length <= 20 && items.every(validTodayAttentionItem));
  const valid = exactTodayRecord(value, ["attention", "date", "status", "timezone", "upcoming"]) &&
    value.status === "ready" && validTodayDate(value.date) && validTodayTimezone(value.timezone) &&
    validGroup(value.attention) && Array.isArray(value.upcoming) && value.upcoming.length <= 30 && value.upcoming.every(validTodayAttentionItem);
  if (!valid) throw new TypeError("Invalid Today attention response.");
  return value as unknown as TodayAttention;
}

export function parseTodayRecentPeople(value: unknown): TodayRecentPeople {
  const valid = exactTodayRecord(value, ["people", "status"]) && value.status === "ready" &&
    Array.isArray(value.people) && value.people.length <= 8 && value.people.every((person) =>
      exactTodayRecord(person, ["archived", "id", "name"]) && typeof person.archived === "boolean" &&
      typeof person.id === "string" && todayReminderUuid.test(person.id) && typeof person.name === "string"
    );
  if (!valid) throw new TypeError("Invalid Today recent people response.");
  return value as unknown as TodayRecentPeople;
}

export interface RelationshipType {
  readonly archived: boolean;
  readonly forwardLabel: string;
  readonly id: string;
  readonly reverseLabel: string;
}

export interface Relationship {
  readonly createdAt: string;
  readonly forwardLabel: string;
  readonly fromPersonId: string;
  readonly id: string;
  readonly relationshipTypeId: string;
  readonly relationshipTypeArchived: boolean;
  readonly reverseLabel: string;
  readonly status: "active" | "ended";
  readonly toPersonId: string;
  readonly updatedAt: string;
}

export interface RelationshipDisplay {
  readonly label: string;
  readonly name?: string;
  readonly personId: string;
  readonly relationshipId: string;
}

export interface RelationshipWithDisplay extends Relationship {
  readonly display: RelationshipDisplay;
}

export interface RelationshipChanged {
  readonly affectedPersonIds: readonly [string, string];
  readonly forward: RelationshipDisplay;
  readonly inverse: RelationshipDisplay;
  readonly relationship: Relationship;
  readonly status: "created" | "existing" | "updated";
}

export interface RelatedPersonRelationshipInput {
  readonly person: PersonInput;
  readonly relationshipTypeId: string;
}

export interface RelatedPersonRelationshipChanged extends RelationshipChanged {
  readonly person: PersonIdentity;
  readonly status: "created";
}

export interface RelationshipListInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface RelationshipListPage {
  readonly nextCursor?: string;
  readonly relationships: readonly RelationshipWithDisplay[];
  readonly status: "archived" | "hidden" | "ready";
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
  readonly nextReminderAt?: string;
  readonly openTaskCount: number;
  readonly stayInTouchAt?: string;
  readonly status: "ready";
}

export type PersonLifeEventPrecision = "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";
export interface PersonLifeEvent {
  readonly date: { readonly day?: number; readonly happenedAt?: string; readonly month?: number; readonly precision: PersonLifeEventPrecision; readonly year?: number };
  readonly id: string;
  readonly name?: string;
  readonly note?: string;
  readonly typeName?: string;
}

export type ImportantDateKind = "birthday" | "custom" | "deceased" | "first_met";
export type ImportantDatePrecision = "day" | "full" | "month" | "month_day" | "unknown" | "year" | "year_month";

export interface ImportantDateInput {
  readonly day?: number;
  readonly isAgeBased: boolean;
  readonly isYearApproximate: boolean;
  readonly kind: ImportantDateKind;
  readonly label?: string;
  readonly month?: number;
  readonly notes?: string;
  readonly precision: ImportantDatePrecision;
  readonly year?: number;
}

export interface ImportantDate extends ImportantDateInput {
  readonly createdAt: string;
  readonly id: string;
  readonly personId: string;
  readonly scheduling: "annual-reminder" | "not-schedulable";
  readonly updatedAt: string;
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
  readonly excludePersonId?: string;
  readonly lifecycle?: PeopleDirectoryLifecycle;
  readonly limit?: number;
  readonly search?: string;
  readonly selectedPersonId?: string;
  readonly sort?: PeopleDirectorySort;
  readonly tagId?: string;
}

export interface PeopleDirectoryPage {
  readonly lifecycle: PeopleDirectoryLifecycle;
  readonly nextCursor?: string;
  readonly people: readonly PeopleDirectoryPerson[];
  readonly selected?: PeopleDirectoryPerson;
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

export type ProfileFactSectionId = "addresses" | "contact-methods" | "first-meeting" | "food-preferences" | "pets" | "tags" | "work";
export type PersonProfileSectionId = ProfileFactSectionId | "activities" | "calls" | "conversations" | "life-events" | "notes" | "relationships" | "tasks";
export interface ProfileFactOption {
  readonly id: string;
  readonly kind?: "contact-label" | "contact-type" | "organization" | "pet-category";
  readonly name: string;
}
export interface AddressFact {
  readonly section: "addresses";
  readonly city?: string;
  readonly country?: string;
  readonly displayName?: string;
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly postalCode?: string;
  readonly region?: string;
  readonly street?: string;
}
export interface ContactMethodFact {
  readonly section: "contact-methods";
  readonly isPrimary: boolean;
  readonly labelIds: readonly string[];
  readonly notes?: string;
  readonly typeId: string;
  readonly value: string;
}
export interface FirstMeetingFact {
  readonly section: "first-meeting";
  readonly introducedByPersonId?: string;
  readonly notes?: string;
  readonly placeText?: string;
}
export interface FoodPreferencesFact {
  readonly foodPreferences?: string;
  readonly section: "food-preferences";
}
export interface PetFact {
  readonly section: "pets";
  readonly categoryId?: string;
  readonly name?: string;
  readonly notes?: string;
}
export interface TagsFact {
  readonly section: "tags";
  readonly tagIds: readonly string[];
}
export interface OccupationFact {
  readonly section: "work";
  readonly description?: string;
  readonly endOn?: string;
  readonly isCurrent: boolean;
  readonly organizationId?: string;
  readonly organizationName?: string;
  readonly startOn?: string;
  readonly title: string;
}
export interface ProfileFactValueBySection {
  readonly addresses: AddressFact;
  readonly "contact-methods": ContactMethodFact;
  readonly "first-meeting": FirstMeetingFact;
  readonly "food-preferences": FoodPreferencesFact;
  readonly pets: PetFact;
  readonly tags: TagsFact;
  readonly work: OccupationFact;
}
export type ProfileFactValue = ProfileFactValueBySection[ProfileFactSectionId];
type ProfileFactCreateMetadata = {
  readonly expectedPersonUpdatedAt: string;
};
type ProfileFactUpdateMetadata = ProfileFactCreateMetadata & {
  readonly expectedUpdatedAt: string;
  readonly id: string;
};
type AddressFactInput<Metadata> = AddressFact & Metadata & (
  | { readonly displayName: string }
  | { readonly street: string }
  | { readonly city: string }
  | { readonly region: string }
  | { readonly postalCode: string }
  | { readonly country: string }
);
type FirstMeetingFactInput<Metadata> = FirstMeetingFact & Metadata & (
  | { readonly introducedByPersonId: string }
  | { readonly notes: string }
  | { readonly placeText: string }
);
type PetFactInput<Metadata> = PetFact & Metadata & (
  | { readonly categoryId: string }
  | { readonly name: string }
);
export type ProfileFactCreateInputBySection = {
  readonly addresses: AddressFactInput<ProfileFactCreateMetadata>;
  readonly "contact-methods": ContactMethodFact & ProfileFactCreateMetadata;
  readonly "first-meeting": FirstMeetingFactInput<ProfileFactCreateMetadata>;
  readonly "food-preferences": Omit<FoodPreferencesFact, "foodPreferences"> &
    ProfileFactCreateMetadata & { readonly foodPreferences: string };
  readonly pets: PetFactInput<ProfileFactCreateMetadata>;
  readonly tags: TagsFact & ProfileFactCreateMetadata;
  readonly work: OccupationFact & ProfileFactCreateMetadata;
};
export type ProfileFactCreateInput = ProfileFactCreateInputBySection[ProfileFactSectionId];
export type ProfileFactUpdateInputBySection = {
  readonly addresses: AddressFactInput<ProfileFactUpdateMetadata>;
  readonly "contact-methods": ContactMethodFact & ProfileFactUpdateMetadata;
  readonly "first-meeting": FirstMeetingFactInput<ProfileFactUpdateMetadata>;
  readonly "food-preferences": Omit<FoodPreferencesFact, "foodPreferences"> &
    ProfileFactUpdateMetadata & { readonly foodPreferences: string };
  readonly pets: PetFactInput<ProfileFactUpdateMetadata>;
  readonly tags: TagsFact & ProfileFactUpdateMetadata;
  readonly work: OccupationFact & ProfileFactUpdateMetadata;
};
export type ProfileFactUpdateInput = ProfileFactUpdateInputBySection[ProfileFactSectionId];
export interface ProfileFactDeleteInput {
  readonly expectedPersonUpdatedAt: string;
  readonly expectedUpdatedAt: string;
  readonly section: ProfileFactSectionId;
}
export type ProfileFactListInput = {
  readonly cursor?: string;
  readonly optionSearch?: string;
} & (
  | { readonly includeOptions: true; readonly optionCursor?: string }
  | { readonly includeOptions?: never; readonly optionCursor?: never }
);
export type ProfileFactRecord = {
  readonly [Section in ProfileFactSectionId]: {
    readonly id: string;
    readonly referencesResolved?: boolean;
    readonly section: Section;
    readonly selectedOptions?: readonly ProfileFactOption[];
    readonly updatedAt: string;
    readonly value: ProfileFactValueBySection[Section];
  };
}[ProfileFactSectionId];
export interface ProfileFactSection {
  readonly nextCursor?: string;
  readonly nextOptionsCursor?: string;
  readonly options: readonly ProfileFactOption[];
  readonly personUpdatedAt: string;
  readonly records: readonly ProfileFactRecord[];
  readonly status: "ready" | "archived" | "hidden";
}

export function listPeople(input: PeopleDirectoryInput = {}, workspaceId?: string): Promise<ApiResult<PeopleDirectoryPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.excludePersonId) query.set("excludePersonId", input.excludePersonId);
  if (input.lifecycle) query.set("lifecycle", input.lifecycle);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.search) query.set("search", input.search);
  if (input.selectedPersonId) query.set("selectedPersonId", input.selectedPersonId);
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

export function listPersonLifeEvents(personId: string, workspaceId?: string): Promise<ApiResult<{ readonly events: readonly PersonLifeEvent[]; readonly status: "hidden" | "ready" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/life-events\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listPersonFiles(personId: string, workspaceId?: string): Promise<ApiResult<{ readonly files: readonly PersonFile[]; readonly status: "ready" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/files\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function uploadPersonFile(personId: string, input: { readonly file: File; readonly kind: PersonFile["kind"]; readonly title: string }, workspaceId?: string): Promise<ApiResult<{ readonly file: PersonFile; readonly status: "created" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/files\`, {
    method: "POST",
    body: input.file,
    headers: {
      "content-type": input.file.type,
      "X-File-Kind": input.kind,
      "X-File-Name": encodeURIComponent(input.file.name),
      "X-File-Title": encodeURIComponent(input.title),
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    },
  });
}

export function personFileContentUrl(personId: string, fileId: string): string {
  return \`/api/v1/people/\${encodeURIComponent(personId)}/files/\${encodeURIComponent(fileId)}/content\`;
}

export function removePersonFile(personId: string, fileId: string, workspaceId?: string): Promise<ApiResult<{ readonly fileId: string; readonly status: "removed" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/files/\${encodeURIComponent(fileId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function recordPersonView(personId: string, workspaceId?: string): Promise<ApiResult<{ readonly status: "recorded" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/view\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function recordInteraction(input: InteractionInput, workspaceId?: string): Promise<ApiResult<{ readonly record: Interaction; readonly status: "created" }>> {
  return request("/api/v1/interactions", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function listInteractionOptions(input: { readonly activityTypeCursor?: string; readonly activityTypeSearch?: string; readonly emotionCursor?: string; readonly emotionSearch?: string; readonly limit?: number } = {}, workspaceId?: string): Promise<ApiResult<{ readonly activityTypes: readonly InteractionOption[]; readonly activityTypesNextCursor?: string; readonly availability: { readonly activity: boolean; readonly note: boolean }; readonly emotions: readonly InteractionOption[]; readonly emotionsNextCursor?: string; readonly status: "ready" }>> {
  const query = new URLSearchParams();
  if (input.activityTypeCursor) query.set("activityTypeCursor", input.activityTypeCursor);
  if (input.activityTypeSearch) query.set("activityTypeSearch", input.activityTypeSearch);
  if (input.emotionCursor) query.set("emotionCursor", input.emotionCursor);
  if (input.emotionSearch) query.set("emotionSearch", input.emotionSearch);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/interaction-options\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listCommunicationOptions(workspaceId?: string): Promise<ApiResult<CommunicationOptions>> {
  return request("/api/v1/communication-options", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listPersonCommunications(personId: string, workspaceId?: string): Promise<ApiResult<CommunicationList>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/communications\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function getActivityReport(personId: string, input: { readonly cursor?: string; readonly kind?: "activity" | "note"; readonly limit?: number; readonly year?: number } = {}, workspaceId?: string): Promise<ApiResult<ActivityReport>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.kind) query.set("kind", input.kind);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.year) query.set("year", String(input.year));
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/activity-report\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

function auditQuery(input: AuditHistoryInput): string {
  const query = new URLSearchParams();
  if (input.action) query.set("action", input.action);
  if (input.actorMemberId) query.set("actorMemberId", input.actorMemberId);
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.from) query.set("from", input.from);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.personId) query.set("personId", input.personId);
  if (input.to) query.set("to", input.to);
  return query.size ? \`?\${query.toString()}\` : "";
}

export function listWorkspaceAudit(input: AuditHistoryInput = {}, workspaceId?: string): Promise<ApiResult<AuditHistory>> {
  return request(\`/api/v1/audit-events\${auditQuery(input)}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listPersonAudit(personId: string, input: Omit<AuditHistoryInput, "personId"> = {}, workspaceId?: string): Promise<ApiResult<AuditHistory>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/audit\${auditQuery(input)}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function getTodayFavoriteNotes(workspaceId?: string): Promise<ApiResult<TodayFavoriteNotes>> {
  return request("/api/v1/today/favorite-notes", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function getTodayRecentActivity(workspaceId?: string): Promise<ApiResult<TodayRecentActivity>> {
  return request("/api/v1/today/recent-activity", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listTasks(input: { readonly cursor?: string; readonly limit?: number; readonly personId?: string; readonly status?: Task["status"] } = {}, workspaceId?: string): Promise<ApiResult<TaskList>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  if (input.personId) query.set("personId", input.personId);
  if (input.status) query.set("status", input.status);
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/tasks\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createTask(input: TaskCreateInput, workspaceId?: string): Promise<ApiResult<{ readonly status: "created"; readonly task: Task }>> {
  return request("/api/v1/tasks", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function changeTask(taskId: string, input: TaskChangeInput, workspaceId?: string): Promise<ApiResult<{ readonly status: "saved" | "unchanged"; readonly task: Task }>> {
  return request(\`/api/v1/tasks/\${encodeURIComponent(taskId)}\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function setTaskCompletion(taskId: string, completed: boolean, workspaceId?: string): Promise<ApiResult<{ readonly status: "saved" | "unchanged"; readonly task: Task }>> {
  return request(\`/api/v1/tasks/\${encodeURIComponent(taskId)}/completion\`, { method: "PUT", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ completed }) });
}

export function getTodayTasks(workspaceId?: string): Promise<ApiResult<TaskList>> {
  return request("/api/v1/today/tasks", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listPersonReminders(personId: string, workspaceId?: string): Promise<ApiResult<PersonReminders>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/reminders\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createReminder(input: ReminderCreateInput, workspaceId?: string): Promise<ApiResult<{ readonly reminder: Reminder; readonly status: "created" }>> {
  return request("/api/v1/reminders", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function createStayInTouchCadence(input: CadenceCreateInput, workspaceId?: string): Promise<ApiResult<{ readonly cadence: StayInTouchCadence; readonly status: "created" }>> {
  return request("/api/v1/stay-in-touch-cadences", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function setReminderActive(reminderId: string, active: boolean, workspaceId?: string): Promise<ApiResult<{ readonly reminder: Reminder; readonly status: "saved" }>> {
  return request(\`/api/v1/reminders/\${encodeURIComponent(reminderId)}/active\`, { method: "PUT", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ active }) });
}

export function getTodayReminders(workspaceId?: string): Promise<ApiResult<TodayReminders>> {
  return request<unknown>("/api/v1/today/reminders", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined }).then((result): ApiResult<TodayReminders> =>
    result.ok ? { ok: true, value: parseTodayReminders(result.value) } : result
  );
}

export function getTodayAttention(workspaceId?: string): Promise<ApiResult<TodayAttention>> {
  return request<unknown>("/api/v1/today/attention", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined }).then((result): ApiResult<TodayAttention> =>
    result.ok ? { ok: true, value: parseTodayAttention(result.value) } : result
  );
}

export function getTodayRecentPeople(workspaceId?: string): Promise<ApiResult<TodayRecentPeople>> {
  return request<unknown>("/api/v1/today/recent-people", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined }).then((result): ApiResult<TodayRecentPeople> =>
    result.ok ? { ok: true, value: parseTodayRecentPeople(result.value) } : result
  );
}

export function listRelationshipTypes(input: { readonly cursor?: string; readonly search?: string; readonly selected?: readonly string[] } = {}, workspaceId?: string): Promise<ApiResult<{ readonly nextCursor?: string; readonly options: readonly RelationshipType[]; readonly selected: readonly RelationshipType[]; readonly status: "hidden" | "ready" }>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.search) query.set("search", input.search);
  if (input.selected?.length) query.set("selected", input.selected.join(","));
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/relationship-types\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function listRelationships(personId: string, input: RelationshipListInput = {}, workspaceId?: string): Promise<ApiResult<RelationshipListPage>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.limit) query.set("limit", String(input.limit));
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/relationships\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createRelationship(personId: string, input: { readonly relationshipTypeId: string; readonly targetPersonId: string }, workspaceId?: string): Promise<ApiResult<RelationshipChanged>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/relationships\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function createRelatedPersonRelationship(personId: string, input: RelatedPersonRelationshipInput, workspaceId?: string): Promise<ApiResult<RelatedPersonRelationshipChanged>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/relationships/related-person\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function updateRelationship(personId: string, relationshipId: string, input: { readonly expectedUpdatedAt: string; readonly relationshipTypeId: string }, workspaceId?: string): Promise<ApiResult<RelationshipChanged>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/relationships/\${encodeURIComponent(relationshipId)}\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function deleteRelationship(personId: string, relationshipId: string, input: PersonTransitionInput, workspaceId?: string): Promise<ApiResult<{ readonly affectedPersonIds: readonly [string, string]; readonly relationshipId: string; readonly status: "deleted" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/relationships/\${encodeURIComponent(relationshipId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function listProfileFacts(personId: string, section: ProfileFactSectionId, input: ProfileFactListInput = {}, workspaceId?: string): Promise<ApiResult<ProfileFactSection>> {
  const query = new URLSearchParams();
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.includeOptions) query.set("includeOptions", "true");
  if (input.optionCursor) query.set("optionCursor", input.optionCursor);
  if (input.optionSearch) query.set("optionSearch", input.optionSearch);
  const suffix = query.size ? \`?\${query.toString()}\` : "";
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/facts/\${encodeURIComponent(section)}\${suffix}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createProfileFact<Section extends ProfileFactSectionId>(personId: string, section: Section, input: ProfileFactCreateInputBySection[Section], workspaceId?: string): Promise<ApiResult<{ readonly personUpdatedAt: string; readonly record: Extract<ProfileFactRecord, { readonly section: Section }>; readonly status: "saved" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/facts/\${encodeURIComponent(section)}\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function updateProfileFact<Section extends ProfileFactSectionId>(personId: string, section: Section, factId: string, input: ProfileFactUpdateInputBySection[Section], workspaceId?: string): Promise<ApiResult<{ readonly personUpdatedAt: string; readonly record: Extract<ProfileFactRecord, { readonly section: Section }>; readonly status: "saved" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/facts/\${encodeURIComponent(section)}/\${encodeURIComponent(factId)}\`, { method: "PUT", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function deleteProfileFact(personId: string, section: ProfileFactSectionId, factId: string, input: ProfileFactDeleteInput, workspaceId?: string): Promise<ApiResult<{ readonly factId: string; readonly personUpdatedAt: string; readonly status: "deleted" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/facts/\${encodeURIComponent(section)}/\${encodeURIComponent(factId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function listImportantDates(personId: string, workspaceId?: string): Promise<ApiResult<{ readonly dates: readonly ImportantDate[]; readonly status: "ready" | "archived" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/dates\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createImportantDate(personId: string, input: ImportantDateInput, workspaceId?: string): Promise<ApiResult<{ readonly date: ImportantDate; readonly status: "created" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/dates\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function updateImportantDate(personId: string, dateId: string, input: ImportantDateInput & PersonTransitionInput, workspaceId?: string): Promise<ApiResult<{ readonly date: ImportantDate; readonly status: "updated" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/dates/\${encodeURIComponent(dateId)}\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function deleteImportantDate(personId: string, dateId: string, input: PersonTransitionInput, workspaceId?: string): Promise<ApiResult<{ readonly dateId: string; readonly status: "deleted" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/dates/\${encodeURIComponent(dateId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
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

function renderGiftClient(): string {
  return `
export type GiftStatus = "archived" | "given" | "idea" | "planned" | "received";
export type DebtStatus = "cancelled" | "open" | "settled";

export interface Gift {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly id: string;
  readonly name: string;
  readonly personId: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly updatedAt: string;
  readonly url?: string;
}

export interface Debt {
  readonly amount: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly direction: "i_owe" | "they_owe";
  readonly id: string;
  readonly personId: string;
  readonly reason?: string;
  readonly settledAt?: string;
  readonly status: DebtStatus;
  readonly updatedAt: string;
}

export interface GiftCreateInput {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly url?: string;
}

export interface DebtCreateInput {
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: "i_owe" | "they_owe";
  readonly reason?: string;
  readonly status: DebtStatus;
}

export interface GiftDebtList {
  readonly debts: readonly Debt[];
  readonly gifts: readonly Gift[];
  readonly status: "ready";
  readonly supportedCurrencyCodes: readonly string[];
}

export function listPersonGifts(personId: string, workspaceId?: string): Promise<ApiResult<GiftDebtList>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/gifts\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createGift(personId: string, input: GiftCreateInput, workspaceId?: string): Promise<ApiResult<{ readonly gift: Gift; readonly status: "created" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/gifts\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function changeGiftStatus(personId: string, giftId: string, status: GiftStatus, workspaceId?: string): Promise<ApiResult<{ readonly gift: Gift; readonly status: "saved" | "unchanged" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/gifts/\${encodeURIComponent(giftId)}/status\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ status }) });
}

export function createDebt(personId: string, input: DebtCreateInput, workspaceId?: string): Promise<ApiResult<{ readonly debt: Debt; readonly status: "created" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/debts\`, { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function changeDebtStatus(personId: string, debtId: string, status: DebtStatus, workspaceId?: string): Promise<ApiResult<{ readonly debt: Debt; readonly status: "saved" | "unchanged" }>> {
  return request(\`/api/v1/people/\${encodeURIComponent(personId)}/debts/\${encodeURIComponent(debtId)}/status\`, { method: "PATCH", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ status }) });
}
`;
}

function renderJournalClient(): string {
  return `
export interface JournalStoredPost {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly title?: string;
  readonly updatedAt: string;
}

export interface JournalStoredDayRating {
  readonly comment?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly ratedOn: string;
  readonly rating: number;
  readonly updatedAt: string;
}

export interface JournalLinkableActivity {
  readonly happenedAt: string;
  readonly id: string;
  readonly summary: string;
}

export type JournalTimelineItem =
  | { readonly activity: { readonly id: string; readonly summary: string }; readonly id: string; readonly occurredAt: string; readonly type: "activity" }
  | { readonly dayRating: { readonly comment?: string; readonly id: string; readonly ratedOn: string; readonly rating: number }; readonly id: string; readonly occurredAt: string; readonly type: "day-rating" }
  | { readonly id: string; readonly occurredAt: string; readonly post: { readonly body: string; readonly id: string; readonly title?: string; readonly updatedAt: string }; readonly type: "post" };

export type JournalItemType = JournalTimelineItem["type"];

export interface JournalPostInput {
  readonly body: string;
  readonly occurredAt: string;
  readonly title?: string;
}

export interface JournalDayRatingInput {
  readonly comment?: string;
  readonly ratedOn: string;
  readonly rating: number;
}

export function listJournal(workspaceId?: string): Promise<ApiResult<{ readonly activities: readonly JournalLinkableActivity[]; readonly items: readonly JournalTimelineItem[]; readonly status: "ready" }>> {
  return request("/api/v1/journal", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function getJournalItem(itemId: string, workspaceId?: string): Promise<ApiResult<{ readonly item: JournalTimelineItem; readonly status: "ready" }>> {
  return request(\`/api/v1/journal/items/\${encodeURIComponent(itemId)}\`, { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function createJournalPost(input: JournalPostInput, workspaceId?: string): Promise<ApiResult<{ readonly post: JournalStoredPost; readonly status: "created" }>> {
  return request("/api/v1/journal/posts", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function updateJournalPost(postId: string, input: JournalPostInput, workspaceId?: string): Promise<ApiResult<{ readonly post: JournalStoredPost; readonly status: "updated" }>> {
  return request(\`/api/v1/journal/posts/\${encodeURIComponent(postId)}\`, { method: "PUT", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function saveJournalDayRating(input: JournalDayRatingInput, workspaceId?: string): Promise<ApiResult<{ readonly rating: JournalStoredDayRating; readonly status: "created" | "updated" }>> {
  return request("/api/v1/journal/day-ratings", { method: "PUT", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify(input) });
}

export function linkJournalActivity(activityId: string, workspaceId?: string): Promise<ApiResult<{ readonly activityId: string; readonly id: string; readonly occurredAt: string; readonly status: "created" }>> {
  return request("/api/v1/journal/activities", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ activityId }) });
}

export function deleteJournalItem(itemId: string, workspaceId?: string): Promise<ApiResult<{ readonly itemType: JournalItemType; readonly status: "deleted" }>> {
  return request(\`/api/v1/journal/items/\${encodeURIComponent(itemId)}\`, { method: "DELETE", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}
`;
}

function renderGovernanceClient(): string {
  return `
export interface LegalDocument {
  readonly content: string;
  readonly documentType: string;
  readonly id: string;
  readonly publishedAt?: string;
  readonly version: string;
}

export interface SessionContext {
  readonly requiredLegalDocuments: readonly LegalDocument[];
}

export function getPublicLegalDocument(documentType: "privacy" | "terms"): Promise<ApiResult<{ readonly document: LegalDocument; readonly status: "ready" }>> {
  return request(\`/api/v1/legal-documents/\${documentType}\`);
}

export function getLegalRequirements(workspaceId?: string): Promise<ApiResult<{ readonly documents: readonly LegalDocument[]; readonly status: "ready" }>> {
  return request("/api/v1/legal-requirements", { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined });
}

export function acceptLegalDocument(documentId: string, workspaceId?: string): Promise<ApiResult<{ readonly acceptedAt: string; readonly documentId: string; readonly status: "accepted" | "already-accepted" }>> {
  return request("/api/v1/legal-acceptances", { method: "POST", headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined, body: JSON.stringify({ documentId }) });
}
`;
}

if (import.meta.main) {
  const openApi = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const client = renderGeneratedClient() + renderInvitationClient() +
    renderSettingsClient() + renderPeopleClient() + renderGiftClient() +
    renderJournalClient() + renderGovernanceClient();
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
