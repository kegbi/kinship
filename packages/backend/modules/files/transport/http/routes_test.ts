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

const tokenId = "00000000-0000-4000-8000-0000000000aa";
const tokenActor = {
  memberId: "00000000-0000-4000-8000-000000000004",
  role: "member" as const,
  userId: "00000000-0000-4000-8000-000000000005",
  workspaceId,
};

/**
 * The file routes behind a fake personal-token authority that accepts a
 * token whose secret is the scope asked for, and a coordinator that records
 * every cookie session it was asked to resolve.
 */
function tokenApp(files: Partial<PersonFileManagement>) {
  const asked: string[] = [];
  const resolved: string[] = [];
  const session = {
    memberId: tokenActor.memberId,
    role: tokenActor.role,
    userId: tokenActor.userId,
    workspaceId,
    workspaceName: "Files",
  };
  const routes = createFileRoutes({
    apiTokens: {
      authenticate: (token: string, scope: string) => {
        asked.push(scope);
        return Promise.resolve(
          token === scope
            ? { actor: tokenActor, status: "authenticated" as const, tokenId }
            : { status: "invalid" as const },
        );
      },
    },
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    files: files as PersonFileManagement,
    protectedSessions: {
      resolve: (command) => {
        resolved.push(command.sessionToken);
        return Promise.resolve({ ...session, accessibleWorkspaces: [session] });
      },
    },
    storageSettings: {
      get: () => Promise.resolve({ status: "forbidden" }),
    } as StorageSettings,
  });
  return { asked, resolved, routes };
}

/** A one-chunk body that records whether anybody pulled it. */
function watchedBody(bytes: Uint8Array) {
  const watch = { pulled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      watch.pulled = true;
      controller.enqueue(bytes);
      controller.close();
    },
  }, { highWaterMark: 0 });
  return { body, watch };
}

const uploadHeaders = {
  "content-type": "application/pdf",
  "X-File-Kind": "document",
  "X-File-Name": encodeURIComponent("care plan.pdf"),
  "X-File-Title": encodeURIComponent("Care plan"),
};

Deno.test("[MCP-B8] file grants admit bearer reads and writes independently and never borrow the cookie", async () => {
  const acted: (string | undefined)[] = [];
  const answer = (value: unknown) => (who: { apiTokenId?: string }) => {
    acted.push(who.apiTokenId);
    return Promise.resolve(value);
  };
  const { asked, resolved, routes } = tokenApp({
    download: answer({
      bytes: new Uint8Array([37, 80, 68, 70]),
      file: visibleFile,
      status: "ready",
    }) as never,
    list: answer({ files: [visibleFile], status: "ready" }) as never,
    remove: answer({ fileId, status: "removed" }) as never,
    upload: answer({ file: visibleFile, status: "created" }) as never,
  });
  const base = `http://localhost/api/v1/people/${personId}/files`;
  const cases = [
    ["GET", base, "files:read", 200],
    ["GET", `${base}/${fileId}/content`, "files:read", 200],
    ["POST", base, "files:write", 201],
    ["DELETE", `${base}/${fileId}`, "files:write", 200],
  ] as const;
  for (const [method, path, grant, status] of cases) {
    const label = `${method} ${path}`;
    const send = (headers: Record<string, string>) => {
      const upload = method === "POST"
        ? watchedBody(new Uint8Array([37, 80, 68, 70]))
        : undefined;
      return {
        response: routes.request(path, {
          ...(upload ? { body: upload.body } : {}),
          headers: { ...(upload ? uploadHeaders : {}), ...headers },
          method,
        }),
        watch: upload?.watch,
      };
    };
    acted.length = 0;
    resolved.length = 0;
    const granted = send({ authorization: `Bearer ${grant}` });
    const admitted = await granted.response;
    assert(
      admitted.status === status && acted[0] === tokenId,
      `${label} bearer without Origin or cookie answered ${admitted.status}`,
    );
    assert(
      granted.watch === undefined || granted.watch.pulled,
      `${label} an admitted upload reads its body`,
    );
    if (path.endsWith("/content")) {
      assert(
        admitted.headers.get("content-type") === "application/pdf" &&
          admitted.headers.get("content-length") === "4" &&
          admitted.headers.get("content-disposition")?.startsWith(
            `attachment; filename="care plan.pdf"`,
          ) &&
          admitted.headers.get("cache-control") === "private, no-store",
        `${label} bearer download keeps its headers`,
      );
      assert(
        (await admitted.arrayBuffer()).byteLength === 4,
        `${label} bearer download carries the bytes`,
      );
    } else {
      await admitted.body?.cancel();
    }
    for (
      const wrong of [
        "files:read",
        "files:write",
        "people:write",
        "gifts:write",
        "revoked",
      ].filter((scope) => scope !== grant)
    ) {
      const refused = send({
        authorization: `Bearer ${wrong}`,
        cookie: "kinship_session=valid",
        origin: "http://localhost",
      });
      const response = await refused.response;
      await response.body?.cancel();
      assert(
        response.status === 401,
        `${label} admitted ${wrong}: ${response.status}`,
      );
      assert(
        refused.watch === undefined || !refused.watch.pulled,
        `${label} read the body of a refused ${wrong} token`,
      );
    }
    assert(
      resolved.length === 0,
      `${label} bearer requests resolved a cookie session`,
    );
    if (method === "GET") continue;
    for (const origin of [undefined, "http://attacker.test"]) {
      const foreign = await send({
        cookie: "kinship_session=valid",
        ...(origin ? { origin } : {}),
      }).response;
      await foreign.body?.cancel();
      assert(
        foreign.status === 403,
        `${label} cookie write with Origin ${origin} answered ${foreign.status}`,
      );
    }
    acted.length = 0;
    const cookie = await send({
      cookie: "kinship_session=valid",
      origin: "http://localhost",
    }).response;
    await cookie.body?.cancel();
    assert(
      cookie.status === status && acted[0] === undefined,
      `${label} cookie write answered ${cookie.status}`,
    );
  }
  assert(
    asked.includes("files:read") && asked.includes("files:write"),
    `each grant was checked: ${asked}`,
  );
});

