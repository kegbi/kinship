/** Build-time presentation of the generated bearer contract; never hydrated. */
import external from "../../../../../packages/contracts/openapi/external.json";

export interface ReferenceOperation {
  readonly operationId: string;
  readonly description: string;
  readonly parameters?: readonly {
    readonly name: string;
    readonly in: string;
    readonly required: boolean;
    readonly description?: string;
    readonly schema: Record<string, unknown>;
  }[];
  readonly requestBody?: {
    readonly required: boolean;
    readonly content: Readonly<
      Record<string, { readonly schema: Record<string, unknown> }>
    >;
  };
  readonly responses: Readonly<
    Record<string, {
      readonly description: string;
      readonly headers?: Record<string, unknown>;
      readonly content?: Readonly<
        Record<string, { readonly schema: Record<string, unknown> }>
      >;
    }>
  >;
}

// The generated JSON is checked byte-for-byte against the executable schemas.
const paths: Readonly<
  Record<string, Readonly<Record<string, ReferenceOperation>>>
> = external.paths;

export const referenceOperations = Object.entries(paths).flatMap((
  [path, methods],
) =>
  Object.entries(methods).map(([method, operation]) => ({
    path,
    method: method.toUpperCase(),
    operation,
  }))
);

export const referenceSchemas = Object.entries(external.components.schemas);

/** Links alongside exact JSON keep union refinements and parent fields intact. */
export function referencedSchemas(value: object): readonly string[] {
  return [
    ...new Set(
      [
        ...JSON.stringify(value).matchAll(
          /"\$ref":"#\/components\/schemas\/([^"/]+)"/g,
        ),
      ]
        .map((match) => match[1]!),
    ),
  ];
}
