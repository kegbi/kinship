/**
 * Personal tokens over a person's files (MCP-B8), through the deployment's
 * composition, the disposable database, and an in-memory object store.
 *
 * `files:read` lists and downloads, `files:write` uploads and removes; the two
 * are independent, and neither is implied by any other grant. The upload and
 * the download are REST-only binary operations. A token acts in its one bound
 * workspace and never borrows the cookie it travels beside.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { PERSON_FILE_MAX_BYTES } from "../../packages/backend/modules/files/public.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { fakeObjectStore } from "../../packages/backend/testing/fakes.ts";
import { apiSupport, type HttpMethod, ORIGIN } from "../support/api.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { createPerson } from "../support/fixtures.ts";
import { tokenSupport } from "../support/tokens.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const storage = fakeObjectStore();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
  undefined,
  undefined,
  undefined,
  storage,
);
const app = configured.app;
const api = apiSupport(app, mail, sql);
const tokens = tokenSupport(app, api);
const register = (email: string, workspaceName: string) =>
  api.register(email, workspaceName, { firstName: "File", lastName: "Token" });

const PDF = new TextEncoder().encode("%PDF-1.7 care plan");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Upload {
  readonly bytes: Uint8Array;
  readonly kind: "document" | "photo";
  readonly mimeType: string;
  readonly name: string;
  readonly title: string;
}

const careplan: Upload = {
  bytes: PDF,
  kind: "document",
  mimeType: "application/pdf",
  name: "care plan.pdf",
  title: "Care plan",
};
const portrait: Upload = {
  bytes: PNG,
  kind: "photo",
  mimeType: "image/png",
  name: "été.png",
  title: "Summer portrait",
};

/** An upload's request headers, the filename and title percent-encoded. */
function uploadHeaders(file: Upload): Record<string, string> {
  return {
    "content-type": file.mimeType,
    "X-File-Kind": file.kind,
    "X-File-Name": encodeURIComponent(file.name),
    "X-File-Title": encodeURIComponent(file.title),
  };
}

/** Uploads with the given credentials only: a bearer, or a cookie. */
async function upload(
  credentials: Record<string, string>,
  personId: string,
  file: Upload = careplan,
): Promise<Response> {
  return await app.request(`${ORIGIN}/api/v1/people/${personId}/files`, {
    body: file.bytes.slice().buffer,
    headers: { ...uploadHeaders(file), ...credentials },
    method: "POST",
  });
}

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

/** One of the four file operations, for a person and (but upload, list) a file. */
type Operation = "download" | "list" | "remove" | "upload";

async function attempt(
  credentials: Record<string, string>,
  operation: Operation,
  personId: string,
  fileId: string,
): Promise<Response> {
  if (operation === "upload") {
    return await upload(credentials, personId);
  }
  const base = `${ORIGIN}/api/v1/people/${personId}/files`;
  const [method, path]: [HttpMethod, string] = operation === "list"
    ? ["GET", base]
    : operation === "download"
    ? ["GET", `${base}/${fileId}/content`]
    : ["DELETE", `${base}/${fileId}`];
  return await app.request(path, { headers: credentials, method });
}

async function status(
  credentials: Record<string, string>,
  operation: Operation,
  personId: string,
  fileId: string,
): Promise<number> {
  const response = await attempt(credentials, operation, personId, fileId);
  await response.body?.cancel();
  return response.status;
}

async function created(response: Response): Promise<string> {
  const text = await response.text();
  assert(response.status === 201, `upload created: ${response.status} ${text}`);
  return (JSON.parse(text) as { file: { fileId: string } }).file.fileId;
}

interface Listed {
  readonly fileId: string;
  readonly kind: string;
  readonly status: string;
}

async function listed(secret: string, personId: string): Promise<Listed[]> {
  const response = await attempt(bearer(secret), "list", personId, "");
  const text = await response.text();
  assert(response.status === 200, `list: ${response.status} ${text}`);
  return (JSON.parse(text) as { files: Listed[] }).files;
}

/** What the database holds for a workspace's files, to prove nothing moved. */
async function fileState(workspaceId: string): Promise<string> {
  const rows = await sql<{ id: string; status: string }[]>`
    select id::text, status from crm.files
    where workspace_id = ${workspaceId}::uuid order by id`;
  return JSON.stringify({ objects: storage.objects.size, rows });
}

