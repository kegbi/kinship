import { assert, assertEquals } from "../../../../testing/assert.ts";
import {
  booleanValue,
  invalidOptionalText,
  MONICA_SOURCE_LIMITS,
  type ParsedMonicaSource,
  parseMonicaSource,
  redacted,
  safePath,
  sourceId,
  textValue,
  validOptionalBoolean,
} from "./monica_source.ts";

const LIMITS = { maxAttachmentBytes: 10 * 1024 * 1024 };

function source(tables: unknown, attachments?: unknown): unknown {
  return {
    format: "monica-json",
    version: 1,
    tables,
    ...(attachments === undefined ? {} : { attachments }),
  };
}

function parsed(value: unknown): ParsedMonicaSource {
  const result = parseMonicaSource(value, LIMITS);
  assert(typeof result !== "string", `expected a parsed source, got ${result}`);
  return result;
}

Deno.test("[GAP-018] text is trimmed and refused once it is too long", () => {
  assertEquals(textValue(" Ada "), "Ada");
  assertEquals(textValue("   "), undefined);
  assertEquals(textValue(""), undefined);
  assertEquals(textValue(7), undefined);
  assertEquals(textValue(undefined), undefined);
  assertEquals(textValue("x".repeat(501)), undefined);
  assertEquals(textValue("x".repeat(501), 600), "x".repeat(501));
});

Deno.test("[GAP-018] a source key may be written as a number or as text", () => {
  assertEquals(sourceId(0), "0");
  assertEquals(sourceId(42), "42");
  assertEquals(sourceId(-1), undefined);
  assertEquals(sourceId(1.5), undefined);
  assertEquals(sourceId(Number.MAX_SAFE_INTEGER + 2), undefined);
  assertEquals(sourceId(" 4 "), "4");
  assertEquals(sourceId("  "), undefined);
  assertEquals(sourceId("x".repeat(101)), undefined);
  assertEquals(sourceId(true), undefined);
});

Deno.test("[GAP-018] an optional column is unusable only when it is present and wrong", () => {
  const record = { blank: null, long: "x".repeat(20), text: "ok", wrong: 3 };
  assertEquals(invalidOptionalText(record, "absent", 5), false);
  assertEquals(invalidOptionalText(record, "blank", 5), false);
  assertEquals(invalidOptionalText(record, "text", 5), false);
  assertEquals(invalidOptionalText(record, "long", 5), true);
  assertEquals(invalidOptionalText(record, "wrong", 5), true);
});

Deno.test("[GAP-018] a flag may be written four ways", () => {
  assertEquals(booleanValue(true), true);
  assertEquals(booleanValue(1), true);
  assertEquals(booleanValue(false), false);
  assertEquals(booleanValue(0), false);
  assertEquals(booleanValue("yes"), false);
  assertEquals(validOptionalBoolean(undefined), true);
  assertEquals(validOptionalBoolean(true), true);
  assertEquals(validOptionalBoolean(false), true);
  assertEquals(validOptionalBoolean(1), true);
  assertEquals(validOptionalBoolean(0), true);
  assertEquals(validOptionalBoolean(null), false);
  assertEquals(validOptionalBoolean("1"), false);
});

Deno.test("[GAP-018] an attachment path may not climb out of the export", () => {
  assertEquals(safePath("avatars/ada.png"), "avatars/ada.png");
  assertEquals(
    safePath("avatars\\ada.png"),
    "avatars/ada.png",
    "a Windows-written export is judged by the same rule",
  );
  assertEquals(safePath("/etc/passwd"), undefined);
  assertEquals(safePath("../outside"), undefined);
  assertEquals(safePath("nested/../outside"), undefined);
  assertEquals(safePath(".."), undefined);
  assertEquals(safePath("C:/secrets"), undefined);
  assertEquals(safePath("c:\\secrets"), undefined);
  assertEquals(safePath("   "), undefined);
  assertEquals(safePath(9), undefined);
});

Deno.test("[GAP-018] a snapshot keeps scalars, drops secrets, and cuts long text", () => {
  assertEquals(
    redacted({
      api_key: "k",
      first_name: "Ada",
      id: 1,
      is_starred: true,
      nested: { a: 1 },
      list: [1],
      nothing: null,
      password: "p",
      remember_token: "r",
      two_factor_recovery_codes: "c",
      two_factor_secret: "s",
    }),
    { first_name: "Ada", id: 1, is_starred: true, nothing: null },
  );
  const cut = redacted({ note: "x".repeat(MONICA_SOURCE_LIMITS.text + 50) });
  assertEquals(
    (cut.note as string).length,
    MONICA_SOURCE_LIMITS.text,
    "a long column is cut rather than refused",
  );
});

