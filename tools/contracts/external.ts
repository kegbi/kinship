/** Bearer-only projection of the executable contract, with whole schema closure. */
import { buildOpenApiDocument } from "./document.ts";

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue {
  // This projection consumes our generated OpenAPI JSON, never network input.
  return value as ObjectValue;
}

/** Keep complete referenced components, including sibling properties/refinements. */
export function buildExternalOpenApiDocument(
  source = buildOpenApiDocument(),
): ObjectValue {
  const paths: Record<string, ObjectValue> = {};
  for (const [path, methods] of Object.entries(object(source.paths))) {
    for (const [method, value] of Object.entries(object(methods))) {
      const operation = object(value);
      const security = operation.security as ObjectValue[] | undefined;
      if (!security?.some((entry) => "kinship_api_token" in entry)) continue;
      const parameters = operation.parameters as ObjectValue[] | undefined;
      (paths[path] ??= {})[method] = {
        ...operation,
        security: [{ kinship_api_token: [] }],
        ...(parameters
          ? {
            parameters: parameters.filter((parameter) =>
              !(parameter.in === "header" && parameter.name === "Origin")
            ).map((parameter) =>
              parameter.name === "X-Workspace-Id"
                ? {
                  ...parameter,
                  description:
                    "Optional; must match the token's bound workspace. Cannot switch workspaces.",
                }
                : parameter
            ),
          }
          : {}),
      };
    }
  }

  const sourceComponents = object(source.components);
  const components: Record<string, ObjectValue> = {
    securitySchemes: {
      kinship_api_token: object(sourceComponents.securitySchemes)
        .kinship_api_token,
    },
  };
  const visited = new Set<string>();
  function visit(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const record = object(value);
    if (typeof record.$ref === "string") {
      const ref = record.$ref;
      if (!visited.has(ref)) {
        visited.add(ref);
        const match = /^#\/components\/([^/]+)\/([^/]+)$/.exec(ref);
        if (!match) throw new Error(`Non-local component reference: ${ref}`);
        const group = match[1]!;
        const name = match[2]!.replaceAll("~1", "/").replaceAll("~0", "~");
        const component = object(sourceComponents[group])[name];
        if (component === undefined) {
          throw new Error(`Unresolved reference: ${ref}`);
        }
        (components[group] ??= {})[name] = component;
        visit(component);
      }
    }
    Object.values(record).forEach(visit);
  }
  visit(paths);
  for (const [group, entries] of Object.entries(components)) {
    components[group] = Object.fromEntries(
      Object.entries(entries).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0
      ),
    );
  }
  return {
    openapi: source.openapi,
    info: { ...object(source.info), title: "Kinship public token API" },
    paths,
    components,
  };
}
