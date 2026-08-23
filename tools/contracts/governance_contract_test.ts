function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("GOVERNANCE-002 contract publishes only bounded redacted audit reads", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<
      Record<string, {
        readonly get?: {
          readonly parameters?: readonly { readonly name?: string }[];
          readonly responses?: Readonly<Record<string, unknown>>;
        };
      }>
    >;
    readonly components: {
      readonly schemas: Readonly<Record<string, unknown>>;
    };
  };
  for (
    const path of [
      "/api/v1/audit-events",
      "/api/v1/people/{personId}/audit",
    ]
  ) {
    const operation = document.paths[path]?.get;
    assert(operation, `${path} audit read is undocumented`);
    const parameters = new Set(
      operation.parameters?.map((entry) => entry.name),
    );
    for (
      const name of ["action", "actorMemberId", "cursor", "from", "limit", "to"]
    ) {
      assert(parameters.has(name), `${path} omitted ${name}`);
    }
    assert(
      operation.responses?.["403"] && operation.responses?.["409"],
      `${path} omitted forbidden or stale-cursor response`,
    );
  }
  const schema = JSON.stringify(document.components.schemas.AuditEvent);
  assert(
    schema.includes("redacted") && schema.includes("details"),
    "redacted audit shape is missing",
  );
  assert(
    !/password|secret|token|credential|recoveryCode/i.test(schema),
    "audit response advertises a sensitive field",
  );
  const auditEvent = document.components.schemas.AuditEvent as {
    readonly properties?: {
      readonly details?: {
        readonly additionalProperties?: boolean;
        readonly properties?: Readonly<
          Record<
            string,
            { readonly enum?: readonly string[]; readonly type?: string }
          >
        >;
      };
    };
  };
  const details = auditEvent.properties?.details;
  const detailProperties = details?.properties ?? {};
  assert(
    details?.additionalProperties === false &&
      Object.keys(detailProperties).length === 14 &&
      !document.components.schemas.AuditDetail,
    "audit details are not a closed position-aware contract",
  );
  assert(
    detailProperties.current?.type === "boolean" &&
      JSON.stringify(detailProperties.role?.enum) ===
        JSON.stringify(["admin", "member", "owner"]) &&
      detailProperties.action?.enum?.includes("save") === true &&
      ["create", "delete", "update"].every((value) =>
        detailProperties.action?.enum?.includes(value)
      ) &&
      detailProperties.section?.enum?.includes("tags") === true &&
      detailProperties.action?.enum?.includes("edit") === false &&
      !detailProperties.isYearApproximate && !detailProperties.precision,
    "audit details do not discriminate the current safe writer values",
  );
  const dateDetail = document.components.schemas.AuditDateDetail as {
    readonly additionalProperties?: boolean;
  };
  assert(
    dateDetail.additionalProperties === false,
    "nested audit date details accept arbitrary fields",
  );
  assert(
    typeof listWorkspaceAudit === "function" &&
      typeof listPersonAudit === "function",
    "generated client omitted an authorized audit surface",
  );
});
import { buildOpenApiDocument } from "./generate.ts";
import {
  acceptLegalDocument,
  getLegalRequirements,
  getPublicLegalDocument,
  listPersonAudit,
  listWorkspaceAudit,
} from "../../packages/contracts/generated/auth-client.ts";

Deno.test("GOVERNANCE-001 contract publishes immutable version review and acceptance", () => {
  const document = buildOpenApiDocument() as unknown as {
    readonly paths: Readonly<Record<string, Record<string, unknown>>>;
    readonly components: {
      readonly schemas: Readonly<Record<string, unknown>>;
    };
  };
  assert(
    document.paths["/api/v1/legal-documents/{documentType}"]?.get &&
      document.paths["/api/v1/legal-requirements"]?.get &&
      document.paths["/api/v1/legal-acceptances"]?.post,
    "version review or acceptance operation is missing",
  );
  assert(
    JSON.stringify(document.components.schemas.LegalAccepted).includes(
      "already-accepted",
    ) &&
      typeof getPublicLegalDocument === "function" &&
      typeof getLegalRequirements === "function" &&
      typeof acceptLegalDocument === "function",
    "immutable acceptance contract or generated client is incomplete",
  );
});
