/**
 * A form validated by the contract it submits to.
 *
 * `packages/contracts/schemas` holds the Zod schemas the API parses every
 * request with. An island's form validates against the same schema through
 * react-hook-form's Zod resolver, so the browser refuses exactly what the
 * server would, with the same Zod the API runs (ADR 0006). What the server
 * still refuses comes back as an RFC 9457 problem; `applyProblem` puts each of
 * its field errors on the field it names and keeps the detail on the form
 * root, so a surface shows both without re-deriving either.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback } from "react";
import {
  type FieldPath,
  type FieldValues,
  type Resolver,
  useForm,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { z } from "zod";
import type { ProblemDetails } from "../../../../../packages/contracts/generated/auth-client.ts";

/**
 * The form path a problem's `errors` key names. Keys are field names today;
 * an RFC 6901 pointer such as `/detail/body` is read as `detail.body`.
 */
export function problemFieldName(key: string): string {
  if (!key.startsWith("/")) return key;
  return key.slice(1).split("/").map((segment) =>
    segment.replaceAll("~1", "/").replaceAll("~0", "~")
  ).join(".");
}

/**
 * Zod's own wording for a value that is simply absent names types ("expected
 * string, received undefined"); a reader is told the field is required.
 * Every other issue keeps Zod's message.
 */
function missingIsRequired(
  issue: { readonly input?: unknown },
): string | undefined {
  return issue.input === undefined ? "Required." : undefined;
}

export type ContractFormOptions<
  Input extends FieldValues,
  Output extends FieldValues,
> = Omit<UseFormProps<Input, unknown, Output>, "resolver">;

export type ContractForm<
  Input extends FieldValues,
  Output extends FieldValues,
> =
  & UseFormReturn<Input, unknown, Output>
  & {
    /**
     * Shows a refused submission on the form: each field error on its field
     * and the detail on `errors.root.server`. Answers the fields it marked.
     */
    readonly applyProblem: (problem: ProblemDetails) => readonly string[];
  };

/**
 * react-hook-form over `schema`. `Input` is what the fields hold and
 * `Output` what a valid submission hands `handleSubmit`, as the schema
 * parses it.
 */
export function useContractForm<
  Output extends FieldValues,
  Input extends FieldValues,
>(
  schema: z.ZodType<Output, Input>,
  options: ContractFormOptions<Input, Output> = {},
): ContractForm<Input, Output> {
  const resolver: Resolver<Input, unknown, Output> = zodResolver(schema, {
    error: missingIsRequired,
  });
  const form = useForm<Input, unknown, Output>({ ...options, resolver });
  const { getValues, setError } = form;
  const applyProblem = useCallback((problem: ProblemDetails) => {
    const fields = new Set(Object.keys(getValues()));
    const marked: string[] = [];
    for (const [key, message] of Object.entries(problem.errors ?? {})) {
      const name = problemFieldName(key);
      if (!fields.has(name.split(".")[0]!)) continue;
      setError(name as FieldPath<Input>, {
        message,
        type: "server",
      });
      marked.push(name);
    }
    setError("root.server", { message: problem.detail, type: "server" });
    return marked;
  }, [getValues, setError]);
  return { ...form, applyProblem };
}