const OPERATIONS: readonly Operation[] = [
  "list",
  "download",
  "upload",
  "remove",
];

Deno.test("[MCP-B8] PostgreSQL file grants upload, list, download, and remove independently", async () => {
  const suffix = crypto.randomUUID();
  const owner = await register(`files-token-${suffix}@example.test`, "Files");
  const personId = await createPerson(api, owner, "Ada");
  const reader = await tokens.mint(owner, ["files:read"]);
  const writer = await tokens.mint(owner, ["files:write"]);
  const people = await tokens.mint(owner, ["people:write"]);
  const gifts = await tokens.mint(owner, ["gifts:write"]);

  const documentId = await created(
    await upload(bearer(writer.secret), personId, careplan),
  );
  const photoId = await created(
    await upload(bearer(writer.secret), personId, portrait),
  );
  const files = await listed(reader.secret, personId);
  assert(
    JSON.stringify(
      files.map((file) => [file.fileId, file.kind, file.status]),
    ) ===
      JSON.stringify([
        [photoId, "photo", "available"],
        [documentId, "document", "available"],
      ]),
    `the reader lists both uploads, photo first: ${JSON.stringify(files)}`,
  );
  for (
    const [fileId, file] of [[documentId, careplan], [
      photoId,
      portrait,
    ]] as const
  ) {
    const response = await attempt(
      bearer(reader.secret),
      "download",
      personId,
      fileId,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert(
      response.status === 200 &&
        bytes.join(",") === file.bytes.join(",") &&
        response.headers.get("content-type") === file.mimeType &&
        response.headers.get("content-length") ===
          String(file.bytes.byteLength) &&
        response.headers.get("cache-control") === "private, no-store" &&
        response.headers.get("content-disposition")?.includes(
          `filename*=UTF-8''${encodeURIComponent(file.name)}`,
        ),
      `${file.name} downloads exactly with its headers: ${response.status} ${
        JSON.stringify([...response.headers])
      }`,
    );
  }

  const before = await fileState(owner.workspaceId);
  const refusals: [string, Operation][] = [
    [reader.secret, "upload"],
    [reader.secret, "remove"],
    [writer.secret, "list"],
    [writer.secret, "download"],
    ...OPERATIONS.flatMap((operation) =>
      [people.secret, gifts.secret].map((secret) =>
        [secret, operation] as [string, Operation]
      )
    ),
  ];
  for (const [secret, operation] of refusals) {
    assert(
      await status(bearer(secret), operation, personId, documentId) === 401,
      `${operation} refuses a token without its grant`,
    );
  }
  assert(
    await fileState(owner.workspaceId) === before,
    "refused tokens changed nothing",
  );

  const disallowed = await upload(bearer(writer.secret), personId, {
    ...careplan,
    mimeType: "application/zip",
    name: "archive.zip",
  });
  await disallowed.body?.cancel();
  assert(
    disallowed.status === 415,
    `a bearer upload of a disallowed media type is refused: ${disallowed.status}`,
  );
  const oversized = await upload(bearer(writer.secret), personId, {
    ...careplan,
    bytes: new Uint8Array(PERSON_FILE_MAX_BYTES + 1),
  });
  await oversized.body?.cancel();
  assert(
    oversized.status === 413,
    `an oversized bearer upload is refused: ${oversized.status}`,
  );
  assert(
    await fileState(owner.workspaceId) === before,
    "refused uploads stored nothing",
  );

  const removal = await attempt(
    bearer(writer.secret),
    "remove",
    personId,
    documentId,
  );
  const removed = await removal.json();
  assert(
    removal.status === 200 && removed.fileId === documentId &&
      removed.status === "removed",
    `the writer removes the document: ${removal.status}`,
  );
  const remaining = await listed(reader.secret, personId);
  assert(
    JSON.stringify(remaining.map((file) => file.fileId)) ===
      JSON.stringify([photoId]),
    "the reader no longer lists the removed document",
  );
  assert(
    await status(bearer(reader.secret), "download", personId, documentId) ===
      404,
    "the removed document no longer downloads",
  );

  const audit = await sql<
    { action: string; api_token_id: string | null; subject_id: string }[]
  >`select action, payload ->> 'apiTokenId' as api_token_id, subject_id::text
    from crm.audit_events
    where workspace_id = ${owner.workspaceId}::uuid and subject_type = 'file'`;
  for (
    const [subject, action, token] of [
      [documentId, "files.file-uploaded", writer.record.id],
      [photoId, "files.file-uploaded", writer.record.id],
      [documentId, "files.file-read", reader.record.id],
      [photoId, "files.file-read", reader.record.id],
      [documentId, "files.file-removed", writer.record.id],
    ] as const
  ) {
    assert(
      audit.some((row) =>
        row.subject_id === subject && row.action === action &&
        row.api_token_id === token
      ),
      `${action} on ${subject} names the token: ${JSON.stringify(audit)}`,
    );
  }
  assert(
    audit.length === 5,
    `each bearer file event is recorded once: ${JSON.stringify(audit)}`,
  );
});

Deno.test("[MCP-B8] PostgreSQL file tokens stay with their workspace and person and never borrow a cookie", async () => {
  try {
    const suffix = crypto.randomUUID();
    const owner = await register(`files-home-${suffix}@example.test`, "Home");
    const foreign = await register(`files-away-${suffix}@example.test`, "Away");
    const ada = await createPerson(api, owner, "Ada");
    const grace = await createPerson(api, owner, "Grace");
    const cookie = { cookie: owner.cookie, origin: ORIGIN };
    const fileId = await created(await upload(cookie, ada, careplan));
    const graceFile = await created(await upload(cookie, grace, portrait));

    const both = ["files:read", "files:write"];
    const home = await tokens.mint(owner, both);
    const away = await tokens.mint(foreign, both);
    const before = await fileState(owner.workspaceId);

    // Another workspace's token: none of this workspace's ids exist for it.
    for (const operation of OPERATIONS) {
      const response = await attempt(
        bearer(away.secret),
        operation,
        ada,
        fileId,
      );
      const text = await response.text();
      assert(
        response.status === 404 && !text.includes("%PDF"),
        `a foreign token cannot ${operation} here: ${response.status}`,
      );
      assert(
        await status(
          { ...bearer(away.secret), "X-Workspace-Id": owner.workspaceId },
          operation,
          ada,
          fileId,
        ) === 401,
        `a foreign token cannot ${operation} by naming this workspace`,
      );
    }
    // Under the wrong person, a file of this workspace is not found.
    for (const operation of ["download", "remove"] as const) {
      assert(
        await status(bearer(home.secret), operation, grace, fileId) === 404 &&
          await status(bearer(home.secret), operation, ada, graceFile) === 404,
        `${operation} refuses a file under another person's path`,
      );
    }
    assert(
      await fileState(owner.workspaceId) === before,
      "foreign and misdirected requests changed nothing",
    );

    const expired = await tokens.mint(owner, both);
    await sql`update crm.api_tokens set expires_at = now() - interval '1 second'
      where id = ${expired.record.id}::uuid`;
    const revoked = await tokens.mint(owner, both);
    const revocation = await api.request(
      owner,
      `/api/v1/settings/api-tokens/${revoked.record.id}`,
      "DELETE",
    );
    await revocation.body?.cancel();
    assert(revocation.status === 200, `token revoked: ${revocation.status}`);
    for (const secret of [expired.secret, revoked.secret]) {
      for (const operation of OPERATIONS) {
        assert(
          await status(bearer(secret), operation, ada, fileId) === 401,
          `${operation} refuses an expired or revoked token`,
        );
      }
    }
    for (const operation of OPERATIONS) {
      assert(
        await status(
          { ...bearer("kin_pat_invalid"), ...cookie },
          operation,
          ada,
          fileId,
        ) === 401,
        `${operation} with an invalid bearer never borrows the cookie`,
      );
    }
    assert(
      await fileState(owner.workspaceId) === before,
      "refused credentials changed nothing",
    );

    // Cookie clients keep the browser rules.
    const unsigned = await upload({ cookie: owner.cookie }, ada);
    await unsigned.body?.cancel();
    assert(unsigned.status === 403, "a cookie upload still needs Origin");
    assert(
      (await listed(home.secret, ada)).some((file) => file.fileId === fileId),
      "a current token of the workspace lists its files",
    );
  } finally {
    await configured.close();
    await sql.end();
  }
});
