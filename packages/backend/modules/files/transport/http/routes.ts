/**
 * A person's files over HTTP.
 *
 * Four routes over the files a person has, and one over the workspace's
 * storage diagnostics. The problem responder, the session cookie, the origin
 * check, the kernel status map, and the download response came from `packages/http-kit`
 * (GAP-019, GAP-020).
 *
 * The upload does not use the shared body reader. It streams against its own
 * ten megabyte ceiling with the kit's `readBoundedBody` and refuses as soon as
 * the running total passes it, so a browser that ignores the declared length
 * is stopped by what it actually sent rather than by what it claimed; the
 * composition root exempts this route from the global cap for that reason.
 */

import { Hono } from "hono";
import {
  PERSON_FILE_MAX_BYTES,
  type PersonFileManagement,
  type StorageSettings,
} from "../../public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import {
  downloadPersonFile,
  getStorageSettings,
  getStorageSettingsQuery,
  listPersonFiles,
  listPersonFilesQuery,
  removePersonFile,
  uploadPersonFile,
} from "../../../../../contracts/routes/files.ts";
import { personFileKind } from "../../../../../contracts/schemas/files.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import { readBoundedBody } from "../../../../../http-kit/body_limit.ts";
import { fileDownload } from "../../../../../http-kit/downloads.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseQuery, parseValue } from "../../../../../http-kit/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface FileHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly files: PersonFileManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly storageSettings?: StorageSettings;
}

/**
 * What a refused file says.
 *
 * The three that are not refusals of the request — missing bytes, a
 * quarantined file, one still being processed — each keep their own status,
 * because a person looking at a file that will not open needs to know whether
 * to wait, to ask an administrator, or to give up.
 */
export const FILE_FAILURES: FailureTable = {
  fallback: {
    code: "files_unavailable",
    detail: "The file service is temporarily unavailable.",
    status: 503,
    title: "Files unavailable",
  },
  statuses: {
    deleted: {
      code: "file_deleted",
      detail: "This file has been removed.",
      status: 410,
      title: "File removed",
    },
    forbidden: {
      code: "files_forbidden",
      detail: "Your active workspace membership no longer permits this action.",
      title: "Files unavailable",
    },
    missing: {
      code: "file_missing",
      detail:
        "The file metadata remains visible, but its stored bytes are missing.",
      status: 410,
      title: "File bytes missing",
    },
    "not-found": {
      code: "person_file_not_found",
      detail:
        "No file with this opaque identifier exists for this person in the active workspace.",
      title: "File not found",
    },
    processing: {
      code: "file_processing",
      detail: "This file is not ready to open yet.",
      status: 409,
      title: "File processing",
    },
    quarantined: {
      code: "file_quarantined",
      detail: "This file cannot be opened while it is quarantined.",
      status: 423,
      title: "File quarantined",
    },
    "query-invalid": {
      code: "file_query_invalid",
      detail: "Reload the first page of files before continuing.",
      status: 400,
      title: "Invalid file query",
    },
    "rejected-media": {
      code: "file_media_rejected",
      detail:
        "Choose a supported PDF, document, text, JPEG, PNG, or WebP file.",
      status: 415,
      title: "File type rejected",
    },
    "storage-limit": {
      code: "file_storage_limit",
      detail: `Files must be ${PERSON_FILE_MAX_BYTES} bytes or smaller.`,
      status: 413,
      title: "File too large",
    },
    "validation-error": {
      code: "file_invalid",
      detail: "Provide a non-empty filename, title, and file body.",
      status: 400,
      title: "Invalid file",
    },
  },
};

/** What a refused look at workspace storage says. */
export const STORAGE_FAILURES: FailureTable = {
  fallback: {
    code: "storage_settings_unavailable",
    detail: "Workspace storage diagnostics could not be loaded.",
    status: 503,
    title: "Storage diagnostics unavailable",
  },
  statuses: {
    forbidden: {
      code: "storage_settings_forbidden",
      detail:
        "Only an active workspace owner or administrator may view storage diagnostics.",
      title: "Storage settings forbidden",
    },
    "validation-error": {
      code: "storage_lookup_invalid",
      detail: "Search terms must be 100 characters or fewer.",
      status: 400,
      title: "Invalid file lookup",
    },
  },
};

const failure = failureResponder(FILE_FAILURES);
const storageFailure = failureResponder(STORAGE_FAILURES);

/** A filename or title carried in a header, percent-encoded by the browser. */
function decodedHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return undefined;
  }
}

export function createFileRoutes(services: FileHttpServices): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, getStorageSettings, session, async (context) => {
    const query = parseQuery(context, getStorageSettingsQuery);
    if ("errors" in query) {
      return storageFailure(context, "validation-error");
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.storageSettings?.get(actor, query.data.query)
      .catch(
        () => ({ status: "unavailable" as const }),
      );
    if (!result || result.status !== "ready") {
      return storageFailure(context, result ?? "unavailable");
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(
    routes,
    uploadPersonFile,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const fileKind = parseValue(
        personFileKind,
        context.req.header("X-File-Kind"),
      );
      const filename = decodedHeader(context.req.header("X-File-Name"));
      const title = decodedHeader(context.req.header("X-File-Title"));
      const mimeType = context.req.header("Content-Type")?.split(";", 1)[0]
        ?.trim();
      if (
        "errors" in personId || "errors" in fileKind || !filename || !title ||
        !mimeType
      ) return failure(context, "validation-error");
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const bytes = await readBoundedBody(
        context.req.raw,
        PERSON_FILE_MAX_BYTES,
      ).catch(() => undefined);
      if (!bytes) return failure(context, "storage-limit");
      const result = await services.files.upload(actor, personId.data, {
        bytes,
        filename,
        kind: fileKind.data,
        mimeType,
        title,
      }).catch(() => ({ status: "unavailable" as const }));
      if (result.status !== "created") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({ file: result.file, status: "created" }, 201);
    },
  );

  mount(routes, listPersonFiles, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return failure(context, "not-found");
    const query = parseQuery(context, listPersonFilesQuery);
    if ("errors" in query) return failure(context, "query-invalid");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.files.list(actor, personId.data, {
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      limit: query.data.limit,
    }).catch(
      () => ({ status: "unavailable" as const }),
    );
    if (result.status === "validation-error") {
      return failure(context, "query-invalid");
    }
    if (result.status !== "ready") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      files: result.files,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      status: "ready",
    });
  });

  mount(
    routes,
    downloadPersonFile,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const fileId = parseValue(uuid, context.req.param("fileId"));
      if ("errors" in personId || "errors" in fileId) {
        return failure(context, "not-found");
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.files.download(
        actor,
        personId.data,
        fileId.data,
      ).catch(() => ({ status: "unavailable" as const }));
      if (result.status !== "ready") return failure(context, result);
      return fileDownload({
        bytes: result.bytes,
        filename: result.file.filename,
        mimeType: result.file.mimeType,
      });
    },
  );

  mount(
    routes,
    removePersonFile,
    origin,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const fileId = parseValue(uuid, context.req.param("fileId"));
      if ("errors" in personId || "errors" in fileId) {
        return failure(context, "not-found");
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.files.remove(
        actor,
        personId.data,
        fileId.data,
      ).catch(() => ({ status: "unavailable" as const }));
      if (result.status !== "removed") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  return routes;
}
