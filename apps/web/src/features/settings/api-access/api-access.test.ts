import { describe, expect, it } from "vitest";
import type { ApiTokenRecord } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  apiAccessReducer,
  initialApiAccess,
  recordActivity,
  recordScope,
} from "./api-access.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const record = {
  createdAt: "2026-08-24T10:00:00.000Z",
  id: "t",
  name: "Desktop",
  scopes: ["people:read"],
} as ApiTokenRecord;

describe("API-001 API access state", () => {
  it("moves through its phases and keeps the secret until dismissed", () => {
    const ready = apiAccessReducer(initialApiAccess, {
      timePreferences: utc,
      type: "context",
    });
    expect(ready.phase).toBe("ready");
    const created = apiAccessReducer(ready, { secret: "s", type: "created" });
    expect(created).toMatchObject({
      secret: "s",
      status: "API token created. Copy the secret now.",
    });
    expect(apiAccessReducer(created, { type: "dismissed" })).toMatchObject({
      secret: undefined,
      status: "The one-time secret has been dismissed.",
    });
    expect(
      apiAccessReducer(ready, {
        records: [],
        scopes: ["people:read"],
        type: "loaded",
      }).status,
    )
      .toBe("API tokens are current.");
    const busy = apiAccessReducer(ready, {
      busy: true,
      message: "Working…",
      type: "busy",
    });
    expect(apiAccessReducer(busy, { busy: false, type: "busy" }))
      .toMatchObject({ busy: false, status: "Working…" });
    expect(apiAccessReducer(ready, { message: "x", type: "status" }).status)
      .toBe("x");
    expect(apiAccessReducer(ready, { type: "member" }).phase).toBe("member");
    expect(apiAccessReducer(ready, { type: "no-session" }).phase).toBe(
      "no-session",
    );
  });

  it("words each token's scope, expiry, and activity", () => {
    expect(recordScope(record, utc)).toBe("people:read · No expiry");
    expect(
      recordScope({ ...record, expiresAt: "2026-09-24T10:00:00.000Z" }, utc),
    ).toBe("people:read · Expires Sep 24, 2026, 10:00 AM");
    expect(recordActivity(record, utc)).toBe("Never used");
    expect(
      recordActivity(
        { ...record, lastUsedAt: "2026-08-24T12:00:00.000Z" },
        utc,
      ),
    ).toBe("Last used Aug 24, 2026, 12:00 PM");
    expect(
      recordActivity({ ...record, revokedAt: "2026-08-24T13:00:00.000Z" }, utc),
    ).toBe("Revoked Aug 24, 2026, 1:00 PM");
  });
});
