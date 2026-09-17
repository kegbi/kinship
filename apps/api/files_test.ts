import { createFileRoutes } from "./files.ts";
import type {
  PersonFileManagement,
  StorageSettings,
} from "../../packages/backend/modules/files/public.ts";
import { browserSecurityPolicy } from "./security_config.ts";
import { resolveObjectStorageConfiguration } from "./file_storage_config.ts";
import { assert, assertStatus } from "../../packages/backend/testing/assert.ts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const fileId = "00000000-0000-4000-8000-000000000003";
const visibleFile = {
  byteSize: 4,
  createdAt: "2026-08-23T08:00:00.000Z",
  fileId,
  filename: "care plan.pdf",
  kind: "document" as const,
  mimeType: "application/pdf",
  personId,
  status: "available" as const,
  title: "Care plan",
};

function app(
  files: Partial<PersonFileManagement>,
  storageSettings: Partial<StorageSettings> = {},
  role: "admin" | "member" | "owner" = "member",
) {
  return createFileRoutes({
    browserSecurity: browserSecurityPolicy("test", "http://localhost"),
    files: files as PersonFileManagement,
    storageSettings: storageSettings as StorageSettings,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          accessibleWorkspaces: [{
            memberId: "00000000-0000-4000-8000-000000000004",
            role,
            userId: "00000000-0000-4000-8000-000000000005",
            workspaceId,
            workspaceName: "Files",
          }],
          memberId: "00000000-0000-4000-8000-000000000004",
          role,
          userId: "00000000-0000-4000-8000-000000000005",
          workspaceId,
          workspaceName: "Files",
        }),
    },
  });
}

Deno.test("[FILES-001] storage settings HTTP boundary returns only safe admin diagnostics", async () => {
  let requestedQuery = "";
  const routes = app({}, {
    get: (_actor, query) => {
      requestedQuery = query ?? "";
      return Promise.resolve({
        files: [{
          byteSize: 2048,
          createdAt: "2026-08-23T08:00:00.000Z",
          fileId,
          filename: "care-plan.pdf",
          kind: "document",
          mimeType: "application/pdf",
          personId,
          personName: "Ada Lovelace",
          status: "available",
          title: "Care plan",
        }],
        maximumUploadBytes: 10_485_760,
        provider: {
          bucket: "attachments",
          health: "available",
          name: "s3",
        },
        status: "ready",
        usage: {
          available: 1,
          missing: 0,
          processing: 0,
          quarantined: 0,
          totalBytes: 2048,
          totalFiles: 1,
        },
      });
    },
  }, "admin");
  const response = await routes.request(
    "http://localhost/api/v1/settings/storage?query=care",
    {
      headers: {
        cookie: "kinship_session=session",
        "X-Workspace-Id": workspaceId,
      },
    },
  );
  assertStatus(response, 200, "admin diagnostics ready");
  const body = await response.json();
  assert(requestedQuery === "care", "bounded query reaches facade");
  assert(!JSON.stringify(body).includes("storageKey"), "object keys concealed");
  assert(!JSON.stringify(body).includes("secret"), "credentials concealed");

  const member = app({}, {
    get: () => Promise.resolve({ status: "forbidden" }),
  });
  assert(
    (await member.request("http://localhost/api/v1/settings/storage", {
      headers: {
        cookie: "kinship_session=session",
        "X-Workspace-Id": workspaceId,
      },
    })).status === 403,
    "ordinary member inventory is forbidden",
  );
});

