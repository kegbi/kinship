import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import {
  PERSON_FILE_MAX_BYTES,
  type PersonFileManagement,
  type StorageSettings,
} from "../../packages/backend/modules/files/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface FileHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly files: PersonFileManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly storageSettings?: StorageSettings;
}

const uuid = z.uuid();
const kind = z.enum(["document", "photo"]);

function problem(
  context: Context,
  status: ContentfulStatusCode,
  code: string,
  title: string,
  detail: string,
): Response {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

async function actor(context: Context, services: FileHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

function requireOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

async function boundedBytes(request: Request): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > PERSON_FILE_MAX_BYTES) {
    return undefined;
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > PERSON_FILE_MAX_BYTES) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function unavailable(context: Context, status: string): Response {
  if (status === "not-found") {
    return problem(
      context,
      404,
      "person_file_not_found",
      "File not found",
      "No file with this opaque identifier exists for this person in the active workspace.",
    );
  }
  if (status === "forbidden") {
    return problem(
      context,
      403,
      "files_forbidden",
      "Files unavailable",
      "Your active workspace membership no longer permits this action.",
    );
  }
  if (status === "missing") {
    return problem(
      context,
      410,
      "file_missing",
      "File bytes missing",
      "The file metadata remains visible, but its stored bytes are missing.",
    );
  }
  if (status === "quarantined") {
    return problem(
      context,
      423,
      "file_quarantined",
      "File quarantined",
      "This file cannot be opened while it is quarantined.",
    );
  }
  if (status === "processing") {
    return problem(
      context,
      409,
      "file_processing",
      "File processing",
      "This file is not ready to open yet.",
    );
  }
  if (status === "deleted") {
    return problem(
      context,
      410,
      "file_deleted",
      "File removed",
      "This file has been removed.",
    );
  }
  if (status === "storage-limit") {
    return problem(
      context,
      413,
      "file_storage_limit",
      "File too large",
      `Files must be ${PERSON_FILE_MAX_BYTES} bytes or smaller.`,
    );
  }
  if (status === "rejected-media") {
    return problem(
      context,
      415,
      "file_media_rejected",
      "File type rejected",
      "Choose a supported PDF, document, text, JPEG, PNG, or WebP file.",
    );
  }
  if (status === "validation-error") {
    return problem(
      context,
      400,
      "file_invalid",
      "Invalid file",
      "Provide a non-empty filename, title, and file body.",
    );
  }
  return problem(
    context,
    503,
    "files_unavailable",
    "Files unavailable",
    "The file service is temporarily unavailable.",
  );
}

function attachmentFilename(filename: string): string {
  const fallback = filename.replace(/[\r\n"\\]/g, "_").replace(
    /[^\x20-\x7e]/g,
    "_",
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${
    encodeURIComponent(filename)
  }`;
}

function decodedHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return undefined;
  }
}

export function createFileRoutes(services: FileHttpServices): Hono {
  const routes = new Hono();

  routes.get("/api/v1/settings/storage", async (context) => {
    const parsed = z.string().trim().max(100).optional().safeParse(
      context.req.query("query"),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "storage_lookup_invalid",
        "Invalid file lookup",
        "Search terms must be 100 characters or fewer.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.storageSettings?.get(
      resolved,
      parsed.data,
    ).catch(() => ({ status: "unavailable" as const }));
    if (result?.status === "forbidden") {
      return problem(
        context,
        403,
        "storage_settings_forbidden",
        "Storage settings forbidden",
        "Only an active workspace owner or administrator may view storage diagnostics.",
      );
    }
    if (result?.status === "validation-error") {
      return problem(
        context,
        400,
        "storage_lookup_invalid",
        "Invalid file lookup",
        "Search terms must be 100 characters or fewer.",
      );
    }
    if (!result || result.status !== "ready") {
      return problem(
        context,
        503,
        "storage_settings_unavailable",
        "Storage diagnostics unavailable",
        "Workspace storage diagnostics could not be loaded.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post("/api/v1/people/:personId/files", async (context) => {
    const originFailure = requireOrigin(context, services.browserSecurity);
    if (originFailure) return originFailure;
    const personId = uuid.safeParse(context.req.param("personId"));
    const fileKind = kind.safeParse(context.req.header("X-File-Kind"));
    const filename = decodedHeader(context.req.header("X-File-Name"));
    const title = decodedHeader(context.req.header("X-File-Title"));
    const mimeType = context.req.header("Content-Type")?.split(";", 1)[0]
      ?.trim();
    if (
      !personId.success || !fileKind.success || !filename || !title || !mimeType
    ) {
      return unavailable(context, "validation-error");
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const bytes = await boundedBytes(context.req.raw).catch(() => undefined);
    if (!bytes) return unavailable(context, "storage-limit");
    const result = await services.files.upload(resolved, personId.data, {
      bytes,
      filename,
      kind: fileKind.data,
      mimeType,
      title,
    }).catch(() => ({ status: "unavailable" as const }));
    if (result.status !== "created") return unavailable(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json({ file: result.file, status: "created" }, 201);
  });

  routes.get("/api/v1/people/:personId/files", async (context) => {
    const personId = uuid.safeParse(context.req.param("personId"));
    if (!personId.success) return unavailable(context, "not-found");
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.files.list(resolved, personId.data).catch(
      () => ({ status: "unavailable" as const }),
    );
    if (result.status !== "ready") return unavailable(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json({ files: result.files, status: "ready" });
  });

  routes.get(
    "/api/v1/people/:personId/files/:fileId/content",
    async (context) => {
      const personId = uuid.safeParse(context.req.param("personId"));
      const fileId = uuid.safeParse(context.req.param("fileId"));
      if (!personId.success || !fileId.success) {
        return unavailable(
          context,
          "not-found",
        );
      }
      const resolved = await actor(context, services);
      if (!resolved) {
        return problem(
          context,
          401,
          "session_invalid",
          "Authentication required",
          "Sign in with an active workspace membership.",
        );
      }
      const result = await services.files.download(
        resolved,
        personId.data,
        fileId.data,
      ).catch(() => ({ status: "unavailable" as const }));
      if (result.status !== "ready") return unavailable(context, result.status);
      return new Response(result.bytes.slice().buffer, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": attachmentFilename(result.file.filename),
          "Content-Length": String(result.bytes.byteLength),
          "Content-Type": result.file.mimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );

  routes.delete("/api/v1/people/:personId/files/:fileId", async (context) => {
    const originFailure = requireOrigin(context, services.browserSecurity);
    if (originFailure) return originFailure;
    const personId = uuid.safeParse(context.req.param("personId"));
    const fileId = uuid.safeParse(context.req.param("fileId"));
    if (!personId.success || !fileId.success) {
      return unavailable(context, "not-found");
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.files.remove(
      resolved,
      personId.data,
      fileId.data,
    ).catch(() => ({ status: "unavailable" as const }));
    if (result.status !== "removed") return unavailable(context, result.status);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  return routes;
}
