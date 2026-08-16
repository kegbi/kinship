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
        PersonDueInformation: {
          type: "object",
          required: ["status", "detail"],
          properties: {
            status: { const: "unavailable" },
            detail: { type: "string" },
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
            "addresses",
            "contact-methods",
            "first-meeting",
            "food-preferences",
            "pets",
            "relationships",
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
              enum: ["contact-label", "contact-type", "pet-category"],
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
  readonly profileSections?: readonly { readonly id: PersonProfileSectionId; readonly status: "hidden" | "ready" }[];
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
  readonly status: "unavailable";
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
export type PersonProfileSectionId = ProfileFactSectionId | "relationships";
export interface ProfileFactOption {
  readonly id: string;
  readonly kind?: "contact-label" | "contact-type" | "pet-category";
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
