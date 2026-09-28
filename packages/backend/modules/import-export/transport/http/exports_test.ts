import { createExportRoutes } from "./exports.ts";
import type { ExportManagement, ExportManifest } from "../../public.ts";
import { assert, assertStatus } from "../../../../testing/assert.ts";

const exportId = "00000000-0000-4000-8000-000000000004";
const personId = "00000000-0000-4000-8000-000000000006";
const manifest: ExportManifest = {
  attachments: { count: 0, items: [], sha256: "a".repeat(64) },
  limitations: [],
  profile: "monica-json",
  rows: { people: { count: 1, sha256: "b".repeat(64) } },
  version: 1,
};
const summary = {
  completedAt: "2026-08-23T10:00:00.000Z",
  createdAt: "2026-08-23T10:00:00.000Z",
  expiresAt: "2026-08-30T10:00:00.000Z",
  exportId,
  format: "json" as const,
  manifest,
  status: "completed" as const,
};

function management(): ExportManagement {
  return {
    createDownload: () =>
      Promise.resolve({
        expiresAt: "2026-08-23T10:05:00.000Z",
        href: `/api/v1/exports/${exportId}/download?token=secret`,
        status: "ready",
      }),
    createWorkspace: (actor) =>
      Promise.resolve(
        actor.role === "member" ? { status: "forbidden" } : summary,
      ),
    download: (_actor, _id, token) =>
      Promise.resolve(
        token === "secret"
          ? {
            bytes: new TextEncoder().encode("{}"),
            filename: "kinship.json",
            mimeType: "application/json",
            status: "ready",
          }
          : { status: "expired" },
      ),
    exportVCard: () =>
      Promise.resolve({
        bytes: new TextEncoder().encode("BEGIN:VCARD\r\nEND:VCARD\r\n"),
        filename: "Ada.vcf",
        mimeType: "text/vcard; charset=utf-8",
        status: "ready",
      }),
    list: (actor) =>
      Promise.resolve(
        actor.role === "member"
          ? { status: "forbidden" }
          : { exports: [summary], status: "ready" },
      ),
  };
}

function app(
  role: "admin" | "member" = "admin",
  exports: ExportManagement = management(),
) {
  return createExportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    exports,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          accessibleWorkspaces: [],
          memberId: crypto.randomUUID(),
          role,
          userId: crypto.randomUUID(),
          workspaceId: crypto.randomUUID(),
          workspaceName: "Export",
        }),
    },
  });
}
function request(
  target: ReturnType<typeof app>,
  path: string,
  method = "GET",
  origin = "http://localhost",
) {
  return target.request(`http://localhost${path}`, {
    headers: { cookie: "kinship_session=valid", origin },
    method,
  });
}

Deno.test("[EXPORT-001] export HTTP creates history and short-lived downloads", async () => {
  const target = app();
  assert(
    (await request(target, "/api/v1/exports", "GET")).status === 200,
    "history available",
  );
  assert(
    (await request(target, "/api/v1/exports", "POST")).status === 201,
    "export created",
  );
  assert(
    (await request(target, `/api/v1/exports/${exportId}/downloads`, "POST"))
      .status === 201,
    "download issued",
  );
  const download = await request(
    target,
    `/api/v1/exports/${exportId}/download?token=secret`,
  );
  assertStatus(download, 200, "download succeeds");
  assert(
    download.headers.get("content-disposition")?.includes("kinship.json"),
    "safe attachment response",
  );
  assert(
    (await request(target, `/api/v1/exports/${exportId}/download?token=stale`))
      .status === 410,
    "expired reference rejected",
  );
});

Deno.test("[EXPORT-001] export HTTP enforces scope while allowing member vCard", async () => {
  const member = app("member");
  assert(
    (await request(member, "/api/v1/exports")).status === 403,
    "member history rejected",
  );
  assert(
    (await request(member, "/api/v1/exports", "POST")).status === 403,
    "member workspace export rejected",
  );
  assert(
    (await request(member, `/api/v1/people/${personId}/vcard`)).status === 200,
    "member vCard allowed",
  );
  assert(
    (await request(app(), "/api/v1/exports", "POST", "http://evil.test"))
      .status === 403,
    "origin enforced",
  );
  assert(
    (await app().request("http://localhost/api/v1/exports")).status === 401,
    "session enforced",
  );
  assert(
    (await request(app(), "/api/v1/exports/not-a-uuid/downloads", "POST"))
      .status === 404,
    "malformed id concealed",
  );
});

