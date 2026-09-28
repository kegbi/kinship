import { assert, assertEquals } from "../../../../testing/assert.ts";
import { canonicalJson } from "./canonical.ts";
import {
  contentLine,
  logicalLines,
  MAX_PARAMETERS,
  type ParsedVCardSource,
  parseVCardSource,
} from "./vcard_parse.ts";
import { vcardText } from "./vcard.ts";

const fixture = (name: string) =>
  Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

function parsed(text: string): ParsedVCardSource {
  const result = parseVCardSource(text);
  assert(typeof result !== "string", `expected a parse, got ${result}`);
  return result;
}

function same(actual: unknown, expected: unknown, message?: string) {
  assertEquals(canonicalJson(actual), canonicalJson(expected), message);
}

Deno.test("[GAP-050] a vCard 4.0 file maps every supported property", async () => {
  const source = parsed(await fixture("contacts-4.0.vcf"));
  assertEquals(source.cards.length, 3);
  same(source.cards[0], {
    addresses: [{
      city: "London",
      country: "United Kingdom",
      postalCode: "SW1Y 4JH",
      street: "12 St James's Square",
    }],
    dates: [
      { day: 10, kind: "birthday", month: 12, precision: "full", year: 1815 },
      { day: 27, kind: "deceased", month: 11, precision: "full", year: 1852 },
      { day: 8, kind: "anniversary", month: 7, precision: "month_day" },
    ],
    emails: ["ada@example.com", "ada.lovelace@example.org"],
    familyName: "Lovelace",
    fullName: "Ada King, Countess of Lovelace",
    givenName: "Ada",
    jobTitle: "Mathematician",
    middleName: "Augusta",
    nickname: "Ada",
    note: "Wrote the first program.\nLoved poetry, too; and horses.",
    organization: "Analytical Engine Society",
    phones: ["+44-20-7946-0000"],
    uid: "urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
    urls: ["https://example.com/ada"],
  });
  same(source.cards[1], {
    addresses: [],
    dates: [{ day: 26, kind: "birthday", month: 12, precision: "month_day" }],
    emails: [],
    familyName: "Babbage",
    fullName: "Charles Babbage",
    givenName: "Charles",
    phones: ["+44 20 7946 0001"],
    urls: [],
  });
  same(source.cards[2], {
    addresses: [],
    dates: [],
    emails: [],
    fullName: "Grace Hopper",
    phones: [],
    urls: [],
  });
  // Nothing the importer cannot keep is dropped without being counted.
  same(source.skipped, {
    BDAY: 1,
    PHOTO: 2,
    URL: 1,
    "X-ABLABEL": 1,
    "X-SOCIALPROFILE": 1,
  });
});

Deno.test("[GAP-050] a 2.1-era 3.0 export decodes quoted-printable UTF-8 behind a BOM", async () => {
  const source = parsed(await fixture("contacts-3.0-qp.vcf"));
  same(source.cards[0], {
    addresses: [],
    dates: [{ kind: "birthday", precision: "year", year: 1970 }],
    emails: [],
    familyName: "Müller",
    fullName: "Jürgen Müller",
    givenName: "Jürgen",
    note: "Erste Zeile\nZweite Zeile, mit Umbruch",
    phones: ["+49 30 1234567"],
    urls: [],
  });
  same(source.cards[1], {
    addresses: [],
    dates: [],
    emails: [],
    note: "nobody",
    phones: [],
    urls: [],
  });
  same(source.skipped, {});
});

Deno.test("[GAP-050] the card this module exports reads back as the same person", () => {
  const card = vcardText({
    contactMethods: [
      { kind: "email", label: "home", value: "o'brien@example.com" },
      { kind: "phone", label: "cell", value: "+1 555 0100" },
    ],
    familyName: "O'Brien, Jr.",
    givenName: 'Pat; "P"',
    middleName: "Back\\slash",
  }, "Pat O'Brien, Jr.");
  same(parsed(card).cards, [{
    addresses: [],
    dates: [],
    emails: ["o'brien@example.com"],
    familyName: "O'Brien, Jr.",
    fullName: "Pat O'Brien, Jr.",
    givenName: 'Pat; "P"',
    middleName: "Back\\slash",
    phones: ["+1 555 0100"],
    urls: [],
  }]);
});

Deno.test("[GAP-050] LF line endings, lower-case names, and tab folding are read", () => {
  const source = parsed(
    "begin:vcard\nversion:3.0\nprodid:-//Example//EN\nrev:2026\nfn:Ann\n\tBell\nemail;type=INTERNET:mailto:ann@example.com\nuid:abc\nend:vcard\n",
  );
  same(source.cards, [{
    addresses: [],
    dates: [],
    emails: ["ann@example.com"],
    fullName: "AnnBell",
    phones: [],
    uid: "abc",
    urls: [],
  }]);
});

