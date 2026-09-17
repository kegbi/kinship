import { assert, assertEquals } from "../../../testing/assert.ts";
import { canonicalJson } from "./formats/canonical.ts";
import {
  type ParsedMonicaSource,
  parseMonicaSource,
} from "./formats/monica_source.ts";
import {
  importedPerson,
  importReport,
  sourceFingerprint,
  stageContacts,
  type StagedContact,
} from "./import_rules.ts";

const LIMITS = { maxAttachmentBytes: 10 * 1024 * 1024 };

function parse(
  contacts: readonly unknown[],
  extra: Record<string, unknown> = {},
): ParsedMonicaSource {
  const result = parseMonicaSource({
    format: "monica-json",
    version: 1,
    tables: { contacts },
    ...extra,
  }, LIMITS);
  assert(typeof result !== "string", `expected a parsed source, got ${result}`);
  return result;
}

function counter(): () => string {
  let next = 0;
  return () => `id-${++next}`;
}

function staged(
  contacts: readonly unknown[],
  extra: Record<string, unknown> = {},
): readonly StagedContact[] {
  const result = stageContacts(parse(contacts, extra), counter());
  assert(typeof result !== "string", `expected staged contacts: ${result}`);
  return result.contacts;
}

Deno.test("[GAP-018] a contact becomes a staging row with the identifiers the caller supplies", () => {
  assertEquals(
    staged([{
      description: " a note ",
      first_name: " Ada ",
      food_preferences: "cake",
      id: 1,
      is_active: 0,
      is_dead: 1,
      is_partial: true,
      is_starred: 1,
      last_name: " Lovelace ",
      middle_name: "Byron",
      nickname: "Addy",
      uuid: "2A5B6C7D-8E9F-4A1B-9C2D-3E4F5A6B7C8D",
    }]),
    [{
      familyName: "Lovelace",
      description: "a note",
      foodPreferences: "cake",
      givenName: "Ada",
      archived: true,
      isDeceased: true,
      isPartial: true,
      isStarred: true,
      nickname: "Addy",
      middleName: "Byron",
      rawSnapshot: {
        description: " a note ",
        first_name: " Ada ",
        food_preferences: "cake",
        id: 1,
        is_active: 0,
        is_dead: 1,
        is_partial: true,
        is_starred: 1,
        last_name: " Lovelace ",
        middle_name: "Byron",
        nickname: "Addy",
        uuid: "2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d",
      },
      sourcePrimaryKey: "1",
      sourceUuid: "2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d",
      targetPersonId: "id-1",
    }],
  );
});

Deno.test("[GAP-018] the snapshot keeps what the source said, and the row keeps what it meant", () => {
  const [contact] = staged([{ first_name: "Ada", id: 1, password: "hunter2" }]);
  assert(contact, "one contact staged");
  assertEquals(contact.rawSnapshot, { first_name: "Ada", id: 1 });
  assertEquals(contact.archived, false, "an absent is_active is not archived");
  assertEquals(contact.sourceUuid, undefined);
  assertEquals(contact.deletedAt, undefined);
});

