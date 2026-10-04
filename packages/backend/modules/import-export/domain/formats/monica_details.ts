/** Resolves Monica's related rows into the existing contact import vocabulary. */
import { parsePartialDateText } from "../../../../shared-kernel/partial_date.ts";
import type { ImportedContact, ImportedDate } from "../contact_import.ts";
import {
  booleanValue,
  safePath,
  sourceId,
  textValue,
  validOptionalBoolean,
} from "./monica_source.ts";
import type { MonicaAttachment } from "./monica_source.ts";

type Row = Record<string, unknown>;
export interface MonicaDetails {
  readonly contacts: readonly Row[];
  readonly details: ReadonlyMap<string, ImportedContact>;
  readonly notes: ReadonlyMap<string, readonly string[]>;
  readonly attachments: ReadonlyMap<string, MonicaAttachment>;
  readonly unsupportedRows: Readonly<Record<string, number>>;
  readonly unsupportedFields: Readonly<Record<string, number>>;
  readonly orphans: number;
}

const FIELDS: Readonly<Record<string, readonly string[]>> = {
  contact_fields: [
    "id",
    "account_id",
    "contact_id",
    "contact_field_type_id",
    "data",
  ],
  contact_field_types: ["id", "account_id", "type"],
  addresses: ["id", "account_id", "contact_id", "place_id"],
  places: [
    "id",
    "account_id",
    "street",
    "city",
    "province",
    "postal_code",
    "country",
  ],
  special_dates: [
    "id",
    "account_id",
    "contact_id",
    "is_age_based",
    "is_year_unknown",
    "date",
  ],
  notes: ["id", "account_id", "contact_id", "body"],
  photos: ["id", "account_id", "original_filename", "filesize"],
};

