import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import type { ObjectStorage } from "../../packages/backend/modules/files/public.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { openSql, requireDatabaseUrl } from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";

class CapturedStorage implements ObjectStorage {
  readonly bucket = "contact-export-test";
  readonly provider = "captured";
  readonly objects = new Map<string, Uint8Array>();
  get(command: { readonly key: string }) {
    return Promise.resolve(this.objects.get(command.key)?.slice());
  }
  health(): Promise<"available"> {
    return Promise.resolve("available");
  }
  put(command: { readonly bytes: Uint8Array; readonly key: string }) {
    this.objects.set(command.key, command.bytes.slice());
    return Promise.resolve();
  }
  remove(command: { readonly key: string }) {
    this.objects.delete(command.key);
    return Promise.resolve();
  }
}

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
  undefined,
  undefined,
  undefined,
  new CapturedStorage(),
);
const api = apiSupport(configured.app, mail, sql);
const register = (label: string) => {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  return api.register(email, email, { firstName: "Export", lastName: "Admin" });
};
const DECODER = new TextDecoder();

/** The entries of a stored ZIP, by their local headers. */
function unzip(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset);
  const entries = new Map<string, string>();
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    assertEquals(view.getUint16(cursor + 8, true), 0, "stored entries only");
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const start = cursor + 30 + nameLength;
    entries.set(
      DECODER.decode(archive.subarray(cursor + 30, start)),
      DECODER.decode(archive.subarray(start, start + size)),
    );
    cursor = start + size;
  }
  return entries;
}

async function exported(fixture: SignedInFixture, format: string) {
  const created = await api.request(fixture, "/api/v1/exports", "POST", {
    format,
  });
  const summary = await created.json() as {
    exportId: string;
    format: string;
    manifest: {
      profile: string;
      rows: Record<string, { count: number; sha256: string }>;
    };
    status: string;
  };
  assertEquals(created.status, 201, JSON.stringify(summary));
  const issued = await api.request(
    fixture,
    `/api/v1/exports/${summary.exportId}/downloads`,
    "POST",
  );
  const reference = await issued.json() as { href: string };
  const download = await api.request(fixture, reference.href, "GET");
  assertEquals(download.status, 200);
  return {
    bytes: new Uint8Array(await download.arrayBuffer()),
    headers: download.headers,
    reference: reference.href,
    summary,
  };
}

async function seed(fixture: SignedInFixture) {
  const ada = crypto.randomUUID();
  const hostile = crypto.randomUUID();
  const archived = crypto.randomUUID();
  const deleted = crypto.randomUUID();
  const email = crypto.randomUUID();
  await sql`insert into crm.people (id, workspace_id, created_by_member_id, given_name, family_name, archived_at, deleted_at)
    values
      (${ada}::uuid, ${fixture.workspaceId}::uuid, ${fixture.memberId}::uuid, 'Ada', 'Lovelace', null, null),
      (${hostile}::uuid, ${fixture.workspaceId}::uuid, ${fixture.memberId}::uuid, '=HYPERLINK("https://evil.test")', null, null, null),
      (${archived}::uuid, ${fixture.workspaceId}::uuid, ${fixture.memberId}::uuid, 'Archie', null, now(), null),
      (${deleted}::uuid, ${fixture.workspaceId}::uuid, ${fixture.memberId}::uuid, 'Deleted', null, null, now())`;
  await sql`insert into crm.contact_method_types (id, workspace_id, name, kind)
    values (${email}::uuid, ${fixture.workspaceId}::uuid, 'Email', 'email')`;
  await sql`insert into crm.person_contact_methods (person_id, type_id, value, is_primary)
    values (${ada}::uuid, ${email}::uuid, 'ada@example.test', true)`;
  await sql`insert into crm.person_dates (person_id, kind, month, day, precision)
    values (${ada}::uuid, 'birthday', 12, 10, 'month_day')`;
  return { ada, archived, deleted, hostile };
}

