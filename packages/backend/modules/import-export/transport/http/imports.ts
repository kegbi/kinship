/**
 * Importing a Monica export, a vCard file, or a CSV file over HTTP.
 *
 * Two reads and three writes: the dry run, the CSV column mapping (GAP-050),
 * and the commit. What is left here is the staging envelope — the
 * three places a source is measured before it is parsed — and the prose each
 * refusal carries; the problem responder, the session cookie, the origin
 * check, and the kernel status map came from `packages/http-kit` (GAP-019, GAP-020), and
 * the rule that only an owner or an administrator may import moved into the
 * import use case, which now answers `forbidden` for all four paths instead of
 * two of them being decided here (GAP-020).
 *
 * The dry run does not use the shared body reader. It has to weigh the raw
 * text against its own 1.5 MB envelope before anything parses it, and then
 * weigh the `source` member again on its own, so the envelope is refused by
 * size rather than by running out of memory.
 */

import { Hono } from "hono";
import type { ImportManagement } from "../../public.ts";
import {
  IMPORT_HTTP_ENVELOPE_MAX_BYTES,
  IMPORT_SOURCE_MAX_BYTES,
} from "../../../../../contracts/imports.ts";
import {
  commitImport,
  createImportDryRun,
  getImportReport,
  listImports,
  mapImportColumns,
} from "../../../../../contracts/routes/imports.ts";
import { csvColumnMapping } from "../../../../../contracts/schemas/imports.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseValue } from "../../../../../http-kit/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;
export interface ImportHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly imports: ImportManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const IMPORT_FORBIDDEN = {
  code: "import_forbidden",
  detail: "Workspace import is available to owners and administrators only.",
  title: "Import unavailable",
} as const;
const IMPORT_NOT_FOUND: ProblemDefinition = {
  code: "import_not_found",
  detail: "This import does not exist in the active workspace.",
  status: 404,
  title: "Import unavailable",
};
const CONFIRMATION_REQUIRED: ProblemDefinition = {
  code: "import_confirmation_required",
  detail: "Confirm the validated dry-run before committing it.",
  status: 400,
  title: "Confirmation required",
};
const IMPORT_TOO_LARGE: ProblemDefinition = {
  code: "import_too_large",
  detail: "The import source exceeds the 1.5 MB staging limit.",
  status: 413,
  title: "Import too large",
};

/** What a refused read of import history says. */
export const IMPORT_HISTORY_FAILURES: FailureTable = {
  fallback: IMPORT_NOT_FOUND,
  statuses: {
    forbidden: IMPORT_FORBIDDEN,
    "not-found": {
      code: IMPORT_NOT_FOUND.code,
      detail: IMPORT_NOT_FOUND.detail,
      title: IMPORT_NOT_FOUND.title,
    },
  },
};

/**
 * What a refused dry run or commit says.
 *
 * `not-found` says "validated" where the history table does not: a commit
 * names a run the member has already seen a report for, so the sentence tells
 * them which of their runs is gone rather than that some import is missing.
 */
export const IMPORT_WRITE_FAILURES: FailureTable = {
  fallback: CONFIRMATION_REQUIRED,
  statuses: {
    "confirmation-required": {
      code: CONFIRMATION_REQUIRED.code,
      detail: CONFIRMATION_REQUIRED.detail,
      status: CONFIRMATION_REQUIRED.status,
      title: CONFIRMATION_REQUIRED.title,
    },
    forbidden: IMPORT_FORBIDDEN,
    "not-found": {
      code: "import_not_found",
      detail: "This validated import does not exist in the active workspace.",
      title: "Import unavailable",
    },
  },
};

const historyFailure = failureResponder(IMPORT_HISTORY_FAILURES);
const writeFailure = failureResponder(IMPORT_WRITE_FAILURES);

/** The rejected source, carrying the sentence the parser produced. */
export function importSourceInvalid(detail: string): ProblemDefinition {
  return {
    code: "import_invalid",
    detail,
    status: 400,
    title: "Import source invalid",
  };
}

