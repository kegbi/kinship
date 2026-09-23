import { createImportRoutes } from "./imports.ts";
import { createImportManagement, type ImportRepository } from "../../public.ts";

const actor = {
  memberId: crypto.randomUUID(),
  role: "admin" as const,
  userId: crypto.randomUUID(),
  workspaceId: crypto.randomUUID(),
};
const repository: ImportRepository = {
  complete: () => Promise.resolve(),
  get: (_actor, importId) =>
    Promise.resolve({
      createdAt: new Date().toISOString(),
      importId,
      report: {
        counts: {
          contacts: 1,
          legacyCredentialsDiscarded: 0,
          missingFiles: 0,
          orphans: 0,
          unsupported: 0,
        },
        diagnostics: [],
      },
      sourceProfile: "json_export",
      status: "dry_run",
    }),
  list: () => Promise.resolve([]),
  prepareCommit: (_actor, importId) =>
    Promise.resolve({
      avatars: [],
      contacts: [{
        archived: false,
        givenName: "Ada",
        isDeceased: false,
        isPartial: false,
        isStarred: false,
        sourcePrimaryKey: "1",
        targetPersonId: crypto.randomUUID(),
      }],
      importId,
      status: "ready",
    }),
  retargetContact: () => Promise.resolve(),
  stage: (command) =>
    Promise.resolve({
      importId: command.importId,
      report: command.report,
      status: "dry_run",
    }),
};
const imports = createImportManagement({
  actors: { revalidate: () => Promise.resolve("active" as const) },
  audit: { record: () => Promise.resolve() },
  files: { representMissing: () => Promise.resolve() },
  ids: { next: () => crypto.randomUUID() },
  people: {
    create: () => Promise.resolve(),
    exists: () => Promise.resolve(true),
    linkAvatar: () => Promise.resolve(),
  },
  repository,
  transaction: { run: (work) => work({ opaque: {} }) },
});
function app(role: "admin" | "member" = "admin") {
  return createImportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    imports,
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          ...actor,
          role,
          workspaceName: "Import",
          accessibleWorkspaces: [],
        }),
    },
  });
}
const source = {
  format: "monica-json",
  version: 1,
  tables: { contacts: [{ id: 1, first_name: "Ada" }] },
};
function request(
  target: ReturnType<typeof app>,
  path: string,
  method = "GET",
  body?: unknown,
  origin = "http://localhost",
) {
  return target.request(`http://localhost${path}`, {
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      cookie: "kinship_session=valid",
      "content-type": "application/json",
      origin,
    },
    method,
  });
}

Deno.test("[IMPORT-001] import HTTP exposes protected dry-run, report, and explicit commit", async () => {
  const target = app();
  const dry = await request(target, "/api/v1/imports/dry-runs", "POST", {
    source,
  });
  const dryBody = await dry.json() as { importId: string };
  if (dry.status !== 201) throw new Error("dry-run endpoint failed");
  const report = await request(target, `/api/v1/imports/${dryBody.importId}`);
  const commit = await request(
    target,
    `/api/v1/imports/${dryBody.importId}/commit`,
    "POST",
    { confirmed: true },
  );
  if (report.status !== 200 || commit.status !== 200) {
    throw new Error("report or commit endpoint failed");
  }
  if (
    (await request(
      target,
      "/api/v1/imports/dry-runs",
      "POST",
      { source },
      "http://evil.test",
    )).status !== 403
  ) throw new Error("origin not enforced");
  if (
    (await request(
      target,
      `/api/v1/imports/${dryBody.importId}/commit`,
      "POST",
      { confirmed: false },
    )).status !== 400
  ) throw new Error("confirmation not enforced");
  if ((await app().request("http://localhost/api/v1/imports")).status !== 401) {
    throw new Error("authentication not enforced");
  }
  if ((await request(app("member"), "/api/v1/imports")).status !== 403) {
    throw new Error("role not enforced");
  }
});

Deno.test("[IMPORT-001] import HTTP bounds malformed and oversized staging", async () => {
  const target = app();
  const malformed = await target.request(
    "http://localhost/api/v1/imports/dry-runs",
    {
      body: "{",
      headers: { cookie: "kinship_session=valid", origin: "http://localhost" },
      method: "POST",
    },
  );
  const oversized = await target.request(
    "http://localhost/api/v1/imports/dry-runs",
    {
      body: "{}",
      headers: {
        cookie: "kinship_session=valid",
        origin: "http://localhost",
        "content-length": "1501025",
      },
      method: "POST",
    },
  );
  if (malformed.status !== 400 || oversized.status !== 413) {
    throw new Error("source bounds unavailable");
  }
  if (
    (await request(target, "/api/v1/imports/not-a-uuid")).status !== 404
  ) throw new Error("malformed report id was not concealed");
  if (
    (await request(
      target,
      "/api/v1/imports/dry-runs",
      "POST",
      { source },
      "http://evil.test",
    )).status !== 403
  ) throw new Error("dry-run origin was not enforced");
});

Deno.test("[IMPORT-001] import HTTP maps lost authority and missing reports", async () => {
  const missing = createImportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    imports: {
      commit: () => Promise.resolve({ status: "not-found" }),
      dryRun: () => Promise.resolve({ status: "forbidden" }),
      get: () => Promise.resolve({ status: "not-found" }),
      list: () => Promise.resolve({ imports: [], status: "ready" }),
    },
    protectedSessions: {
      resolve: () =>
        Promise.resolve({
          ...actor,
          workspaceName: "Import",
          accessibleWorkspaces: [],
        }),
    },
  });
  const importId = crypto.randomUUID();
  if (
    (await request(missing, `/api/v1/imports/${importId}`)).status !== 404 ||
    (await request(
        missing,
        `/api/v1/imports/${importId}/commit`,
        "POST",
        { confirmed: true },
      )).status !== 404 ||
    (await request(
        missing,
        "/api/v1/imports/dry-runs",
        "POST",
        { source },
      )).status !== 403
  ) throw new Error("HTTP failure mapping unavailable");
});