Deno.test("[GAP-050] an unreadable date, an oversized value, and an unknown charset are skipped, not guessed", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:4.0",
    "FN:Dee",
    "BDAY:1990-02-30",
    "ANNIVERSARY;VALUE=text:last spring",
    `NOTE:${"x".repeat(10_001)}`,
    "NICKNAME;CHARSET=X-MADE-UP;ENCODING=QUOTED-PRINTABLE:=C1=C2",
    "EMAIL:   ",
    "END:VCARD",
  ].join("\r\n"));
  same(source.cards[0], {
    addresses: [],
    dates: [],
    emails: [],
    fullName: "Dee",
    phones: [],
    urls: [],
  });
  same(source.skipped, { ANNIVERSARY: 1, BDAY: 1, NICKNAME: 1, NOTE: 1 });
});

Deno.test("[GAP-050] a latin-1 quoted-printable value decodes by its declared charset", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN;CHARSET=ISO-8859-1;ENCODING=QUOTED-PRINTABLE:Ren=E9e",
    "END:VCARD",
  ].join("\r\n"));
  assertEquals(source.cards[0]?.fullName, "Renée");
});

Deno.test("[GAP-050] a structurally broken file is refused with one sentence", () => {
  const refusals: readonly [string, string][] = [
    ["", "The file contains no vCards."],
    ["FN:Nobody\r\n", "The file contains no vCards."],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Open\r\n",
      "A vCard is missing END:VCARD.",
    ],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nBEGIN:VCARD\r\nEND:VCARD\r\nEND:VCARD\r\n",
      "Nested vCards are not supported.",
    ],
    ["END:VCARD\r\n", "END:VCARD appears without BEGIN:VCARD."],
    [
      "BEGIN:VCARD\r\nVERSION:5.0\r\nFN:Future\r\nEND:VCARD\r\n",
      "Only vCard 2.1, 3.0, and 4.0 are supported.",
    ],
    [
      "BEGIN:VCARD\r\nFN:Unversioned\r\nEND:VCARD\r\n",
      "Only vCard 2.1, 3.0, and 4.0 are supported.",
    ],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nno colon here\r\nEND:VCARD\r\n",
      "A vCard line has no value.",
    ],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nitem1.:nameless\r\nEND:VCARD\r\n",
      "A vCard line has no value.",
    ],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEND:VCARD\r\nstray\r\n",
      "Text outside a vCard is not supported.",
    ],
    [
      "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:A\r\nEND:VCARD\r\n".repeat(501),
      "A vCard file may contain at most 500 cards.",
    ],
  ];
  for (const [text, problem] of refusals) {
    assertEquals(parseVCardSource(text), problem, JSON.stringify(text));
  }
});

Deno.test("[GAP-050] bare 2.1 parameters and partial addresses are read", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:2.1",
    "FN:Dee",
    "TEL;HOME;VOICE:+1 555 0100",
    "ADR;HOME:;;;;Shire;;",
    "ADR:;;;;;12345;",
    "ADR:;;;;;;",
    "END:VCARD",
  ].join("\r\n"));
  same(source.cards[0], {
    addresses: [{ region: "Shire" }, { postalCode: "12345" }],
    dates: [],
    emails: [],
    fullName: "Dee",
    phones: ["+1 555 0100"],
    urls: [],
  });
  same(source.skipped, { ADR: 1 });
});

Deno.test("[GAP-050] soft-broken quoted-printable lines are joined in linear work", () => {
  // The worst case under the 1.5 MB envelope: one property whose value is
  // continued by 360,000 soft line breaks.
  const lines = 360_000;
  const text = `BEGIN:VCARD\r\nVERSION:2.1\r\nNOTE;ENCODING=QUOTED-PRINTABLE:${
    "a=\r\n".repeat(lines)
  }b\r\nFN:Wor\r\n st\r\nEND:VCARD\r\n`;
  const work = { steps: 0 };
  const unfolded = logicalLines(text, work);
  assertEquals(unfolded.length, 5);
  assertEquals(
    unfolded[2]!.length,
    "NOTE;ENCODING=QUOTED-PRINTABLE:".length + lines + 1,
  );
  assert(
    work.steps <= 2 * text.length,
    `unfolding took ${work.steps} steps for ${text.length} characters`,
  );
  // The joined value is over the note limit, so it is counted, not kept.
  const source = parsed(text);
  assertEquals(source.cards[0]?.fullName, "Worst");
  same(source.skipped, { NOTE: 1 });
});

