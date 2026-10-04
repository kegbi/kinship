import { createImportRoutes } from "./imports.ts";
import {
  createImportManagement,
  CSV_TARGETS,
  type ImportRepository,
} from "../../public.ts";
import {
  CSV_COLUMN_TARGETS,
  importReport,
} from "../../../../../contracts/schemas/imports.ts";

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
      sourceSystem: "monica",
      status: "dry_run",
    }),
  list: () => Promise.resolve([]),
  prepareCommit: (_actor, importId) =>
    Promise.resolve({
      avatars: [],
      contacts: [{
        archived: false,
        entityId: crypto.randomUUID(),
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
  contactTypes: {
    forImport: () => Promise.resolve([]),
    createForImport: () => Promise.resolve("created-type"),
    byKind: () => Promise.resolve({}),
  },
  contacts: {
    history: () => Promise.resolve({ fileImportedBefore: false, matches: [] }),
    lockPendingCsv: () => Promise.resolve(undefined),
    mapCsv: () => Promise.resolve(),
    stageContacts: () => Promise.resolve(),
    stagePendingCsv: () => Promise.resolve(),
  },
  files: { representMissing: () => Promise.resolve() },
  ids: { next: () => crypto.randomUUID() },
  notes: { addNote: () => Promise.resolve() },
  people: {
    addContactMethods: () => Promise.resolve(),
    addDetails: () => Promise.resolve(),
    create: () => Promise.resolve(),
    presence: () => Promise.resolve("active" as const),
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
      mapColumns: () => Promise.resolve({ status: "not-found" }),
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

Deno.test("[IMPORT-002] import HTTP stages a CSV preview and applies its mapping", async () => {
  const calls: unknown[] = [];
  const pendingId = "00000000-0000-4000-8000-000000000042";
  const target = createImportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    imports: {
      ...imports,
      dryRun: () =>
        Promise.resolve({
          importId: pendingId,
          preview: {
            delimiter: ",",
            headers: ["Name"],
            rowCount: 1,
            rows: [["Ada"]],
            suggested: ["givenName"],
          },
          status: "mapping",
        }),
      mapColumns: (_actor, importId, columns) => {
        calls.push([importId, columns]);
        return Promise.resolve(
          columns[0] === "note"
            ? {
              detail: "Map at least one column to a name, email, or phone.",
              status: "invalid-mapping",
            }
            : importId === pendingId
            ? {
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
              status: "dry_run",
            }
            : { status: "not-found" },
        );
      },
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
  const staged = await request(target, "/api/v1/imports/dry-runs", "POST", {
    source: { format: "csv", text: "Name\r\nAda" },
  });
  if (staged.status !== 201) throw new Error("CSV preview was not staged");
  if ((await staged.json() as { status: string }).status !== "mapping") {
    throw new Error("CSV preview did not ask for a mapping");
  }
  const mapped = await request(
    target,
    `/api/v1/imports/${pendingId}/mapping`,
    "POST",
    { columns: ["givenName"] },
  );
  if (mapped.status !== 200) throw new Error("mapping was not applied");
  const refusals: readonly [string, unknown, number, string][] = [
    [pendingId, { columns: ["note"] }, 400, "import_mapping_invalid"],
    [pendingId, { columns: ["shoeSize"] }, 400, "import_mapping_invalid"],
    [pendingId, { columns: [] }, 400, "import_mapping_invalid"],
    ["not-a-uuid", { columns: ["givenName"] }, 404, "import_not_found"],
    [crypto.randomUUID(), { columns: ["givenName"] }, 404, "import_not_found"],
  ];
  for (const [id, body, status, code] of refusals) {
    const response = await request(
      target,
      `/api/v1/imports/${id}/mapping`,
      "POST",
      body,
    );
    const problem = await response.json() as { code: string };
    if (response.status !== status || problem.code !== code) {
      throw new Error(
        `${JSON.stringify(body)} answered ${response.status} ${problem.code}`,
      );
    }
  }
  if (
    (await request(
      target,
      `/api/v1/imports/${pendingId}/mapping`,
      "POST",
      { columns: ["givenName"] },
      "http://evil.test",
    )).status !== 403
  ) throw new Error("origin not enforced on mapping");
  if (calls.length !== 3) {
    throw new Error(`the use case saw ${calls.length} mappings`);
  }
});

Deno.test("[GAP-050] the mapping targets the domain applies are the ones the contract publishes", () => {
  if (JSON.stringify(CSV_TARGETS) !== JSON.stringify(CSV_COLUMN_TARGETS)) {
    throw new Error(
      `CSV targets drifted: ${JSON.stringify(CSV_TARGETS)} vs ${
        JSON.stringify(CSV_COLUMN_TARGETS)
      }`,
    );
  }
});

Deno.test("[IMPORT-001] commit validates explicit contact-type choices and reports stale mappings", async () => {
  const calls: unknown[] = [];
  const target = createImportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    imports: {
      ...imports,
      commit: (_actor, _id, _confirmed, choices) => {
        calls.push(choices);
        return Promise.resolve({
          status: "contact-type-decision-required" as const,
        });
      },
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
  const response = await request(
    target,
    `/api/v1/imports/${importId}/commit`,
    "POST",
    {
      confirmed: true,
      contactMethodTypes: [{ sourceKey: "7:2", action: "create" }],
    },
  );
  if (
    response.status !== 400 ||
    (await response.json()).code !== "import_contact_type_decision_required"
  ) throw new Error("type-choice refusal was not surfaced");
  if (
    JSON.stringify(calls) !==
      JSON.stringify([[{ sourceKey: "7:2", action: "create" }]])
  ) throw new Error("approved type choices did not reach the use case");
  const malformed = await request(
    target,
    `/api/v1/imports/${importId}/commit`,
    "POST",
    {
      confirmed: true,
      contactMethodTypes: [{ sourceKey: "7:2", action: "invent" }],
    },
  );
  if (malformed.status !== 400 || calls.length !== 1) {
    throw new Error("invalid type choice reached the use case");
  }
});

Deno.test("[IMPORT-001] unused catalog proposals satisfy the strict response contract", async () => {
  const response = await request(app(), "/api/v1/imports/dry-runs", "POST", {
    source: {
      format: "monica-json",
      version: 1,
      tables: {
        contacts: [],
        contact_field_types: [{
          id: 1,
          name: "Unused",
          type: "custom",
          fontawesome_icon: "fa-unused",
          delible: 0,
          created_at: "2020-01-01 00:00:00",
        }],
      },
    },
  });
  if (response.status !== 201) {
    throw new Error("unused catalog response failed");
  }
  const body = await response.json();
  const report = importReport.parse(body.report);
  if (report.contactMethodTypes?.proposals[0]?.count !== 0) {
    throw new Error("unused type proposal missing");
  }
});

Deno.test("[IMPORT-001] HTTP carries Monica choices and exposes missing, duplicate and foreign-choice refusals", async () => {
  const seen: unknown[] = [];
  const target = createImportRoutes({
    browserSecurity: { origin: "http://localhost", secureCookie: false },
    imports: {
      ...imports,
      commit: (_a, _id, _confirmed, _types, choices) => {
        seen.push(choices);
        return Promise.resolve({ status: "monica-choice-required" });
      },
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
  for (
    const monicaChoices of [undefined, {
      timezone: "UTC",
      currencies: [{ sourceKey: "1", currencyCode: "EUR" }, {
        sourceKey: "1",
        currencyCode: "EUR",
      }],
      genders: [],
    }, {
      timezone: "UTC",
      currencies: [],
      genders: [{
        sourceKey: "1",
        action: "map",
        genderId: crypto.randomUUID(),
      }],
    }]
  ) {
    const result = await request(
      target,
      `/api/v1/imports/${crypto.randomUUID()}/commit`,
      "POST",
      { confirmed: true, ...(monicaChoices ? { monicaChoices } : {}) },
    );
    if (
      result.status !== 400 ||
      (await result.json()).code !== "import_monica_choice_required"
    ) throw new Error("choice refusal was not published");
  }
  const result = await request(
    target,
    `/api/v1/imports/${crypto.randomUUID()}/commit`,
    "POST",
    {
      confirmed: true,
      monicaChoices: {
        timezone: "UTC",
        currencies: [{ sourceKey: "1", currencyCode: "eur" }],
        genders: [],
      },
    },
  );
  if (result.status !== 400 || seen.length !== 3) {
    throw new Error("invalid shape reached use case");
  }
});