Deno.test("[EXPORT-001] export HTTP maps concealed, expired, and unavailable states", async () => {
  const defaults = management();
  const unavailable = app("admin", {
    ...defaults,
    list: () => Promise.resolve({ status: "unavailable" } as never),
  });
  assert(
    (await request(unavailable, "/api/v1/exports")).status === 503,
    "history failure mapped",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        createWorkspace: () => Promise.resolve({ status: "unavailable" }),
      }),
      "/api/v1/exports",
      "POST",
    )).status === 503,
    "creation failure mapped",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        createWorkspace: () => Promise.resolve({ status: "too-large" }),
      }),
      "/api/v1/exports",
      "POST",
    )).status === 413,
    "oversized export mapped",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        createDownload: () => Promise.resolve({ status: "not-found" }),
      }),
      `/api/v1/exports/${exportId}/downloads`,
      "POST",
    )).status === 404,
    "missing download concealed",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        createDownload: () =>
          Promise.resolve({ status: "unavailable" } as never),
      }),
      `/api/v1/exports/${exportId}/downloads`,
      "POST",
    )).status === 503,
    "reference failure mapped",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        download: () => Promise.resolve({ status: "not-found" }),
      }),
      `/api/v1/exports/${exportId}/download?token=x`,
    )).status === 404,
    "missing artifact concealed",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        download: () => Promise.resolve({ status: "unavailable" }),
      }),
      `/api/v1/exports/${exportId}/download?token=x`,
    )).status === 503,
    "artifact failure mapped",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        exportVCard: () => Promise.resolve({ status: "not-found" }),
      }),
      `/api/v1/people/${personId}/vcard`,
    )).status === 404,
    "missing vCard concealed",
  );
  assert(
    (await request(
      app("admin", {
        ...defaults,
        exportVCard: () => Promise.resolve({ status: "unavailable" } as never),
      }),
      `/api/v1/people/${personId}/vcard`,
    )).status === 503,
    "vCard failure mapped",
  );
  assert(
    (await request(app(), `/api/v1/exports/${exportId}/download`)).status ===
      404,
    "missing token concealed",
  );
  assert(
    (await request(app(), "/api/v1/people/not-a-uuid/vcard")).status === 404,
    "malformed person concealed",
  );
  assert(
    (await request(
      app(),
      `/api/v1/people/${personId}/vcard?workspaceId=not-a-uuid`,
    )).status === 404,
    "malformed workspace selection concealed",
  );
  assert(
    (await request(
      app(),
      `/api/v1/exports/${exportId}/downloads`,
      "POST",
      "http://evil.test",
    )).status === 403,
    "download mint origin enforced",
  );
});

Deno.test("[GAP-020] every export route names its own outage and needs a session", async () => {
  const offline = () => Promise.reject(new Error("offline"));
  const target = app("admin", {
    createDownload: offline,
    createWorkspace: offline,
    download: offline,
    exportVCard: offline,
    list: offline,
  } as unknown as ExportManagement);
  const routes = [
    {
      detail: "Export history could not be loaded.",
      method: "GET",
      path: "/api/v1/exports",
    },
    {
      detail: "The export artifact could not be completed.",
      method: "POST",
      path: "/api/v1/exports",
    },
    {
      detail: "A download reference could not be issued.",
      method: "POST",
      path: `/api/v1/exports/${exportId}/downloads`,
    },
    {
      detail: "The export artifact could not be read.",
      method: "GET",
      path: `/api/v1/exports/${exportId}/download?token=secret`,
    },
    {
      detail: "This person could not be exported right now.",
      method: "GET",
      path: `/api/v1/people/${personId}/vcard`,
    },
  ];

  for (const route of routes) {
    const outage = await request(target, route.path, route.method);
    const anonymous = await target.request(`http://localhost${route.path}`, {
      headers: { origin: "http://localhost" },
      method: route.method,
    });
    assertStatus(outage, 503, `${route.path} reports its own outage`);
    assert(
      ((await outage.json()) as { readonly detail: string }).detail ===
        route.detail,
      `${route.path} says what did not happen`,
    );
    assertStatus(anonymous, 401, `${route.path} needs a session`);
  }
});

Deno.test("[EXPORT-002] export HTTP asks for the format the body names", async () => {
  const asked: string[] = [];
  const exports = management();
  const target = app("admin", {
    ...exports,
    createWorkspace: (actor, format) => {
      asked.push(format ?? "(none)");
      return exports.createWorkspace(actor, format);
    },
  });
  const post = (body: string) =>
    target.request("http://localhost/api/v1/exports", {
      body,
      headers: {
        "content-type": "application/json",
        cookie: "kinship_session=valid",
        origin: "http://localhost",
      },
      method: "POST",
    });
  assertStatus(await post(JSON.stringify({ format: "csv" })), 201, "csv");
  assertStatus(await post(JSON.stringify({ format: "vcard" })), 201, "vcard");
  assertStatus(await post(JSON.stringify({})), 201, "no format");
  assertStatus(await post(""), 201, "no body");
  assert(asked.join() === "csv,vcard,json,json", asked.join());
  for (const body of [JSON.stringify({ format: "sql" }), "{", "[]"]) {
    const refused = await post(body);
    assertStatus(refused, 400, body);
    assert(
      (await refused.json() as { code: string }).code ===
        "export_format_invalid",
      "the refusal names the format",
    );
  }
  assert(asked.length === 4, "a refused format never reaches the use case");
});
