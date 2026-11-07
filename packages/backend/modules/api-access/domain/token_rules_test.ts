import { assertEquals, assertThrows } from "../../../testing/assert.ts";
import {
  API_TOKEN_SCOPES,
  type ApiTokenRecord,
  CALENDAR_FEED_SCOPE,
  listedTokens,
  parseCalendarFeedToken,
  parseToken,
  renderCalendarFeedToken,
  renderToken,
  usable,
  validateApiToken,
} from "./token_rules.ts";

const ID = "3f1d2c4b-5a6e-4f7a-8b9c-0d1e2f3a4b5c";
const SECRET = "abcdefghijklmnop";
const NOW = new Date("2026-03-01T10:00:00.000Z");

const RECORD: ApiTokenRecord = {
  createdAt: "2026-02-01T10:00:00.000Z",
  id: ID,
  name: "CLI",
  scopes: ["people:read"],
};

Deno.test("[GAP-018] the scope vocabulary is closed", () => {
  assertEquals(API_TOKEN_SCOPES, [
    "people:read",
    "people:profile:read",
    "relationships:read",
    "tasks:read",
    "tasks:create",
    "tasks:write",
    "interactions:create",
  ]);
  const scopes = [...API_TOKEN_SCOPES];
  assertEquals(validateApiToken({ name: "Connector", scopes }, NOW), {
    name: "Connector",
    scopes,
  });
  assertEquals(
    usable({
      now: NOW,
      record: RECORD,
      requiredScope: "people:profile:read",
      workspaceId: "w",
    }),
    false,
  );
  assertEquals(
    usable({
      now: NOW,
      record: RECORD,
      requiredScope: "relationships:read",
      workspaceId: "w",
    }),
    false,
  );
});

Deno.test("[GAP-018] a presented token is split into a row to find and a secret to check", () => {
  assertEquals(parseToken(renderToken(ID, SECRET)), { id: ID, secret: SECRET });
  assertEquals(renderToken(ID, SECRET), `kin_pat_${ID}.${SECRET}`);
  assertEquals(
    parseToken(
      `KIN_PAT_${ID.toUpperCase()}.${SECRET}`.replace("KIN_PAT_", "kin_pat_"),
    ),
    { id: ID.toUpperCase(), secret: SECRET },
    "the identifier is matched in either case",
  );
});

Deno.test("[GAP-018] anything that is not this module's token is refused before a query", () => {
  for (
    const [reason, text] of [
      ["nothing", ""],
      ["no prefix", `${ID}.${SECRET}`],
      ["another prefix", `pat_${ID}.${SECRET}`],
      ["no secret", `kin_pat_${ID}`],
      ["a short secret", `kin_pat_${ID}.short`],
      ["a long secret", `kin_pat_${ID}.${"a".repeat(129)}`],
      ["a secret with punctuation", `kin_pat_${ID}.${"a".repeat(15)}!`],
      ["an identifier that is not one", `kin_pat_not-a-uuid.${SECRET}`],
      [
        "a derived identifier, which this module never mints",
        `kin_pat_3f1d2c4b-5a6e-8f7a-8b9c-0d1e2f3a4b5c.${SECRET}`,
      ],
      ["a trailing newline", `kin_pat_${ID}.${SECRET}\n`],
    ] as const
  ) {
    assertEquals(parseToken(text), undefined, `a token with ${reason}`);
  }
});