export function monicaDetails(
  tables: Readonly<Record<string, unknown>>,
  maxAttachmentBytes: number,
): MonicaDetails | string {
  const contacts = (tables.contacts as Row[]).map((row) => ({ ...row }));
  const details = new Map<string, ImportedContact>();
  const notes = new Map<string, readonly string[]>();
  const attachments = new Map<string, MonicaAttachment>();
  const unsupportedRows: Record<string, number> = Object.create(null);
  const unsupportedFields: Record<string, number> = {};
  const used = new Set<Row>();
  const rows = (table: string): Row[] =>
    Array.isArray(tables[table]) ? tables[table] as Row[] : [];
  const sameAccount = (a: Row, b: Row) =>
    sourceId(a.account_id) === sourceId(b.account_id);
  const matches = (row: Row, contact: Row) =>
    sameAccount(row, contact) &&
    sourceId(row.contact_id) === sourceId(contact.id);
  const find = (table: string, id: unknown, owner: Row): Row | undefined => {
    const key = sourceId(id);
    if (!key) return undefined;
    const matching = rows(table).filter((row) =>
      sourceId(row.id) === key && sameAccount(row, owner)
    );
    return matching.length === 1 ? matching[0] : undefined;
  };
  const mark = (table: string, row: Row) => {
    used.add(row);
    for (const [field, value] of Object.entries(row)) {
      if (value === null || value === "" || FIELDS[table]?.includes(field)) {
        continue;
      }
      const key = `${table}.${field}`;
      unsupportedFields[key] = (unsupportedFields[key] ?? 0) + 1;
    }
  };
  let orphans = 0;
  for (const table of Object.keys(FIELDS)) {
    if (
      tables[table] !== undefined &&
      (!Array.isArray(tables[table]) ||
        rows(table).some((row) =>
          !row || typeof row !== "object" || Array.isArray(row)
        ))
    ) {
      return "Every related Monica table must contain objects.";
    }
  }
  for (const contact of contacts) {
    const key = sourceId(contact.id);
    if (!key) continue;
    const emails: string[] = [], phones: string[] = [], urls: string[] = [];
    for (
      const row of rows("contact_fields").filter((row) => matches(row, contact))
    ) {
      const type = find("contact_field_types", row.contact_field_type_id, row);
      const kind = type?.type;
      const value = textValue(
        kind === "phone" && typeof row.data === "number" &&
          Number.isSafeInteger(row.data)
          ? String(row.data)
          : row.data,
        kind === "email" ? 320 : kind === "phone" ? 64 : 2048,
      );
      if (
        !type || !value || !["email", "phone", "url"].includes(kind as string)
      ) continue;
      (kind === "email" ? emails : kind === "phone" ? phones : urls).push(
        kind === "email" ? value.toLowerCase() : value,
      );
      mark("contact_fields", row);
      if (!used.has(type)) mark("contact_field_types", type);
    }
    const addresses: ImportedContact["addresses"][number][] = [];
    for (
      const row of rows("addresses").filter((row) => matches(row, contact))
    ) {
      const place = find("places", row.place_id, row);
      if (!place) continue;
      const address: Record<string, string> = {};
      for (
        const [source, target] of [
          ["street", "street"],
          ["city", "city"],
          ["province", "region"],
          ["postal_code", "postalCode"],
          ["country", "country"],
        ]
      ) {
        const raw = place[source!];
        const value = textValue(
          source === "postal_code" && typeof raw === "number" &&
            Number.isSafeInteger(raw)
            ? String(raw)
            : raw,
          1000,
        );
        if (value) address[target!] = value;
        else if (
          place[source!] !== null && place[source!] !== undefined &&
          place[source!] !== ""
        ) return "A Monica address field exceeds the supported text limit.";
      }
      if (!Object.keys(address).length) continue;
      addresses.push(address);
      mark("addresses", row);
      if (!used.has(place)) mark("places", place);
    }
    const dates: ImportedDate[] = [];
    for (
      const [field, kind] of [["birthday_special_date_id", "birthday"], [
        "deceased_special_date_id",
        "deceased",
      ], ["first_met_special_date_id", "first_met"]] as const
    ) {
      const row = find("special_dates", contact[field], contact);
      if (!row || !matches(row, contact)) {
        if ((contact[field] !== null && contact[field] !== undefined)) {
          unsupportedFields[`contacts.${field}`] =
            (unsupportedFields[`contacts.${field}`] ?? 0) + 1;
        }
        continue;
      }
      const date = typeof row.date === "string"
        ? parsePartialDateText(row.date.slice(0, 10))
        : undefined;
      if (
        !date || date.precision !== "full" ||
        !validOptionalBoolean(row.is_age_based) ||
        !validOptionalBoolean(row.is_year_unknown)
      ) continue;
      const unknownYear = booleanValue(row.is_year_unknown);
      const ageBased = booleanValue(row.is_age_based) && !unknownYear;
      dates.push(
        unknownYear
          ? {
            kind,
            precision: "month_day",
            month: date.month!,
            day: date.day!,
            isAgeBased: false,
          }
          : ageBased
          ? {
            kind,
            precision: "year",
            year: date.year!,
            isAgeBased: true,
            isYearApproximate: true,
          }
          : { kind, ...date, isAgeBased: false },
      );
      mark("special_dates", row);
    }
    const bodies: string[] = [];
    for (const row of rows("notes").filter((row) => matches(row, contact))) {
      const body = textValue(row.body, 10_000);
      if (!body) {
        if (typeof row.body === "string" && row.body.length > 10_000) {
          return "A Monica note exceeds the 10,000 character limit; no notes were truncated.";
        }
        continue;
      }
      bodies.push(body);
      mark("notes", row);
    }
    if (bodies.length) notes.set(key, bodies);
    const jobTitle = textValue(contact.job, 1000);
    const organization = textValue(contact.company, 1000);
    if (
      ((contact.job !== null && contact.job !== undefined) && !jobTitle &&
        contact.job !== "") ||
      ((contact.company !== null && contact.company !== undefined) &&
        !organization && contact.company !== "")
    ) return "A Monica occupation exceeds the supported text limit.";
    if (
      addresses.length || dates.length || emails.length || phones.length ||
      urls.length || jobTitle || organization
    ) {
      details.set(key, {
        addresses,
        dates,
        emails: [...new Set(emails)],
        phones: [...new Set(phones)],
        urls: [...new Set(urls)],
        givenName: textValue(contact.first_name) ?? "",
        ...(jobTitle ? { jobTitle } : {}),
        ...(organization ? { organization } : {}),
      });
    }
    const photo = find("photos", contact.avatar_photo_id, contact);
    if (
      (contact.avatar_photo_id !== null &&
        contact.avatar_photo_id !== undefined) &&
      (!photo || contact.avatar_source !== "photo")
    ) {
      unsupportedFields["contacts.avatar_photo_id"] =
        (unsupportedFields["contacts.avatar_photo_id"] ?? 0) + 1;
    }
    if (
      photo && contact.avatar_source === "photo" &&
      (contact.avatar_file_name === null ||
        contact.avatar_file_name === undefined)
    ) {
      const filename = safePath(photo.original_filename);
      const byteSize = photo.filesize;
      if (
        !filename || !Number.isSafeInteger(byteSize) ||
        (byteSize as number) < 0 || (byteSize as number) > maxAttachmentBytes
      ) return "A Monica photo reference has invalid file metadata.";
      // Synthetic export-local paths keep equal filenames from colliding.
      const path = `photos/${key}/${filename}`;
      contact.avatar_file_name = path;
      attachments.set(path, {
        path: filename,
        byteSize: byteSize as number,
        present: false,
      });
      if (!used.has(photo)) mark("photos", photo);
    }
  }
  for (const [table, value] of Object.entries(tables)) {
    if (table === "contacts" || table === "users") continue;
    const skipped = Array.isArray(value)
      ? value.filter((row) => !used.has(row)).length
      : 1;
    if (skipped) unsupportedRows[table] = skipped;
    if (
      ["contact_fields", "addresses", "notes", "special_dates"].includes(table)
    ) {
      orphans += rows(table).filter((row) =>
        !contacts.some((contact) =>
          matches(row, contact)
        )
      ).length;
    }
  }
  return {
    contacts,
    details,
    notes,
    attachments,
    unsupportedRows,
    unsupportedFields,
    orphans,
  };
}
