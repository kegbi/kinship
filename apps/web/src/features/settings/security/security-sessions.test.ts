import { describe, expect, it } from "vitest";
import type { MemberSession } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  initialSessions,
  sessionDetail,
  sessionsReducer,
} from "./security-sessions.ts";

const session: MemberSession = {
  createdAt: "2026-08-15T09:00:00Z",
  current: false,
  expiresAt: "2026-08-15T20:00:00Z",
  id: "a",
  lastSeenAt: "2026-08-15T10:00:00Z",
};

describe("AUTH-004 security sessions state", () => {
  it("loads, says when none are active, and holds each revocation", () => {
    const withContext = sessionsReducer(initialSessions, {
      timePreferences: { effectiveTimezone: "UTC", locale: "en" },
      type: "context",
    });
    expect(withContext.timePreferences?.locale).toBe("en");
    expect(sessionsReducer(withContext, { sessions: [], type: "loaded" }))
      .toMatchObject({ sessions: [], status: "No active sessions." });
    const loaded = sessionsReducer(withContext, {
      sessions: [session],
      type: "loaded",
    });
    expect(loaded.status).toBe("");
    const revoking = sessionsReducer(loaded, { id: "a", type: "revoking" });
    expect(revoking.revoking).toEqual(["a"]);
    expect(
      sessionsReducer(revoking, { id: "a", message: "Done.", type: "revoked" }),
    ).toMatchObject({ revoking: [], status: "Done." });
    expect(sessionsReducer(loaded, { message: "Down.", type: "status" }).status)
      .toBe("Down.");
  });

  it("names where a session was last active", () => {
    expect(sessionDetail(session, "then")).toBe("Last active then");
    expect(sessionDetail({ ...session, ipAddress: "192.0.2.1" }, "then"))
      .toBe("Last active then · 192.0.2.1");
  });
});
