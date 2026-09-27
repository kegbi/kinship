// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { preferences, workspaceSession } from "../../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import {
  mountSecuritySettings,
  SECURITY_SESSIONS_ISLAND,
} from "./security-sessions.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const SESSIONS = "GET /api/v1/settings/sessions";
const REVOKE = "DELETE /api/v1/settings/sessions/:id";
const other = {
  createdAt: "2026-08-15T09:00:00Z",
  current: false,
  expiresAt: "2026-08-15T20:00:00Z",
  id: "00000000-0000-4000-8000-000000000010",
  ipAddress: "192.0.2.10",
  lastSeenAt: "2026-08-15T10:00:00Z",
  userAgent: "Firefox",
};
const current = {
  ...other,
  current: true,
  id: "00000000-0000-4000-8000-000000000011",
  ipAddress: undefined,
  userAgent: undefined,
};
const listed = (...sessions: object[]) =>
  jsonResponse({ sessions, status: "ready" });

function shell(): void {
  drawShell("<main><section data-settings-security></section></main>");
}

const mount = (navigate = vi.fn()) =>
  mountSettled(() => mountSecuritySettings(document, navigate));
const status = () => element("#settings-status");
const count = () => element("#session-count");

const base = {
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
  [SESSION]: jsonResponse(workspaceSession()),
};

afterEach(() => sessionStorage.clear());

describe("AUTH-004 security sessions", () => {
  it("does nothing when the section is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(SECURITY_SESSIONS_ISLAND).toBe("settings-security");
  });

  it("lists sessions with their last activity and revokes a selected one", async () => {
    shell();
    const revoked = deferred<Response>();
    const api = stubApi({
      ...base,
      [REVOKE]: revoked.promise,
      [SESSIONS]: [
        listed(other, current, {
          ...other,
          id: "00000000-0000-4000-8000-000000000012",
          userAgent: undefined,
        }),
        listed(current),
      ],
    });
    await mount();
    expect(count().textContent).toBe("3 active");
    expect(status().textContent).toBe("");
    const rows = within(element("#session-list")).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong")?.textContent))
      .toEqual(["Firefox", "This session", "Browser session"]);
    expect(rows[0]!.querySelector("small")?.textContent).toBe(
      "Last active Aug 15, 2026, 10:00 AM · 192.0.2.10",
    );
    expect(rows[1]!.querySelector("small")?.textContent).toBe(
      "Last active Aug 15, 2026, 10:00 AM",
    );
    await expectNoAxeViolations(document.body);
    const revoke = within(rows[0]!).getByRole<HTMLButtonElement>("button", {
      name: "Revoke",
    });
    act(() => {
      fireEvent.click(revoke);
    });
    expect(revoke.disabled).toBe(true);
    act(() => {
      fireEvent.click(revoke);
    });
    await act(async () => {
      revoked.resolve(jsonResponse({ current: false, status: "revoked" }));
      await revoked.promise;
    });
    await waitFor(() => expect(count().textContent).toBe("1 active"));
    expect(api.calls().filter((call) => call.startsWith("DELETE")))
      .toHaveLength(1);
    expect(
      api.requests().find((request) => request.method === "DELETE")
        ?.params,
    ).toEqual({ id: other.id });
  });

  it("signs out after revoking the current session", async () => {
    shell();
    stubApi({
      ...base,
      [REVOKE]: jsonResponse({ current: true, status: "revoked" }),
      [SESSIONS]: listed(current),
    });
    const navigate = vi.fn();
    await mount(navigate);
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Revoke and sign out" }),
      );
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/auth/sign-in"));
  });

  it("keeps a failed revocation visible and retryable", async () => {
    shell();
    stubApi({
      ...base,
      [REVOKE]: [
        problemResponse(409, { detail: "Session already ended." }),
        unreachable,
      ],
      [SESSIONS]: listed(other),
    });
    await mount();
    const revoke = screen.getByRole<HTMLButtonElement>("button", {
      name: "Revoke",
    });
    act(() => {
      fireEvent.click(revoke);
    });
    await waitFor(() =>
      expect(status().textContent).toBe("Session already ended.")
    );
    expect(revoke.disabled).toBe(false);
    act(() => {
      fireEvent.click(revoke);
    });
    await waitFor(() =>
      expect(status().textContent).toBe("Session could not be revoked.")
    );
    expect(revoke.disabled).toBe(false);
  });

  it("reports an empty list, an unavailable list, and an unconfirmed session", async () => {
    for (
      const [routes, message, badge] of [
        [{ ...base, [SESSIONS]: listed() }, "No active sessions.", "0 active"],
        [
          { ...base, [SESSIONS]: unreachable },
          "Your sessions could not be loaded.",
          "Loading…",
        ],
        [
          { [SESSION]: unreachable },
          "Your session could not be confirmed.",
          "Loading…",
        ],
      ] as const
    ) {
      shell();
      stubApi(routes);
      const unmount = await mount();
      expect(status().textContent).toBe(message);
      expect(count().textContent).toBe(badge);
      unmount();
    }
  });
});