Deno.test("[GAP-018] one unusable contact makes the whole source unusable", () => {
  const identity =
    "Every contact needs unique valid source identity, first_name, and timestamps.";
  for (
    const [reason, contact] of [
      ["no key", { first_name: "Ada" }],
      ["an unusable key", { id: -1, first_name: "Ada" }],
      ["no first name", { id: 1 }],
      ["a blank first name", { id: 1, first_name: "   " }],
      ["a long middle name", {
        id: 1,
        first_name: "A",
        middle_name: "x".repeat(501),
      }],
      ["a long last name", {
        id: 1,
        first_name: "A",
        last_name: "x".repeat(501),
      }],
      ["a long nickname", {
        id: 1,
        first_name: "A",
        nickname: "x".repeat(501),
      }],
      ["a long description", {
        id: 1,
        first_name: "A",
        description: "x".repeat(10_001),
      }],
      ["long food preferences", {
        id: 1,
        first_name: "A",
        food_preferences: "x".repeat(10_001),
      }],
      ["an unusable is_active", { id: 1, first_name: "A", is_active: "yes" }],
      ["an unusable is_dead", { id: 1, first_name: "A", is_dead: "yes" }],
      ["an unusable is_partial", { id: 1, first_name: "A", is_partial: "yes" }],
      ["an unusable is_starred", { id: 1, first_name: "A", is_starred: "yes" }],
      ["a blank uuid", { id: 1, first_name: "A", uuid: "  " }],
      ["a uuid that is not one", {
        id: 1,
        first_name: "A",
        uuid: "not-a-uuid",
      }],
      [
        "a version 8 uuid, which only this backend derives",
        {
          id: 1,
          first_name: "A",
          uuid: "2a5b6c7d-8e9f-8a1b-9c2d-3e4f5a6b7c8d",
        },
      ],
      ["a deleted_at that is not text", {
        id: 1,
        first_name: "A",
        deleted_at: 5,
      }],
      ["a deleted_at that is not a time", {
        id: 1,
        first_name: "A",
        deleted_at: "soon",
      }],
    ] as const
  ) {
    assertEquals(
      stageContacts(parse([contact]), counter()),
      identity,
      `a contact with ${reason} is refused`,
    );
  }
  assertEquals(
    stageContacts(
      parse([{ id: 1, first_name: "A" }, { id: "1", first_name: "B" }]),
      counter(),
    ),
    identity,
    "two contacts cannot claim the same key",
  );
  assertEquals(
    stageContacts(
      parse([
        {
          id: 1,
          first_name: "A",
          uuid: "2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d",
        },
        {
          id: 2,
          first_name: "B",
          uuid: "2A5B6C7D-8E9F-4A1B-9C2D-3E4F5A6B7C8D",
        },
      ]),
      counter(),
    ),
    identity,
    "nor the same identity in another case",
  );
  assertEquals(
    stageContacts(
      parse([{ id: 1, first_name: "A", avatar_file_name: "../escape.png" }]),
      counter(),
    ),
    "A contact avatar path is unsafe.",
  );
});

Deno.test("[GAP-018] an absent or unsent attachment is staged as missing", () => {
  const present = stageContacts(
    parse(
      [{ id: 1, first_name: "A", avatar_file_name: "avatars\\a.png" }],
      { attachments: [{ path: "avatars/a.png", byteSize: 12, present: true }] },
    ),
    counter(),
  );
  assert(typeof present !== "string", "staged");
  assertEquals(present.missingFiles, 0);
  assertEquals(present.contacts[0]?.avatar, {
    byteSize: 12,
    fileId: "id-1",
    originalFilename: "avatars/a.png",
    present: true,
  });

  const declared = stageContacts(
    parse(
      [{ id: 1, first_name: "A", avatar_file_name: "avatars/a.png" }],
      {
        attachments: [{ path: "avatars/a.png", byteSize: 12, present: false }],
      },
    ),
    counter(),
  );
  assert(typeof declared !== "string", "staged");
  assertEquals(declared.missingFiles, 1);
  assertEquals(declared.contacts[0]?.avatar?.present, false);

  const unlisted = stageContacts(
    parse([{ id: 1, first_name: "A", avatar_file_name: "avatars/a.png" }]),
    counter(),
  );
  assert(typeof unlisted !== "string", "staged");
  assertEquals(unlisted.missingFiles, 1);
  assertEquals(unlisted.contacts[0]?.avatar, {
    byteSize: 0,
    fileId: "id-1",
    originalFilename: "avatars/a.png",
    present: false,
  });
});

Deno.test("[GAP-018] a count of zero says nothing at all", () => {
  assertEquals(
    importReport({
      contacts: 3,
      legacyCredentialsDiscarded: 0,
      missingFiles: 0,
      orphans: 0,
      unsupported: 0,
    }),
    {
      counts: {
        contacts: 3,
        legacyCredentialsDiscarded: 0,
        missingFiles: 0,
        orphans: 0,
        unsupported: 0,
      },
      diagnostics: [],
    },
  );
});

Deno.test("[GAP-018] every count that is not zero is explained once", () => {
  assertEquals(
    importReport({
      contacts: 1,
      legacyCredentialsDiscarded: 2,
      missingFiles: 3,
      orphans: 4,
      unsupported: 5,
    }).diagnostics,
    [
      {
        code: "legacy-credentials-discarded",
        message:
          "2 legacy user record(s) will not create identities, sessions, passwords, API keys, or factors.",
        severity: "skipped",
      },
      {
        code: "missing-attachment",
        message:
          "3 attachment reference(s) will be represented as missing metadata.",
        severity: "warning",
      },
      {
        code: "orphaned-reference",
        message:
          "4 contact reference(s) cannot be resolved and will be skipped.",
        severity: "warning",
      },
      {
        code: "unsupported-data",
        message: "5 unsupported record(s) will be skipped.",
        severity: "skipped",
      },
    ],
  );
});

