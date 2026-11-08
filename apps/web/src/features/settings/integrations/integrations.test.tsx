// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { INTEGRATIONS_ISLAND, mountIntegrations } from "./integrations.tsx";
import { clearSessionCache } from "../../../lib/workspace-context.ts";

const SESSION = "GET /api/v1/session";
const LIST = "GET /api/v1/settings/integrations/dav";
const CREATE = "POST /api/v1/settings/integrations/dav";
const SYNC = "POST /api/v1/settings/integrations/dav/:id/sync";
const DISABLE = "DELETE /api/v1/settings/integrations/dav/:id";
const record = {
  id: "00000000-0000-4000-8000-000000000010",
  isActive: true,
  lastOutcome: "never",
  name: "Personal DAV",
  remoteUrl: "https://dav.example.test/collection/",
};
const listed = (...subscriptions: object[]) =>
  jsonResponse({ status: "ready", subscriptions });
const base = {
  [SESSION]: jsonResponse(workspaceSession()),
};

function shell(): void {
  drawShell(
    "<main data-integrations><div data-integrations-surface></div></main>",
  );
}

const mount = () => mountSettled(() => mountIntegrations());
const state = () => element("[data-integration-state]");
const list = () => element("[data-integration-list]");
const form = () => element<HTMLFormElement>("[data-integration-create]");