Deno.test("[GAP-018] only the version 1 Monica JSON profile is read", () => {
  const message = "Only the version 1 Monica JSON export profile is supported.";
  assertEquals(parseMonicaSource(null, LIMITS), message);
  assertEquals(parseMonicaSource(7, LIMITS), message);
  assertEquals(parseMonicaSource([], LIMITS), message);
  assertEquals(parseMonicaSource({}, LIMITS), message);
  assertEquals(
    parseMonicaSource({ format: "monica-json", version: 2 }, LIMITS),
    message,
  );
  assertEquals(
    parseMonicaSource({ format: "vcard", version: 1 }, LIMITS),
    message,
  );
});

Deno.test("[GAP-018] the contacts table has to be a list of objects within the limit", () => {
  assertEquals(
    parseMonicaSource({ format: "monica-json", version: 1 }, LIMITS),
    "The export must contain at most 500 contacts.",
  );
  assertEquals(
    parseMonicaSource(source({}), LIMITS),
    "The export must contain at most 500 contacts.",
  );
  assertEquals(
    parseMonicaSource(
      source({
        contacts: Array.from(
          { length: MONICA_SOURCE_LIMITS.contacts + 1 },
          () => ({}),
        ),
      }),
      LIMITS,
    ),
    "The export must contain at most 500 contacts.",
  );
  assertEquals(
    parseMonicaSource(source({ contacts: [1] }), LIMITS),
    "Every contact must be an object.",
  );
});

Deno.test("[GAP-018] the attachment manifest is read strictly or not at all", () => {
  assertEquals(
    parseMonicaSource(source({ contacts: [] }, 5), LIMITS),
    "The manifest must contain at most 1000 attachments.",
  );
  assertEquals(
    parseMonicaSource(
      source(
        { contacts: [] },
        Array.from(
          { length: MONICA_SOURCE_LIMITS.attachments + 1 },
          () => ({}),
        ),
      ),
      LIMITS,
    ),
    "The manifest must contain at most 1000 attachments.",
  );
  const invalid = "The attachment manifest is invalid.";
  for (
    const attachment of [
      "not an object",
      { byteSize: 1, present: true },
      { path: "/absolute", byteSize: 1, present: true },
      { path: "a", byteSize: -1, present: true },
      { path: "a", byteSize: 1.5, present: true },
      { path: "a", byteSize: LIMITS.maxAttachmentBytes + 1, present: true },
      { path: "a", byteSize: 1, present: "yes" },
    ]
  ) {
    assertEquals(
      parseMonicaSource(source({ contacts: [] }, [attachment]), LIMITS),
      invalid,
      JSON.stringify(attachment),
    );
  }
  assertEquals(
    parseMonicaSource(
      source({ contacts: [] }, [
        { path: "a", byteSize: 1, present: true },
        { path: "a", byteSize: 2, present: false },
      ]),
      LIMITS,
    ),
    invalid,
    "two entries cannot claim the same path",
  );
  assertEquals(
    [
      ...parsed(source({ contacts: [] }, [
        { path: "avatars\\ada.png", byteSize: 12, present: true },
      ])).attachments.entries(),
    ],
    [["avatars/ada.png", {
      byteSize: 12,
      path: "avatars/ada.png",
      present: true,
    }]],
  );
});

Deno.test("[GAP-018] the legacy user list is counted, and refused when it is not a list", () => {
  assertEquals(
    parseMonicaSource(source({ contacts: [], users: 3 }), LIMITS),
    "The legacy user list is invalid.",
  );
  assertEquals(
    parseMonicaSource(
      source({
        contacts: [],
        users: Array.from(
          { length: MONICA_SOURCE_LIMITS.legacyUsers + 1 },
          () => ({}),
        ),
      }),
      LIMITS,
    ),
    "The legacy user list is invalid.",
  );
  assertEquals(parsed(source({ contacts: [], users: [{}, {}] })).userCount, 2);
  assertEquals(parsed(source({ contacts: [] })).userCount, 0);
});

Deno.test("[GAP-018] everything the profile does not understand is counted, not dropped silently", () => {
  const result = parsed(source({
    contacts: [{ first_name: "Ada", id: 1, introduced_by: 4, notes: "n" }],
    users: [{}],
    activities: [{}, {}, {}],
    settings: 1,
  }));
  assertEquals(
    result.unsupported,
    6,
    "three activity rows, one non-list table, and two unsupported contact columns",
  );
  assertEquals(result.contacts.length, 1);
  assertEquals(result.userCount, 1);
});
