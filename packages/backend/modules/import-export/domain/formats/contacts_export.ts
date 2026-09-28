/**
 * The two contact export formats (GAP-050): a CSV archive and one vCard file
 * of every person.
 *
 * Both are produced exactly as the portable JSON artifact is — bytes, a
 * versioned manifest that signs every table, and a digest of the whole — so
 * the export use case stores, resumes, expires, and audits them the same way
 * and only asks which format it wants.
 *
 * - `csv` is a ZIP of three tables keyed by person id: `people.csv`,
 *   `contact_methods.csv`, and `dates.csv`, plus the manifest as
 *   `manifest.json`. Dates are written in the canonical partial-date text
 *   (`--03-09` for a birthday without a year). Every cell is guarded against
 *   formula injection by `csv.ts`.
 * - `vcard` is one `.vcf` of every card `vcard.ts` renders, joined in order,
 *   as that file's header anticipated.
 *
 * Both include archived people, as the portable JSON export does; a deleted
 * person is never listed by the people boundary.
 */

import {
  type PartialDateComponents,
  partialDateText,
} from "../../../../shared-kernel/partial_date.ts";
import type { ExportManifest } from "../export_rules.ts";
import { sha256Hex } from "./canonical.ts";
import { csvText } from "./csv.ts";
import type { PortablePerson } from "./portable_json.ts";
import { VCARD_MIME_TYPE, type VCardPerson, vcardText } from "./vcard.ts";
import { ZIP_MIME_TYPE, zipArchive } from "./zip.ts";

const ENCODER = new TextEncoder();

/** A person as the contact formats render them. */
export interface ContactExportPerson extends PortablePerson, VCardPerson {
  readonly dates: readonly (PartialDateComponents & {
    readonly kind: string;
    readonly label?: string;
  })[];
}

/** A finished artifact of either contact format. */
export interface ContactArtifact {
  readonly bytes: Uint8Array;
  readonly checksumSha256: string;
  readonly filename: string;
  readonly manifest: ExportManifest;
  readonly mimeType: string;
  readonly people: number;
}

/** What the CSV archive leaves out, said in its manifest. */
export const CSV_LIMITATIONS: readonly string[] = [
  "People, contact methods, and dates only; notes, addresses, work, and attachments are not included.",
  "Cells that begin with =, +, -, @, a tab, or a carriage return are prefixed with an apostrophe so spreadsheets do not run them as formulas.",
];

/** What the all-people vCard leaves out, said in its manifest. */
export const VCARD_LIMITATIONS: readonly string[] = [
  "Each card carries the name, email addresses, and phone numbers; other contact methods, dates, and attachments are not included.",
];

async function manifestFor(
  profile: "csv" | "vcard",
  rows: ExportManifest["rows"],
  limitations: readonly string[],
): Promise<ExportManifest> {
  return {
    attachments: { count: 0, items: [], sha256: await sha256Hex("[]") },
    limitations,
    profile,
    rows,
    version: 1,
  };
}

async function signed(bytes: Uint8Array, count: number) {
  return { count, sha256: await sha256Hex(bytes) };
}

const bool = (value: boolean | undefined) => value ? "true" : "false";

/** The three tables and their manifest, archived. */
export async function csvArtifact(
  people: readonly ContactExportPerson[],
  exportId: string,
): Promise<ContactArtifact> {
  const peopleRows = [
    [
      "id",
      "given_name",
      "middle_name",
      "family_name",
      "nickname",
      "description",
      "food_preferences",
      "is_starred",
      "is_partial",
      "is_deceased",
      "is_archived",
    ],
    ...people.map((person) => [
      person.id,
      person.givenName,
      person.middleName ?? "",
      person.familyName ?? "",
      person.nickname ?? "",
      person.description ?? "",
      person.foodPreferences ?? "",
      bool(person.isStarred),
      bool(person.isPartial),
      bool(person.isDeceased),
      bool(person.archived),
    ]),
  ];
  const methodRows = [
    ["person_id", "kind", "type", "value"],
    ...people.flatMap((person) =>
      person.contactMethods.map((method) => [
        person.id,
        method.kind,
        method.label,
        method.value,
      ])
    ),
  ];
  const dateRows = [
    ["person_id", "kind", "label", "date", "precision"],
    ...people.flatMap((person) =>
      person.dates.map((date) => [
        person.id,
        date.kind,
        date.label ?? "",
        partialDateText(date),
        date.precision,
      ])
    ),
  ];
  const tables = {
    contactMethods: ENCODER.encode(csvText(methodRows)),
    dates: ENCODER.encode(csvText(dateRows)),
    people: ENCODER.encode(csvText(peopleRows)),
  };
  const manifest = await manifestFor("csv", {
    contactMethods: await signed(tables.contactMethods, methodRows.length - 1),
    dates: await signed(tables.dates, dateRows.length - 1),
    people: await signed(tables.people, peopleRows.length - 1),
  }, CSV_LIMITATIONS);
  const bytes = zipArchive([
    { bytes: tables.people, name: "people.csv" },
    { bytes: tables.contactMethods, name: "contact_methods.csv" },
    { bytes: tables.dates, name: "dates.csv" },
    {
      bytes: ENCODER.encode(JSON.stringify(manifest, null, 2)),
      name: "manifest.json",
    },
  ]);
  return {
    bytes,
    checksumSha256: await sha256Hex(bytes),
    filename: `kinship-${exportId}-csv.zip`,
    manifest,
    mimeType: ZIP_MIME_TYPE,
    people: people.length,
  };
}

/**
 * Several people's cards as one `.vcf`, in the order given. The all-people
 * export and the directory's selection export (GAP-051) both write this.
 */
export function joinVCards<Person extends VCardPerson>(
  people: readonly Person[],
  displayName: (person: Person) => string,
): string {
  return people.map((person) => vcardText(person, displayName(person))).join(
    "",
  );
}

/** Every person's card, joined into one file. */
export async function vcardArtifact(
  people: readonly ContactExportPerson[],
  displayName: (person: ContactExportPerson) => string,
  exportId: string,
): Promise<ContactArtifact> {
  const bytes = ENCODER.encode(joinVCards(people, displayName));
  const manifest = await manifestFor(
    "vcard",
    { people: await signed(bytes, people.length) },
    VCARD_LIMITATIONS,
  );
  return {
    bytes,
    checksumSha256: await sha256Hex(bytes),
    filename: `kinship-${exportId}.vcf`,
    manifest,
    mimeType: VCARD_MIME_TYPE,
    people: people.length,
  };
}