Deno.test("[GAP-018] a token needs a name, at least one known scope, and a future expiry", () => {
  assertEquals(
    validateApiToken({ name: "  CLI  ", scopes: ["people:read"] }, NOW),
    { name: "CLI", scopes: ["people:read"] },
  );
  assertEquals(
    validateApiToken({
      expiresAt: "2026-04-01T10:00:00.000Z",
      name: "CLI",
      scopes: ["people:read"],
    }, NOW),
    {
      expiresAt: new Date("2026-04-01T10:00:00.000Z"),
      name: "CLI",
      scopes: ["people:read"],
    },
  );
  assertEquals(
    validateApiToken({ name: "   ", scopes: ["people:read"] }, NOW),
    undefined,
  );
  assertEquals(
    validateApiToken({ name: "x".repeat(101), scopes: ["people:read"] }, NOW),
    undefined,
  );
  assertEquals(validateApiToken({ name: "CLI", scopes: [] }, NOW), undefined);
  assertEquals(
    validateApiToken(
      { name: "CLI", scopes: ["people:read", "people:read"] },
      NOW,
    ),
    undefined,
    "a repeated scope did not describe what it meant",
  );
  assertEquals(
    validateApiToken(
      { name: "CLI", scopes: ["people:write" as "people:read"] },
      NOW,
    ),
    undefined,
  );
  assertEquals(
    validateApiToken(
      { expiresAt: "not a time", name: "CLI", scopes: ["people:read"] },
      NOW,
    ),
    undefined,
  );
  assertEquals(
    validateApiToken(
      { expiresAt: NOW.toISOString(), name: "CLI", scopes: ["people:read"] },
      NOW,
    ),
    undefined,
    "a token that expires the moment it is minted is useless",
  );
  assertEquals(
    validateApiToken(
      {
        expiresAt: "2026-01-01T10:00:00.000Z",
        name: "CLI",
        scopes: ["people:read"],
      },
      NOW,
    ),
    undefined,
  );
});

Deno.test("[GAP-018] a good token is usable and every cheap reason to refuse is checked", () => {
  const base = {
    now: NOW,
    record: RECORD,
    requiredScope: "people:read" as const,
    workspaceId: "w1",
  };
  assertEquals(usable(base), true);
  assertEquals(
    usable({
      ...base,
      record: { ...RECORD, revokedAt: "2026-02-02T00:00:00.000Z" },
    }),
    false,
  );
  assertEquals(
    usable({
      ...base,
      record: { ...RECORD, expiresAt: "2026-02-02T00:00:00.000Z" },
    }),
    false,
  );
  assertEquals(
    usable({
      ...base,
      record: { ...RECORD, expiresAt: "2026-04-02T00:00:00.000Z" },
    }),
    true,
  );
  assertEquals(
    usable({ ...base, record: { ...RECORD, scopes: [] } }),
    false,
  );
  assertEquals(usable({ ...base, requestedWorkspaceId: "w1" }), true);
  assertEquals(
    usable({ ...base, requestedWorkspaceId: "w2" }),
    false,
    "a token cannot reach a workspace its owner is not acting in",
  );
});

Deno.test("[INTEGRATION-002] a calendar feed secret is its own spelling", () => {
  const feed = renderCalendarFeedToken(ID, SECRET);
  assertEquals(feed, `kin_cal_${ID}.${SECRET}`);
  assertEquals(parseCalendarFeedToken(feed), { id: ID, secret: SECRET });
  assertEquals(parseToken(feed), undefined, "never a personal token");
  assertEquals(
    parseCalendarFeedToken(renderToken(ID, SECRET)),
    undefined,
    "a personal token is never a feed",
  );
  for (
    const presented of [
      `${feed}.ics`,
      `kin_cal_${ID}.short`,
      `kin_cal_not-a-uuid.${SECRET}`,
      `kin_cal_${ID.replace("-4f7a-", "-1f7a-")}.${SECRET}`,
    ]
  ) {
    assertEquals(parseCalendarFeedToken(presented), undefined, presented);
  }
});

Deno.test("[INTEGRATION-002] the calendar scope opens only a calendar token", () => {
  const feed: ApiTokenRecord = { ...RECORD, scopes: [CALENDAR_FEED_SCOPE] };
  const command = { now: NOW, workspaceId: "w" };
  assertEquals(
    usable({ ...command, record: feed, requiredScope: CALENDAR_FEED_SCOPE }),
    true,
  );
  assertEquals(
    usable({ ...command, record: feed, requiredScope: "people:read" }),
    false,
  );
  assertEquals(
    usable({ ...command, record: RECORD, requiredScope: CALENDAR_FEED_SCOPE }),
    false,
  );
});

Deno.test("[AUD-M4] each listed token names its issuer, and an unnamed one is a broken read", () => {
  const issuer = { email: "ada@example.test", name: "Ada", userId: "u1" };
  assertEquals(
    listedTokens([{ ...RECORD, userId: "u1" }], [issuer]),
    [{ ...RECORD, issuer: { email: "ada@example.test", name: "Ada" } }],
  );
  assertThrows(
    () => listedTokens([{ ...RECORD, userId: "u2" }], [issuer]),
    "a token without a named issuer was listed",
  );
});
