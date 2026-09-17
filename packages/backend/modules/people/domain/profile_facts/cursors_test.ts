import { assert, assertEquals } from "../../../../testing/assert.ts";
import { encodeCursor } from "../../../../shared-kernel/pagination.ts";
import {
  decodeFactCursor,
  decodeOptionCursor,
  encodeFactCursor,
  encodeOptionCursor,
  factCursorMatches,
  optionCursorMatches,
  PROFILE_FACT_OPTION_PAGE_SIZE,
  PROFILE_FACT_PAGE_SIZE,
} from "./cursors.ts";

const factId = "10000000-0000-4000-8000-000000000005";
const personId = "10000000-0000-4000-8000-000000000004";
const updatedAt = "2026-08-16T12:00:00.000000Z";
const personUpdatedAt = "2026-08-16T12:30:00.000000Z";

const factBody = {
  id: factId,
  limit: PROFILE_FACT_PAGE_SIZE,
  personId,
  personUpdatedAt,
  section: "pets",
  updatedAt,
  version: 2,
};

const optionBody = {
  id: factId,
  limit: PROFILE_FACT_OPTION_PAGE_SIZE,
  personId,
  primary: "Cats",
  search: "ca",
  secondary: "0001",
  section: "pets",
  version: 2,
};

Deno.test("[GAP-015] a fact cursor round trips through its own codec", () => {
  assertEquals(PROFILE_FACT_PAGE_SIZE, 50);
  const cursor = encodeFactCursor({
    anchor: { id: factId, updatedAt },
    personId,
    personUpdatedAt,
    section: "pets",
  });
  assertEquals(cursor, encodeCursor(factBody), "the body is minted verbatim");
  assertEquals(decodeFactCursor(cursor), factBody);
});

Deno.test("[GAP-015] an unreadable or foreign fact cursor decodes to nothing", () => {
  for (
    const body of [
      { ...factBody, version: 1 },
      { ...factBody, limit: 25 },
      { ...factBody, id: "not-a-uuid" },
      { ...factBody, personId: "not-a-uuid" },
      { ...factBody, updatedAt: "2026-08-16T12:00:00.000Z" },
      { ...factBody, personUpdatedAt: "yesterday" },
      { ...factBody, section: 7 },
      { id: factId, limit: PROFILE_FACT_PAGE_SIZE, personId, version: 2 },
      {
        id: factId,
        limit: PROFILE_FACT_PAGE_SIZE,
        personId,
        section: "pets",
        updatedAt,
        version: 2,
      },
    ]
  ) {
    assertEquals(
      decodeFactCursor(encodeCursor(body)),
      undefined,
      `refused: ${JSON.stringify(body)}`,
    );
  }
  assertEquals(decodeFactCursor("not base64url!"), undefined);
});

Deno.test("[GAP-015] an option cursor round trips and carries its search", () => {
  assertEquals(PROFILE_FACT_OPTION_PAGE_SIZE, 50);
  const cursor = encodeOptionCursor({
    anchor: { id: factId, primary: "Cats", secondary: "0001" },
    personId,
    search: "ca",
    section: "pets",
  });
  assertEquals(decodeOptionCursor(cursor), {
    id: factId,
    primary: "Cats",
    secondary: "0001",
    limit: PROFILE_FACT_OPTION_PAGE_SIZE,
    personId,
    search: "ca",
    section: "pets",
    version: 2,
  });
});

Deno.test("[GAP-015] an unreadable or foreign option cursor decodes to nothing", () => {
  for (
    const body of [
      { ...optionBody, version: 3 },
      { ...optionBody, limit: 10 },
      { ...optionBody, id: "not-a-uuid" },
      { ...optionBody, personId: "not-a-uuid" },
      { ...optionBody, primary: 1 },
      { ...optionBody, secondary: 1 },
      { ...optionBody, search: 1 },
      { ...optionBody, section: 1 },
    ]
  ) {
    assertEquals(
      decodeOptionCursor(encodeCursor(body)),
      undefined,
      `refused: ${JSON.stringify(body)}`,
    );
  }
  assertEquals(decodeOptionCursor("~~~"), undefined);
});

Deno.test("[GAP-015] a cursor only answers the question it was minted for", () => {
  const cursor = decodeFactCursor(encodeCursor(factBody));
  assert(cursor !== undefined, "the pinned body decodes");
  assert(
    factCursorMatches(cursor, { personId, personUpdatedAt, section: "pets" }),
    "the same question matches",
  );
  assert(
    !factCursorMatches(undefined, {
      personId,
      personUpdatedAt,
      section: "pets",
    }),
    "an unreadable cursor never matches",
  );
  assert(
    !factCursorMatches(cursor, { personId, personUpdatedAt, section: "tags" }),
    "another section is another question",
  );
  assert(
    !factCursorMatches(cursor, {
      personId: factId,
      personUpdatedAt,
      section: "pets",
    }),
    "another person is another question",
  );
  assert(
    !factCursorMatches(cursor, {
      personId,
      personUpdatedAt: updatedAt,
      section: "pets",
    }),
    "an edited person restarts the listing",
  );
});

Deno.test("[GAP-015] an option cursor is bound to its person, section, and search", () => {
  const cursor = decodeOptionCursor(encodeCursor(optionBody));
  assert(cursor !== undefined, "the pinned body decodes");
  assert(
    optionCursorMatches(cursor, { personId, search: "ca", section: "pets" }),
    "the same question matches",
  );
  assert(
    !optionCursorMatches(undefined, {
      personId,
      search: "ca",
      section: "pets",
    }),
    "an unreadable cursor never matches",
  );
  assert(
    !optionCursorMatches(cursor, { personId, search: "ca", section: "tags" }),
    "another section is another question",
  );
  assert(
    !optionCursorMatches(cursor, {
      personId: factId,
      search: "ca",
      section: "pets",
    }),
    "another person is another question",
  );
  assert(
    !optionCursorMatches(cursor, { personId, search: "do", section: "pets" }),
    "another search is another question",
  );
});
