import { createFileRoutes } from "./routes.ts";
import type { PersonFileManagement, StorageSettings } from "../../public.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";

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
    browserSecurity: { origin: "http://localhost", secureCookie: false },
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

Deno.test("[GAP-023] file listing forwards one page and refuses a malformed query", async () => {
  const received: unknown[] = [];
  const routes = app({
    list: (_actor, _personId, input) => {
      received.push(input);
      return Promise.resolve(
        input?.cursor === "foreign"
          ? { status: "validation-error" as const }
          : {
            files: [visibleFile],
            ...(input?.cursor ? {} : { nextCursor: "next-file-page" }),
            status: "ready" as const,
          },
      );
    },
  });
  const headers = {
    cookie: "kinship_session=session",
    "X-Workspace-Id": workspaceId,
  };
  const path = `http://localhost/api/v1/people/${personId}/files`;
  const first = await routes.request(path, { headers });
  assertStatus(first, 200, "first page served");
  const firstBody = await first.json() as { readonly nextCursor?: string };
  assert(firstBody.nextCursor === "next-file-page", "continuation published");
  const second = await routes.request(`${path}?limit=5&cursor=resume`, {
    headers,
  });
  assertStatus(second, 200, "second page served");
  assert(
    !("nextCursor" in (await second.json() as Record<string, unknown>)),
    "the last page carries no continuation",
  );
  assert(
    JSON.stringify(received) ===
      JSON.stringify([{ limit: 20 }, { cursor: "resume", limit: 5 }]),
    "the default and the requested page reached the use case",
  );
  for (const query of ["limit=0", "limit=51", "limit=many", "cursor=foreign"]) {
    const refused = await routes.request(`${path}?${query}`, { headers });
    assertStatus(refused, 400, `${query} refused`);
    assert(
      (await refused.json() as { readonly code?: string }).code ===
        "file_query_invalid",
      `${query} names the file query`,
    );
  }
});

Deno.test("[PEOPLE-007] D3: an avatar's content is cached privately for a day; a document is never stored", async () => {
  const served = (kind: "avatar" | "document" | "photo") =>
    app({
      download: () =>
        Promise.resolve({
          bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          file: { ...visibleFile, kind, mimeType: "image/png" },
          status: "ready",
        }),
    }).request(
      `http://localhost/api/v1/people/${personId}/files/${fileId}/content`,
      {
        headers: {
          cookie: "kinship_session=session",
          "X-Workspace-Id": workspaceId,
        },
      },
    );

  const avatar = await served("avatar");
  assertStatus(avatar, 200, "the avatar is served");
  assert(
    avatar.headers.get("cache-control") ===
      "private, max-age=86400, immutable",
    `an avatar's file id is its version: ${
      avatar.headers.get("cache-control")
    }`,
  );
  for (const kind of ["document", "photo"] as const) {
    const response = await served(kind);
    assertStatus(response, 200, `the ${kind} is served`);
    assert(
      response.headers.get("cache-control") === "private, no-store",
      `a ${kind} stays out of every cache`,
    );
  }
});