Deno.test("[MCP-B8] a refused bearer upload is answered before its headers or body are judged", async () => {
  const { routes } = tokenApp({
    upload: () => Promise.reject(new Error("must not run")),
  });
  const refused = watchedBody(new Uint8Array(32));
  const response = await routes.request(
    "http://localhost/api/v1/people/not-a-uuid/files",
    {
      body: refused.body,
      headers: { authorization: "Bearer files:read" },
      method: "POST",
    },
  );
  assertStatus(response, 401, "a token without files:write is refused first");
  assert(!refused.watch.pulled, "the refused upload body was never read");
  const granted = watchedBody(new Uint8Array(32));
  const invalid = await routes.request(
    `http://localhost/api/v1/people/${personId}/files`,
    {
      body: granted.body,
      headers: { authorization: "Bearer files:write" },
      method: "POST",
    },
  );
  assertStatus(invalid, 400, "an admitted bearer still needs the file headers");
  assert(!granted.watch.pulled, "headers are judged before the body is read");
});

Deno.test("[MCP-B8] cookie file routes keep their check order", async () => {
  const nobody = createFileRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    files: {} as PersonFileManagement,
    protectedSessions: { resolve: () => Promise.resolve(undefined) },
  });
  const code = async (response: Response | Promise<Response>) => {
    const answered = await response;
    const body = await answered.json() as { readonly code?: string };
    return `${answered.status} ${body.code}`;
  };
  const base = `http://localhost/api/v1/people/${personId}/files`;
  const upload = (headers: Record<string, string>) =>
    nobody.request(base, {
      body: new Uint8Array([1]),
      headers,
      method: "POST",
    });
  const uploads = [
    await code(upload({ origin: "http://attacker.test" })),
    await code(upload({
      origin: "http://localhost",
      "x-workspace-id": "not-a-workspace",
    })),
    await code(upload({ origin: "http://localhost" })),
    await code(upload({ origin: "http://localhost", ...uploadHeaders })),
  ];
  assert(
    JSON.stringify(uploads) === JSON.stringify([
      "403 origin_invalid",
      "400 workspace_header_invalid",
      "400 file_invalid",
      "401 session_invalid",
    ]),
    `cookie upload order changed: ${uploads}`,
  );
  const remove = (path: string, origin: string) =>
    nobody.request(path, { headers: { origin }, method: "DELETE" });
  const removals = [
    await code(remove(`${base}/${fileId}`, "http://attacker.test")),
    await code(remove(`${base}/not-a-uuid`, "http://localhost")),
    await code(remove(`${base}/${fileId}`, "http://localhost")),
  ];
  assert(
    JSON.stringify(removals) === JSON.stringify([
      "403 origin_invalid",
      "404 person_file_not_found",
      "401 session_invalid",
    ]),
    `cookie removal order changed: ${removals}`,
  );
  const reads = [
    await code(nobody.request("http://localhost/api/v1/people/x/files")),
    await code(nobody.request(`${base}?limit=0`)),
    await code(nobody.request(`${base}/x/content`)),
    await code(nobody.request(`${base}/${fileId}/content`)),
  ];
  assert(
    JSON.stringify(reads) === JSON.stringify([
      "404 person_file_not_found",
      "400 file_query_invalid",
      "404 person_file_not_found",
      "401 session_invalid",
    ]),
    `cookie read order changed: ${reads}`,
  );
});

Deno.test("[MCP-B8] storage diagnostics stay session-only", async () => {
  const { asked, routes } = tokenApp({});
  const response = await routes.request(
    "http://localhost/api/v1/settings/storage",
    { headers: { authorization: "Bearer files:read" } },
  );
  assertStatus(response, 401, "a bearer alone never reads storage settings");
  assert(asked.length === 0, "storage settings never ask the token authority");
});