function fill(values: Readonly<Record<string, string>>): void {
  act(() => {
    for (const [label, value] of Object.entries(values)) {
      fireEvent.input(screen.getByLabelText(label), { target: { value } });
    }
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

afterEach(() => sessionStorage.clear());

describe("INTEGRATION-001 DAV settings", () => {
  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(INTEGRATIONS_ISLAND).toBe("settings-integrations");
  });

  it("configures, synchronizes, shows partial retry state, and disables serially", async () => {
    shell();
    const synced = deferred<Response>();
    const partial = {
      ...record,
      lastError: "dav_sync_failed",
      lastOutcome: "partial",
    };
    const api = stubApi({
      ...base,
      [CREATE]: jsonResponse(
        { status: "configured", subscription: record },
        201,
      ),
      [DISABLE]: jsonResponse({
        status: "disabled",
        subscription: { ...partial, isActive: false },
      }),
      [LIST]: [
        listed(),
        listed(record),
        listed(partial),
        listed({ ...partial, isActive: false }),
      ],
      [SYNC]: synced.promise,
    });
    await mount();
    expect(state().textContent).toBe("DAV connection status is current.");
    expect(element("[data-integration-empty]").hidden).toBe(false);
    await expectNoAxeViolations(document.body);
    fill({
      "Connection name": " Personal DAV ",
      "DAV collection URL": "https://dav.example.test/collection/",
      Secret: "remote-secret",
      Username: "ada",
    });
    submit();
    await waitFor(() =>
      expect(within(list()).getByRole("listitem").textContent).toContain(
        "Not synchronized yet",
      )
    );
    expect(api.bodies()).toEqual([{
      name: "Personal DAV",
      password: "remote-secret",
      remoteUrl: "https://dav.example.test/collection/",
      username: "ada",
    }]);
    expect(document.body.textContent).not.toContain("remote-secret");
    expect(screen.getByLabelText<HTMLInputElement>("Secret").value).toBe("");
    const sync = within(list()).getByRole<HTMLButtonElement>("button", {
      name: "Sync now",
    });
    act(() => {
      fireEvent.click(sync);
    });
    expect(state().textContent).toBe("Synchronizing DAV…");
    const disable = within(list()).getByRole<HTMLButtonElement>("button", {
      name: "Disable",
    });
    expect([sync.disabled, disable.disabled]).toEqual([true, true]);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Add connection" })
        .disabled,
    ).toBe(true);
    act(() => {
      fireEvent.click(disable);
    });
    await act(async () => {
      synced.resolve(jsonResponse({
        processed: 1,
        status: "partial",
        subscription: partial,
      }));
      await synced.promise;
    });
    await waitFor(() =>
      expect(list().textContent).toContain(
        "Partially synchronized: Retry the synchronization.",
      )
    );
    expect(document.body.textContent).not.toContain("dav_sync_failed");
    await waitFor(() =>
      expect(
        within(list()).getByRole<HTMLButtonElement>("button", {
          name: "Retry",
        }).disabled,
      ).toBe(false)
    );
    expect(api.calls().filter((call) => call.startsWith("DELETE")))
      .toHaveLength(0);
    act(() => {
      fireEvent.click(
        within(list()).getByRole("button", { name: "Disable" }),
      );
    });
    await waitFor(() =>
      expect(
        within(list()).getByRole<HTMLButtonElement>("button", {
          name: "Disabled",
        }).disabled,
      ).toBe(true)
    );
    expect(list().textContent).toContain("Disabled");
    expect(api.calls().filter((call) => call.startsWith("DELETE")))
      .toHaveLength(1);
  });

  it("keeps a DAV secret submitted before the page loaded off the URL and adds it once loaded", async () => {
    shell();
    const session = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: jsonResponse({
        status: "configured",
        subscription: { ...record, name: "Early DAV" },
      }, 201),
      [LIST]: listed(),
      [SESSION]: session.promise,
    });
    const settled = mountPending(() => mountIntegrations());
    fill({
      "Connection name": "Early DAV",
      "DAV collection URL": "https://dav.example.test/collection/",
      Secret: "dav-secret",
    });
    const early = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      form().dispatchEvent(early);
    });
    expect(early.defaultPrevented).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Add connection",
        }).disabled,
      ).toBe(false)
    );
    expect(api.bodies()).toEqual([{
      name: "Early DAV",
      password: "dav-secret",
      remoteUrl: "https://dav.example.test/collection/",
    }]);
  });

  it("asks for every required field and reports refused operations", async () => {
    shell();
    stubApi({
      ...base,
      [CREATE]: [
        problemResponse(400, { detail: "Use a public HTTPS DAV URL." }),
        unreachable,
      ],
      [LIST]: listed({
        ...record,
        lastError: "dav_authentication_failed",
        lastOutcome: "auth-failure",
      }),
      [SYNC]: problemResponse(409, { detail: "Another sync is running." }),
    });
    await mount();
    expect(list().textContent).toContain(
      "Authentication failed: Check the saved DAV credentials.",
    );
    submit();
    expect(state().textContent).toBe(
      "Enter a name, public HTTPS DAV URL, and secret.",
    );
    fill({
      "Connection name": "Home",
      "DAV collection URL": "http://dav.example.test/",
      Secret: "secret",
    });
    submit();
    await waitFor(() =>
      expect(state().textContent).toBe("Use a public HTTPS DAV URL.")
    );
    submit();
    await waitFor(() =>
      expect(state().textContent).toBe(
        "The DAV connection could not be added.",
      )
    );
    act(() => {
      fireEvent.click(within(list()).getByRole("button", { name: "Retry" }));
    });
    await waitFor(() =>
      expect(state().textContent).toBe("Another sync is running.")
    );
  });

  it("hides management from a regular member and reports what could not load", async () => {
    for (
      const [routes, message, withForm] of [
        [
          {
            ...base,
            [SESSION]: jsonResponse(
              workspaceSession({ member: { id: ids.member, role: "member" } }),
            ),
          },
          "Integration management requires workspace owner or administrator access.",
          false,
        ],
        [
          { [SESSION]: unreachable },
          "Your session could not be confirmed.",
          true,
        ],
        [
          { ...base, [LIST]: problemResponse(503, { detail: "DAV is off." }) },
          "DAV is off.",
          true,
        ],
        [
          { ...base, [LIST]: unreachable },
          "Integrations could not be loaded.",
          true,
        ],
      ] as const
    ) {
      shell();
      clearSessionCache();
      stubApi(routes);
      const unmount = await mount();
      expect(state().textContent).toBe(message);
      expect(document.querySelector("[data-integration-create]") !== null)
        .toBe(withForm);
      unmount();
    }
  });
});