Deno.test("[EXPORT-002] a CSV export is three formula-safe tables keyed by person id", async () => {
  const primary = await register("csv-export");
  const ids = await seed(primary);
  const { bytes, headers, reference, summary } = await exported(primary, "csv");
  assertEquals(summary.format, "csv");
  assertEquals(summary.manifest.profile, "csv");
  assertEquals(summary.manifest.rows.people?.count, 3);
  assertEquals(summary.manifest.rows.contactMethods?.count, 1);
  assertEquals(summary.manifest.rows.dates?.count, 1);
  assertEquals(headers.get("content-type"), "application/zip");
  assert(
    headers.get("content-disposition")?.includes(".zip"),
    "the archive downloads as a .zip",
  );
  const files = unzip(bytes);
  assertEquals([...files.keys()], [
    "people.csv",
    "contact_methods.csv",
    "dates.csv",
    "manifest.json",
  ]);
  const people = files.get("people.csv")!;
  assert(people.includes(`${ids.ada},Ada,,Lovelace`), people);
  assert(
    people.includes(`${ids.hostile},"'=HYPERLINK(""https://evil.test"")"`),
    "a formula is neutralized",
  );
  assert(people.includes(`${ids.archived},Archie`), "archived people export");
  assert(!people.includes(ids.deleted), "deleted people never export");
  assertEquals(
    files.get("contact_methods.csv"),
    `person_id,kind,type,value\r\n${ids.ada},email,Email,ada@example.test\r\n`,
  );
  assertEquals(
    files.get("dates.csv"),
    `person_id,kind,label,date,precision\r\n${ids.ada},birthday,,'--12-10,month_day\r\n`,
  );
  assertEquals(
    JSON.parse(files.get("manifest.json")!).rows,
    summary.manifest.rows,
  );
  // The download reference is one-shot, as it is for the JSON export.
  assertEquals((await api.request(primary, reference, "GET")).status, 410);
});

Deno.test("[EXPORT-002] a vCard export is every person's card in one file, and exports stay private", async () => {
  const primary = await register("vcard-export");
  const foreign = await register("vcard-export-foreign");
  const ids = await seed(primary);
  const { bytes, headers, summary } = await exported(primary, "vcard");
  assertEquals(summary.manifest.profile, "vcard");
  assertEquals(summary.manifest.rows.people?.count, 3);
  assertEquals(headers.get("content-type"), "text/vcard; charset=utf-8");
  const text = DECODER.decode(bytes);
  assertEquals(text.match(/BEGIN:VCARD/g)?.length, 3);
  assert(text.includes("FN:Ada Lovelace\r\n"), text);
  assert(text.includes("EMAIL;TYPE=Email:ada@example.test"), text);
  assert(text.includes("FN:Archie"), "archived people export");
  assert(!text.includes("Deleted"), "deleted people never export");
  assert(!text.includes(ids.deleted), "no identifier leaks");

  assertEquals(
    (await api.request(
      foreign,
      `/api/v1/exports/${summary.exportId}/downloads`,
      "POST",
    )).status,
    404,
  );
  const refused = await api.request(primary, "/api/v1/exports", "POST", {
    format: "sql",
  });
  assertEquals(refused.status, 400);
  await sql`update crm.workspace_members set role = 'member'
    where id = ${foreign.memberId}::uuid`;
  assertEquals(
    (await api.request(foreign, "/api/v1/exports", "POST", { format: "csv" }))
      .status,
    403,
  );
  const [audits] = await sql<{ actions: string }[]>`
    select string_agg(action, ',' order by occurred_at, action) as actions
    from crm.audit_events
    where workspace_id = ${primary.workspaceId}::uuid
      and subject_id = ${summary.exportId}::uuid`;
  assert(
    audits?.actions.includes("export.requested") &&
      audits.actions.includes("export.completed") &&
      audits.actions.includes("export.downloaded"),
    audits?.actions ?? "no audits",
  );
});
