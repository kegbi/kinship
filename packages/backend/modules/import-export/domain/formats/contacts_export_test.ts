import { assertEquals } from "../../../../testing/assert.ts";
import { sha256Hex } from "./canonical.ts";
import {
  type ContactExportPerson,
  CSV_LIMITATIONS,
  csvArtifact,
  VCARD_LIMITATIONS,
  vcardArtifact,
} from "./contacts_export.ts";
import { parseCsv } from "./csv.ts";
import { parseVCardSource } from "./vcard_parse.ts";

const DECODER = new TextDecoder();

const ADA: ContactExportPerson = {
  contactMethods: [
    { kind: "email", label: "Email", value: "ada@example.com" },
    { kind: "other", label: "Website", value: "https://example.com" },
  ],
  dates: [
    { day: 10, kind: "birthday", month: 12, precision: "month_day" },
    { kind: "custom", label: "Anniversary", precision: "year", year: 1835 },
  ],
  familyName: "Lovelace",
  givenName: "=Ada",
  id: "11111111-1111-4111-8111-111111111111",
  isDeceased: true,
  isPartial: false,
  isStarred: true,
};
const BOB: ContactExportPerson = {
  archived: true,
  contactMethods: [{ kind: "phone", label: "Mobile", value: "+1 555 0100" }],
  dates: [],
  givenName: "Bob",
  id: "22222222-2222-4222-8222-222222222222",
  isDeceased: false,
  isPartial: true,
  isStarred: false,
  nickname: 'B, "the" builder',
};

/** Entry text from a stored archive, by its local headers. */
function entries(archive: Uint8Array): Map<string, string> {
  const view = new DataView(archive.buffer, archive.byteOffset);
  const found = new Map<string, string>();
  let cursor = 0;
  while (view.getUint32(cursor, true) === 0x04034b50) {
    const size = view.getUint32(cursor + 18, true);
    const nameLength = view.getUint16(cursor + 26, true);
    const name = DECODER.decode(
      archive.subarray(cursor + 30, cursor + 30 + nameLength),
    );
    const start = cursor + 30 + nameLength;
    found.set(name, DECODER.decode(archive.subarray(start, start + size)));
    cursor = start + size;
  }
  return found;
}

Deno.test("[GAP-050] the CSV export is three signed tables keyed by person id", async () => {
  const artifact = await csvArtifact([ADA, BOB], "e1");
  assertEquals(artifact.filename, "kinship-e1-csv.zip");
  assertEquals(artifact.mimeType, "application/zip");
  assertEquals(artifact.people, 2);
  assertEquals(artifact.checksumSha256, await sha256Hex(artifact.bytes));
  const files = entries(artifact.bytes);
  assertEquals([...files.keys()], [
    "people.csv",
    "contact_methods.csv",
    "dates.csv",
    "manifest.json",
  ]);
  const people = parseCsv(files.get("people.csv")!);
  if (typeof people === "string") throw new Error(people);
  assertEquals(people.rows, [
    [
      ADA.id,
      "'=Ada",
      "",
      "Lovelace",
      "",
      "",
      "",
      "true",
      "false",
      "true",
      "false",
    ],
    [
      BOB.id,
      "Bob",
      "",
      "",
      'B, "the" builder',
      "",
      "",
      "false",
      "true",
      "false",
      "true",
    ],
  ]);
  assertEquals(
    files.get("contact_methods.csv"),
    `person_id,kind,type,value\r\n${ADA.id},email,Email,ada@example.com\r\n${ADA.id},other,Website,https://example.com\r\n${BOB.id},phone,Mobile,'+1 555 0100\r\n`,
  );
  assertEquals(
    files.get("dates.csv"),
    `person_id,kind,label,date,precision\r\n${ADA.id},birthday,,'--12-10,month_day\r\n${ADA.id},custom,Anniversary,1835,year\r\n`,
  );
  const manifest = JSON.parse(files.get("manifest.json")!);
  assertEquals(manifest, artifact.manifest);
  assertEquals(artifact.manifest.profile, "csv");
  assertEquals(artifact.manifest.limitations, CSV_LIMITATIONS);
  assertEquals(artifact.manifest.rows.people, {
    count: 2,
    sha256: await sha256Hex(new TextEncoder().encode(files.get("people.csv")!)),
  });
  assertEquals(artifact.manifest.rows.contactMethods?.count, 3);
  assertEquals(artifact.manifest.rows.dates?.count, 2);
  // The same people always make the same archive, so a resumed run can
  // recognize the bytes it stored before it was interrupted.
  assertEquals(
    (await csvArtifact([ADA, BOB], "e1")).checksumSha256,
    artifact.checksumSha256,
  );
});

Deno.test("[GAP-050] the vCard export joins every card and reads back", async () => {
  const artifact = await vcardArtifact(
    [ADA, BOB],
    (person) => `${person.givenName} ${person.familyName ?? ""}`.trim(),
    "e2",
  );
  assertEquals(artifact.filename, "kinship-e2.vcf");
  assertEquals(artifact.mimeType, "text/vcard; charset=utf-8");
  assertEquals(artifact.manifest.profile, "vcard");
  assertEquals(artifact.manifest.limitations, VCARD_LIMITATIONS);
  assertEquals(artifact.manifest.rows, {
    people: { count: 2, sha256: await sha256Hex(artifact.bytes) },
  });
  const read = parseVCardSource(DECODER.decode(artifact.bytes));
  if (typeof read === "string") throw new Error(read);
  assertEquals(
    read.cards.map((card) => [card.fullName, card.emails, card.phones]),
    [
      ["=Ada Lovelace", ["ada@example.com"], []],
      ["Bob", [], ["+1 555 0100"]],
    ],
  );
  assertEquals((await vcardArtifact([], () => "", "e3")).bytes.byteLength, 0);
});
