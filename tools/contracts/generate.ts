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
          },
        },
      },
      "/api/v1/application-entry": {
        post: {
          operationId: "consumeApplicationEntry",
          description:
            "Browser-only one-time application entry. Requires the exact Origin header configured for the public web origin and the HttpOnly kinship_entry cookie. The cookie is SameSite=Strict and is Secure outside explicit loopback HTTP development/test use.",
          security: [{ kinship_entry: [] }],
          responses: {
            "200": {
              description: "Narrow application entry context",
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
            next: { const: "/app" },
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

export function renderGeneratedClient(): string {
  return `// Generated by deno task contracts:generate from packages/contracts/openapi/openapi.json. Do not edit.\n\nexport interface RegistrationInput {\n  readonly email: string;\n  readonly firstName: string;\n  readonly lastName: string;\n  readonly password: string;\n  readonly workspaceName: string;\n}\n\nexport interface ProblemDetails {\n  readonly type: string;\n  readonly title: string;\n  readonly status: number;\n  readonly detail: string;\n  readonly code: string;\n  readonly errors?: Readonly<Record<string, string>>;\n}\n\nexport interface ApplicationEntry {\n  readonly status: \"ready\";\n  readonly workspace: { readonly id: string; readonly name: string };\n  readonly member: { readonly id: string; readonly firstName: string };\n}\n\nexport type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: ProblemDetails };\n\nasync function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {\n  const response = await fetch(path, { ...init, headers: { \"content-type\": \"application/json\", ...init?.headers } });\n  const body = await response.json() as T | ProblemDetails;\n  return response.ok ? { ok: true, value: body as T } : { ok: false, problem: body as ProblemDetails };\n}\n\nexport function register(input: RegistrationInput): Promise<ApiResult<{ readonly status: \"verification-required\" }>> {\n  return request(\"/api/v1/registrations\", { method: \"POST\", body: JSON.stringify(input) });\n}\n\nexport function retryVerificationDelivery(email: string): Promise<ApiResult<{ readonly status: \"accepted\" }>> {\n  return request(\"/api/v1/email-verification-deliveries\", { method: \"POST\", body: JSON.stringify({ email }) });\n}\n\nexport function verifyEmail(token: string): Promise<ApiResult<{ readonly status: \"verified\"; readonly next: \"/app\" }>> {\n  return request(\"/api/v1/email-verifications\", { method: \"POST\", body: JSON.stringify({ token }) });\n}\n\nexport function consumeApplicationEntry(): Promise<ApiResult<ApplicationEntry>> {\n  return request(\"/api/v1/application-entry\", { method: \"POST\" });\n}\n`;
}

if (import.meta.main) {
  const openApi = JSON.stringify(buildOpenApiDocument(), null, 2) + "\n";
  const client = renderGeneratedClient();
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
