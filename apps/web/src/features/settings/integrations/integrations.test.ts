import { describe, expect, it } from "vitest";
import type { DavSubscription } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  initialIntegrations,
  integrationsReducer,
  needsRetry,
  subscriptionStatus,
} from "./integrations.ts";

const subscription = (
  overrides: Partial<DavSubscription> = {},
): DavSubscription => ({
  id: "a",
  isActive: true,
  lastOutcome: "never",
  name: "Home",
  remoteUrl: "https://dav.example.test/",
  ...overrides,
});
const utc = { effectiveTimezone: "UTC", locale: "en" };

describe("INTEGRATION-001 DAV state", () => {
  it("moves through its phases and holds one operation", () => {
    const ready = integrationsReducer(initialIntegrations, {
      timePreferences: utc,
      type: "context",
    });
    expect(ready.phase).toBe("ready");
    const busy = integrationsReducer(ready, {
      busy: true,
      message: "Working…",
      type: "busy",
    });
    expect(busy).toMatchObject({ busy: true, status: "Working…" });
    expect(integrationsReducer(busy, { busy: false, type: "busy" }))
      .toMatchObject({ busy: false, status: "Working…" });
    expect(integrationsReducer(ready, { subscriptions: [], type: "loaded" }))
      .toMatchObject({
        status: "DAV connection status is current.",
        subscriptions: [],
      });
    expect(integrationsReducer(ready, { message: "x", type: "status" }).status)
      .toBe("x");
    expect(integrationsReducer(initialIntegrations, { type: "member" }).phase)
      .toBe("member");
    expect(
      integrationsReducer(initialIntegrations, { type: "no-session" }).status,
    ).toBe("Your session could not be confirmed.");
  });

  it("words every outcome without the server's codes", () => {
    expect(subscriptionStatus(subscription({ isActive: false }), utc)).toBe(
      "Disabled",
    );
    expect(subscriptionStatus(subscription(), utc)).toBe(
      "Not synchronized yet",
    );
    expect(subscriptionStatus(subscription({ lastOutcome: "success" }), utc))
      .toBe("Synchronized");
    expect(
      subscriptionStatus(
        subscription({
          lastOutcome: "success",
          lastSyncedAt: "2026-08-15T10:00:00Z",
        }),
        utc,
      ),
    ).toBe("Synchronized Aug 15, 2026, 10:00 AM");
    expect(
      subscriptionStatus(
        subscription({
          lastError: "dav_remote_conflict",
          lastOutcome: "conflict",
        }),
        utc,
      ),
    ).toBe("Conflict needs retry: Retry to refresh the remote collection.");
    expect(
      subscriptionStatus(
        subscription({ lastError: "dav_claim_lost", lastOutcome: "partial" }),
        utc,
      ),
    ).toBe(
      "Partially synchronized: Another synchronization took ownership. Retry.",
    );
    expect(
      subscriptionStatus(
        subscription({ lastError: "constructor", lastOutcome: "partial" }),
        utc,
      ),
    ).toBe("Partially synchronized");
    expect(
      subscriptionStatus(subscription({ lastOutcome: "auth-failure" }), utc),
    ).toBe("Authentication failed");
    expect(needsRetry(subscription({ lastOutcome: "conflict" }))).toBe(true);
    expect(needsRetry(subscription({ lastOutcome: "success" }))).toBe(false);
  });
});