Deno.test("[GAP-018] the source fingerprint is pinned to a fixed vector", async () => {
  const parsed = parse(
    [{
      avatar_file_name: "avatars/ada.png",
      first_name: "Ada",
      id: 1,
      is_starred: 1,
      last_name: "Lovelace",
      password: "hunter2",
      uuid: "2A5B6C7D-8E9F-4A1B-9C2D-3E4F5A6B7C8D",
    }],
    {
      attachments: [{ byteSize: 12, path: "avatars/ada.png", present: true }],
      tables: {
        contacts: [{
          avatar_file_name: "avatars/ada.png",
          first_name: "Ada",
          id: 1,
          is_starred: 1,
          last_name: "Lovelace",
          password: "hunter2",
          uuid: "2A5B6C7D-8E9F-4A1B-9C2D-3E4F5A6B7C8D",
        }],
        users: [{ id: 9 }],
      },
    },
  );
  const rows = stageContacts(parsed, counter());
  assert(typeof rows !== "string", "staged");
  assertEquals(
    canonicalJson({
      attachments: [...parsed.attachments.values()],
      contacts: rows.contacts.map((contact) => ({
        rawSnapshot: contact.rawSnapshot,
        sourcePrimaryKey: contact.sourcePrimaryKey,
        sourceUuid: contact.sourceUuid,
      })),
      unsupported: parsed.unsupported,
      userCount: parsed.userCount,
    }),
    '{"attachments":[{"byteSize":12,"path":"avatars/ada.png","present":true}],"contacts":[{"rawSnapshot":{"avatar_file_name":"avatars/ada.png","first_name":"Ada","id":1,"is_starred":1,"last_name":"Lovelace","uuid":"2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d"},"sourcePrimaryKey":"1","sourceUuid":"2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d"}],"unsupported":1,"userCount":1}',
    "the text the fingerprint signs",
  );
  assertEquals(
    await sourceFingerprint(parsed, rows.contacts),
    "1a9dd30898928f52a1c2d2cc183e83e63a79f0cbc42b26a2147f0ec0fd751449",
  );
});

Deno.test("[GAP-018] the fingerprint ignores the identifiers this backend minted", async () => {
  const parsed = parse([{ first_name: "Ada", id: 1 }]);
  const first = stageContacts(parsed, counter());
  let other = 100;
  const second = stageContacts(parsed, () => `other-${++other}`);
  assert(typeof first !== "string" && typeof second !== "string", "staged");
  assertEquals(
    first.contacts[0]?.targetPersonId === second.contacts[0]?.targetPersonId,
    false,
    "two dry runs of the same file mint different people",
  );
  assertEquals(
    await sourceFingerprint(parsed, first.contacts),
    await sourceFingerprint(parsed, second.contacts),
    "and still fingerprint the same",
  );
});

Deno.test("[GAP-018] an absent source identity is part of what is signed", async () => {
  const withUuid = parse([{
    first_name: "Ada",
    id: 1,
    uuid: "2a5b6c7d-8e9f-4a1b-9c2d-3e4f5a6b7c8d",
  }]);
  const without = parse([{ first_name: "Ada", id: 1 }]);
  const a = stageContacts(withUuid, counter());
  const b = stageContacts(without, counter());
  assert(typeof a !== "string" && typeof b !== "string", "staged");
  assertEquals(
    await sourceFingerprint(withUuid, a.contacts) ===
      await sourceFingerprint(without, b.contacts),
    false,
  );
});

Deno.test("[GAP-018] a committed contact becomes a person under the settled identifier", () => {
  assertEquals(
    importedPerson({
      archived: true,
      deletedAt: "2026-02-01T00:00:00.000Z",
      description: "d",
      familyName: "Lovelace",
      foodPreferences: "cake",
      givenName: "Ada",
      isDeceased: true,
      isPartial: true,
      isStarred: true,
      middleName: "Byron",
      nickname: "Addy",
      sourcePrimaryKey: "1",
      targetPersonId: "fresh",
    }, "settled"),
    {
      archived: true,
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
      description: "d",
      familyName: "Lovelace",
      foodPreferences: "cake",
      givenName: "Ada",
      id: "settled",
      isDeceased: true,
      isPartial: true,
      isStarred: true,
      middleName: "Byron",
      nickname: "Addy",
    },
  );
  assertEquals(
    importedPerson({
      archived: false,
      givenName: "Solo",
      isDeceased: false,
      isPartial: false,
      isStarred: false,
      sourcePrimaryKey: "2",
      targetPersonId: "fresh",
    }, "fresh"),
    {
      archived: false,
      givenName: "Solo",
      id: "fresh",
      isDeceased: false,
      isPartial: false,
      isStarred: false,
    },
  );
});
