/**
 * One person as a vCard 4.0 card.
 *
 * Almost all of this file is escaping, and the escaping is the rule: a comma,
 * a semicolon, a backslash, or a newline inside a name would otherwise end the
 * value or start a new property, so a person called `O'Brien, Jr.` would be
 * read back as two fields. Line endings are CRLF and the card ends with a
 * blank line because RFC 6350 says so and some address books refuse a card
 * that does not.
 *
 * The display name arrives as an argument rather than being derived here. What
 * a person is called is the people module's rule, and a format module that
 * re-derived it would quietly drift from the name shown everywhere else.
 *
 * GAP-050 adds an all-people export beside this file; it needs `vcardText` per
 * person and a joiner, not a different card.
 */

/** The person fields a card renders. */
export interface VCardPerson {
  readonly contactMethods: readonly {
    readonly kind: "email" | "phone" | "other";
    readonly label: string;
    readonly value: string;
  }[];
  readonly familyName?: string;
  readonly givenName: string;
  readonly middleName?: string;
}

/** The media type a single card is served under. */
export const VCARD_MIME_TYPE = "text/vcard; charset=utf-8";

/** Text as a vCard property value. */
function escape(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(",", "\\,").replaceAll(";", "\\;");
}

/** A label as a `TYPE=` parameter, which may only be a token. */
function parameter(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40) || "other";
}

/** The card, with only the contact methods a card has properties for. */
export function vcardText(person: VCardPerson, displayName: string): string {
  return [
    "BEGIN:VCARD",
    "VERSION:4.0",
    `FN:${escape(displayName)}`,
    `N:${escape(person.familyName ?? "")};${escape(person.givenName)};${
      escape(person.middleName ?? "")
    };;`,
    ...person.contactMethods.filter((method) =>
      method.kind === "email" || method.kind === "phone"
    ).map((method) =>
      `${method.kind === "email" ? "EMAIL" : "TEL"};TYPE=${
        parameter(method.label)
      }:${escape(method.value)}`
    ),
    "END:VCARD",
    "",
  ].join("\r\n");
}

/**
 * The filename the card is downloaded under.
 *
 * It is built from the name parts rather than from the display name so it
 * stays a filename: anything a file system or a `Content-Disposition` header
 * would argue about is replaced, and a person with nothing usable left is
 * still downloadable.
 */
export function vcardFilename(person: VCardPerson): string {
  const safeName = [person.givenName, person.familyName].filter(Boolean)
    .join("-").replace(/[^A-Za-z0-9._-]+/g, "-") || "person";
  return `${safeName}.vcf`;
}