Deno.test("[GAP-050] a line of 100,000 repeated parameters is read in linear work", () => {
  // Every bare parameter is a TYPE, so this line repeats one key 100,000
  // times; the parameter list must never be copied per repetition.
  const line = `NOTE${";".repeat(100_000)}:a`;
  const work = { steps: 0 };
  const result = contentLine(line, work);
  same(result, { name: "NOTE", overParameterLimit: true });
  assert(
    work.steps <= 4 * line.length,
    `reading the line took ${work.steps} steps for ${line.length} characters`,
  );
  // Within the limit, a key repeated on every parameter, each carrying many
  // values, is appended in place: one step per value kept.
  const values = Array.from({ length: 1_000 }, () => "a").join(",");
  const repeated = `TEL${`;TYPE=${values}`.repeat(MAX_PARAMETERS)}:1`;
  const kept = { steps: 0 };
  const read = contentLine(repeated, kept);
  assert(read && !("overParameterLimit" in read), "the line is read");
  assertEquals(read.parameters.get("TYPE")?.length, MAX_PARAMETERS * 1_000);
  assert(
    kept.steps <= 4 * repeated.length,
    `reading the line took ${kept.steps} steps for ${repeated.length} characters`,
  );
  const source = parsed(
    `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann\r\n${line}\r\nEND:VCARD\r\n`,
  );
  assertEquals(source.cards[0]?.fullName, "Ann");
  same(source.skipped, { NOTE: 1 });
});

Deno.test("[GAP-050] a line over the parameter limit is skipped and named", () => {
  const within = `TEL${";HOME".repeat(MAX_PARAMETERS)}:+1 555 0100`;
  const over = `EMAIL${";HOME".repeat(MAX_PARAMETERS + 1)}:ann@example.com`;
  const source = parsed(
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Ann",
      within,
      over,
      "EMAIL:ann@example.org",
      "END:VCARD",
      "",
    ].join("\r\n"),
  );
  same(source.cards[0]?.phones, ["+1 555 0100"]);
  same(source.cards[0]?.emails, ["ann@example.org"]);
  same(source.skipped, { EMAIL: 1 });
});

Deno.test("[GAP-050] a bare 2.1 QUOTED-PRINTABLE parameter and emoji decode by code point", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:2.1",
    "FN;CHARSET=UTF-8;QUOTED-PRINTABLE:J=C3=BCrgen =",
    "\u{1F600} M=C3=BCller",
    "NOTE;QUOTED-PRINTABLE:caf=C3=A9 \u{1F382}",
    "END:VCARD",
  ].join("\r\n"));
  assertEquals(source.cards[0]?.fullName, "Jürgen \u{1F600} Müller");
  assertEquals(source.cards[0]?.note, "café \u{1F382}");
});

Deno.test("[GAP-050] X-APPLE-OMIT-YEAR makes a birthday without a year", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:Ada",
    "BDAY;X-APPLE-OMIT-YEAR=1604:1604-12-10",
    "ANNIVERSARY;X-APPLE-OMIT-YEAR=1604:1835-07-08",
    "END:VCARD",
  ].join("\r\n"));
  same(source.cards[0]?.dates, [
    { day: 10, kind: "birthday", month: 12, precision: "month_day" },
    { day: 8, kind: "anniversary", month: 7, precision: "full", year: 1835 },
  ]);
});

Deno.test("[GAP-050] a name part or address part over its limit is counted as skipped", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:4.0",
    "FN:Dee",
    `N:${"x".repeat(501)};Dee;;;`,
    `ADR:;;${"s".repeat(1_001)};Town;;;`,
    "END:VCARD",
  ].join("\r\n"));
  same(source.cards[0], {
    addresses: [{ city: "Town" }],
    dates: [],
    emails: [],
    fullName: "Dee",
    givenName: "Dee",
    phones: [],
    urls: [],
  });
  same(source.skipped, { ADR: 1, N: 1 });
});

Deno.test("[GAP-050] a credential-like property is counted by name and its value never kept", () => {
  const source = parsed([
    "BEGIN:VCARD",
    "VERSION:4.0",
    "FN:Dee",
    "X-PASSWORD:hunter2",
    "X-API-KEY:sk-live-123",
    "END:VCARD",
  ].join("\r\n"));
  same(source.skipped, { "X-API-KEY": 1, "X-PASSWORD": 1 });
  const stored = JSON.stringify(source);
  assert(!stored.includes("hunter2") && !stored.includes("sk-live"), stored);
});