Deno.test("[FILES-001] file HTTP flow uploads, lists, downloads, and removes without storage references", async () => {
  const actions: string[] = [];
  const routes = app({
    upload: (_actor, requestedPersonId, input) => {
      assert(requestedPersonId === personId, "person is scoped by route");
      assert(
        input.bytes.join(",") === "37,80,68,70",
        "raw bytes are preserved",
      );
      actions.push("upload");
      return Promise.resolve({ file: visibleFile, status: "created" });
    },
    list: () => {
      actions.push("list");
      return Promise.resolve({ files: [visibleFile], status: "ready" });
    },
    download: () => {
      actions.push("download");
      return Promise.resolve({
        bytes: new Uint8Array([37, 80, 68, 70]),
        file: visibleFile,
        status: "ready",
      });
    },
    remove: () => {
      actions.push("remove");
      return Promise.resolve({ fileId, status: "removed" });
    },
  });
  const headers = {
    cookie: "kinship_session=session",
    origin: "http://localhost",
    "X-File-Kind": "document",
    "X-File-Name": "care plan.pdf",
    "X-File-Title": "Care plan",
    "X-Workspace-Id": workspaceId,
  };
  const uploaded = await routes.request(
    `http://localhost/api/v1/people/${personId}/files`,
    {
      body: new Uint8Array([37, 80, 68, 70]),
      headers: { ...headers, "content-type": "application/pdf" },
      method: "POST",
    },
  );
  assertStatus(uploaded, 201, "upload created");
  assert(
    !JSON.stringify(await uploaded.json()).includes("storage"),
    "storage key is private",
  );

  const listed = await routes.request(
    `http://localhost/api/v1/people/${personId}/files`,
    { headers },
  );
  assertStatus(listed, 200, "files list ready");
  const downloaded = await routes.request(
    `http://localhost/api/v1/people/${personId}/files/${fileId}/content`,
    { headers },
  );
  assertStatus(downloaded, 200, "download ready");
  assert(
    downloaded.headers.get("content-disposition")?.includes("attachment"),
    "download is an attachment",
  );
  assert((await downloaded.arrayBuffer()).byteLength === 4, "bytes returned");
  const removed = await routes.request(
    `http://localhost/api/v1/people/${personId}/files/${fileId}`,
    { headers, method: "DELETE" },
  );
  assertStatus(removed, 200, "remove succeeds");
  assert(
    actions.join(",") === "upload,list,download,remove",
    "one facade owns flow",
  );
});

Deno.test("[FILES-001] file HTTP flow maps limits and concealed object states", async () => {
  const outcomes = [
    ["storage-limit", 413],
    ["rejected-media", 415],
    ["not-found", 404],
    ["missing", 410],
    ["quarantined", 423],
    ["unavailable", 503],
    ["forbidden", 403],
    ["processing", 409],
    ["deleted", 410],
    ["validation-error", 400],
  ] as const;
  for (const [status, expected] of outcomes) {
    const routes = app({
      download: () => Promise.resolve({ status } as never),
      upload: () => Promise.resolve({ status } as never),
    });
    const headers = {
      cookie: "kinship_session=session",
      origin: "http://localhost",
      "X-File-Kind": "document",
      "X-File-Name": "care.pdf",
      "X-File-Title": "Care",
      "X-Workspace-Id": workspaceId,
    };
    const response = status === "storage-limit" || status === "rejected-media"
      ? await routes.request(
        `http://localhost/api/v1/people/${personId}/files`,
        {
          body: new Uint8Array([1]),
          headers: { ...headers, "content-type": "application/pdf" },
          method: "POST",
        },
      )
      : await routes.request(
        `http://localhost/api/v1/people/${personId}/files/${fileId}/content`,
        { headers },
      );
    assert(response.status === expected, `${status} maps to ${expected}`);
  }
});