/** The refused column mapping, carrying the sentence the rule produced. */
export function importMappingInvalid(detail: string): ProblemDefinition {
  return {
    code: "import_mapping_invalid",
    detail,
    status: 400,
    title: "Column mapping invalid",
  };
}

/** Every problem this file answers on its own, for the pinning suite. */
export const IMPORT_PROBLEMS: readonly ProblemDefinition[] = [
  CONFIRMATION_REQUIRED,
  IMPORT_NOT_FOUND,
  IMPORT_TOO_LARGE,
];

/** The byte length of a UTF-8 encoding of `value`. */
function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** The `source` member of a staging envelope, if it has one at all. */
function stagedSource(body: unknown): unknown {
  return body !== null && typeof body === "object" && !Array.isArray(body) &&
      "source" in body
    ? (body as { source: unknown }).source
    : undefined;
}

export function createImportRoutes(
  services: ImportHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, listImports, session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.imports.list(actor);
    if (result.status !== "ready") return historyFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({ imports: result.imports });
  });

  mount(routes, getImportReport, session, async (context) => {
    const importId = parseValue(uuid, context.req.param("importId"));
    if ("errors" in importId) {
      return definedProblem(context, IMPORT_NOT_FOUND);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.imports.get(actor, importId.data);
    if (result.status !== "ready") return historyFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result.import);
  });

  mount(routes, createImportDryRun, origin, session, async (context) => {
    const declared = Number(context.req.header("Content-Length") ?? 0);
    if (declared > IMPORT_HTTP_ENVELOPE_MAX_BYTES) {
      return definedProblem(context, IMPORT_TOO_LARGE);
    }
    const raw = await context.req.text();
    if (encodedBytes(raw) > IMPORT_HTTP_ENVELOPE_MAX_BYTES) {
      return definedProblem(context, IMPORT_TOO_LARGE);
    }
    const body = (() => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return undefined;
      }
    })();
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const source = stagedSource(body);
    if (
      source !== undefined &&
      encodedBytes(JSON.stringify(source)) > IMPORT_SOURCE_MAX_BYTES
    ) {
      return definedProblem(context, IMPORT_TOO_LARGE);
    }
    const result = await services.imports.dryRun(actor, source);
    if (result.status === "invalid-source") {
      return definedProblem(context, importSourceInvalid(result.detail));
    }
    if (result.status !== "dry_run" && result.status !== "mapping") {
      return writeFailure(context, result);
    }
    return context.json(result, 201);
  });

  mount(routes, mapImportColumns, origin, session, async (context) => {
    const importId = parseValue(uuid, context.req.param("importId"));
    if ("errors" in importId) {
      return definedProblem(context, IMPORT_NOT_FOUND);
    }
    const body = parseValue(
      csvColumnMapping,
      await context.req.json().catch(() => undefined),
    );
    if ("errors" in body) {
      return definedProblem(
        context,
        importMappingInvalid("Map every column, or choose Ignore for it."),
      );
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.imports.mapColumns(
      actor,
      importId.data,
      body.data.columns,
    );
    if (result.status === "invalid-mapping") {
      return definedProblem(context, importMappingInvalid(result.detail));
    }
    if (result.status !== "dry_run") return historyFailure(context, result);
    return context.json(result);
  });

  mount(
    routes,
    commitImport,
    origin,
    session,
    async (context) => {
      const importId = parseValue(uuid, context.req.param("importId"));
      const body = await context.req.json().catch(() => undefined) as
        | { readonly confirmed?: unknown }
        | undefined;
      if ("errors" in importId || body?.confirmed !== true) {
        return definedProblem(context, CONFIRMATION_REQUIRED);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.imports.commit(
        actor,
        importId.data,
        true,
      );
      if (result.status !== "completed") return writeFailure(context, result);
      return context.json(result);
    },
  );
  return routes;
}
