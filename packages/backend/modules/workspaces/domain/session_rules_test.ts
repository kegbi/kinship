import { assertEquals } from "../../../testing/assert.ts";
import {
  client,
  protectedSessionHttpStatus,
  type ProtectedSessionResult,
  requested,
  UNKNOWN_USER_ID,
} from "./session_rules.ts";

Deno.test("[GAP-018] every way a sign-in ends maps to exactly one status", () => {
  const results: readonly [ProtectedSessionResult, number][] = [
    [{
      expiresAt: new Date(0),
      member: { id: "m1", role: "owner" },
      sessionToken: "t",
      status: "authenticated",
      userId: "u1",
      workspace: { id: "w1", name: "Home" },
    }, 200],
    [{
      entryToken: "e",
      expiresAt: new Date(0),
      status: "identity-authenticated",
    }, 200],
    [{ challengeToken: "c", status: "mfa-required" }, 202],
    [{ status: "invalid-credentials" }, 401],
    [{ status: "invalid-mfa" }, 401],
    [{ status: "membership-inactive" }, 403],
    [{ status: "challenge-expired" }, 410],
    [{ retryAfterSeconds: 30, status: "rate-limited" }, 429],
  ];
  for (const [result, expected] of results) {
    assertEquals(
      protectedSessionHttpStatus(result),
      expected,
      `${result.status} is ${expected}`,
    );
  }
});

Deno.test("[GAP-018] a failure with nobody to name is still recorded", () => {
  assertEquals(UNKNOWN_USER_ID, "00000000-0000-0000-0000-000000000000");
});

Deno.test("[GAP-018] an empty address or agent is an absent one", () => {
  assertEquals(
    client({ ipAddress: "203.0.113.7", userAgent: "curl" }),
    { ipAddress: "203.0.113.7", userAgent: "curl" },
  );
  assertEquals(client({ ipAddress: "203.0.113.7" }), {
    ipAddress: "203.0.113.7",
  });
  assertEquals(client({ userAgent: "curl" }), { userAgent: "curl" });
  assertEquals(client({}), {});
  assertEquals(
    Object.keys(client({ ipAddress: "", userAgent: "" })),
    [],
    "a blank is left out rather than sent on as an empty string",
  );
});

Deno.test("[GAP-018] a workspace is only requested when one was named", () => {
  assertEquals(requested({ requestedWorkspaceId: "w1" }), {
    requestedWorkspaceId: "w1",
  });
  assertEquals(requested({}), {});
  assertEquals(Object.keys(requested({ requestedWorkspaceId: "" })), []);
});