Deno.test("[FILES-001] file HTTP boundary rejects invalid or unauthenticated requests and contains outages", async () => {
  const routes = app({
    list: () => Promise.reject(new Error("database unavailable")),
    remove: () => Promise.reject(new Error("database unavailable")),
  });
  const base = `http://localhost/api/v1/people/${personId}/files`;
  const workspace = { "X-Workspace-Id": workspaceId };
  assert(
    (await routes.request(base, { headers: workspace })).status === 401,
    "list requires a session",
  );
  assert(
    (await routes.request("http://localhost/api/v1/people/not-a-uuid/files", {
      headers: workspace,
    })).status === 404,
    "invalid person id is concealed",
  );
  assert(
    (await routes.request(base, {
      body: new Uint8Array([1]),
      headers: {
        cookie: "kinship_session=session",
        origin: "http://localhost",
        ...workspace,
      },
      method: "POST",
    })).status === 400,
    "upload headers are required",
  );
  assert(
    (await routes.request(base, {
      headers: { cookie: "kinship_session=session", ...workspace },
    })).status === 503,
    "list outage is contained",
  );
  assert(
    (await routes.request(`${base}/${fileId}`, {
      headers: {
        cookie: "kinship_session=session",
        origin: "http://localhost",
        ...workspace,
      },
      method: "DELETE",
    })).status === 503,
    "remove outage is contained",
  );
  assert(
    (await routes.request(`${base}/${fileId}`, {
      headers: {
        cookie: "kinship_session=session",
        origin: "https://evil.test",
        ...workspace,
      },
      method: "DELETE",
    })).status === 403,
    "remove checks origin before the facade",
  );
});

Deno.test("[FILES-001] file mutations require the configured browser origin", async () => {
  const routes = app({
    upload: () => Promise.reject(new Error("must not run")),
  });
  const response = await routes.request(
    `http://localhost/api/v1/people/${personId}/files`,
    {
      body: new Uint8Array([1]),
      headers: {
        cookie: "kinship_session=session",
        "content-type": "application/pdf",
        origin: "https://evil.test",
      },
      method: "POST",
    },
  );
  assertStatus(response, 403, "cross-origin upload is rejected");
});

Deno.test("[FILES-001] production object storage fails closed without credentials", () => {
  const values = new Map<string, string>([["APP_ENV", "production"]]);
  let failure: unknown;
  try {
    resolveObjectStorageConfiguration({ get: (key) => values.get(key) });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error &&
      failure.message.includes("required in production"),
    "production has no credential fallbacks",
  );

  values.set("OBJECT_STORAGE_ACCESS_KEY", "kinship");
  values.set("OBJECT_STORAGE_SECRET_KEY", "kinship-local-secret");
  values.set("OBJECT_STORAGE_HOST", "objects.internal");
  values.set("OBJECT_STORAGE_BUCKET", "private-files");
  failure = undefined;
  try {
    resolveObjectStorageConfiguration({ get: (key) => values.get(key) });
  } catch (error) {
    failure = error;
  }
  assert(
    failure instanceof Error,
    "production rejects known local credentials",
  );

  values.set("OBJECT_STORAGE_ACCESS_KEY", "access");
  values.set("OBJECT_STORAGE_SECRET_KEY", "secret-value");
  values.set("OBJECT_STORAGE_HOST", "objects.internal");
  values.set("OBJECT_STORAGE_BUCKET", "private-files");
  const configured = resolveObjectStorageConfiguration({
    get: (key) => values.get(key),
  });
  assert(
    configured.host === "objects.internal" && configured.useSsl === false &&
      configured.requestTimeoutMs === 30_000,
    "explicit production configuration resolves",
  );

  for (
    const [key, value] of [
      ["OBJECT_STORAGE_PORT", "0"],
      ["OBJECT_STORAGE_USE_SSL", "sometimes"],
      ["OBJECT_STORAGE_REQUEST_TIMEOUT_MS", "99"],
      ["OBJECT_STORAGE_REQUEST_TIMEOUT_MS", "120001"],
    ] as const
  ) {
    values.set(key, value);
    let invalid: unknown;
    try {
      resolveObjectStorageConfiguration({ get: (name) => values.get(name) });
    } catch (error) {
      invalid = error;
    }
    assert(invalid instanceof Error, `${key} is validated`);
    values.delete(key);
  }
});
