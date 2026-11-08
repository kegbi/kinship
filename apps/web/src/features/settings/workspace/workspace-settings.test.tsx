// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { workspaceSession } from "../../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import {
  resolveWorkspaceSession,
  SESSION_CACHE_KEY,
} from "../../../lib/workspace-context.ts";
import {
  mountWorkspaceSettings,
  WORKSPACE_SETTINGS_ISLAND,
} from "./workspace-settings.tsx";

const SESSION = "GET /api/v1/session";
const WORKSPACE = "GET /api/v1/settings/workspace";
const SAVE = "PUT /api/v1/settings/workspace";
const value = {
  defaultCurrencyCode: "EUR",
  defaultLocale: "en",
  defaultReminderTime: "12:00",
  defaultTimezone: "Europe/Belgrade",
  name: "Circle",
  slug: "circle",
};
const loaded = (workspace: object = value) =>
  jsonResponse({
    status: "ready",
    supportedCurrencyCodes: ["EUR", "RSD", "USD"],
    workspace,
  });

function shell(): void {
  drawShell("<main><div data-settings-workspace></div></main>");
}

const mount = () => mountSettled(() => mountWorkspaceSettings());
const form = () => element<HTMLFormElement>("#workspace-form");
const status = () => element("#settings-status");
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

function type(input: HTMLInputElement, text: string): void {
  act(() => {
    fireEvent.input(input, {
      target: { value: text },
      inputType: "insertText",
    });
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

afterEach(() => sessionStorage.clear());

describe("WORKSPACE-001 workspace settings", () => {
  it("searches time zones and saves the selected value with the existing dirty and validation behavior", async () => {
    shell();
    const api = stubApi({
      [SAVE]: loaded(),
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    const timezone = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Default time zone",
    });
    act(() => timezone.focus());
    type(timezone, "moscow");
    fireEvent.click(
      await screen.findByRole("option", { name: "Europe/Moscow" }),
    );
    expect(timezone.value).toBe("Europe/Moscow");
    expect(new FormData(form()).getAll("defaultTimezone")).toEqual([
      "Europe/Moscow",
    ]);
    expect(document.body.textContent).toContain("Unsaved");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Workspace settings saved.")
    );
    expect(api.bodies()[0]).toMatchObject({ defaultTimezone: "Europe/Moscow" });
  });
  it("AUD-F3 drops the session after a save, so the next page reads the new default time zone", async () => {
    shell();
    const api = stubApi({
      [SAVE]: loaded({ ...value, defaultTimezone: "Europe/Moscow" }),
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    expect(sessionStorage.getItem(SESSION_CACHE_KEY)).not.toBeNull();
    type(field("Default time zone"), "Europe/Moscow");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Workspace settings saved.")
    );

    // A member without a time zone of their own takes the workspace's, so
    // the stored session's effective time zone is stale until it is read.
    expect(sessionStorage.getItem(SESSION_CACHE_KEY)).toBeNull();
    await resolveWorkspaceSession();
    expect(api.calls().filter((call) => call === SESSION)).toHaveLength(2);
  });

  it("keeps the session when a save is refused", async () => {
    shell();
    const api = stubApi({
      [SAVE]: problemResponse(400, {
        detail: "Review the workspace identity and default values.",
        errors: { defaultTimezone: "Enter a valid IANA time zone." },
      }),
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    type(field("Default time zone"), "Not/AZone");
    submit();
    await waitFor(() =>
      expect(field("Default time zone").getAttribute("aria-invalid")).toBe(
        "true",
      )
    );
    await resolveWorkspaceSession();
    expect(api.calls().filter((call) => call === SESSION)).toHaveLength(1);
  });

  it("does nothing when the form is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(WORKSPACE_SETTINGS_ISLAND).toBe("settings-workspace");
  });

  it("loads and saves active-workspace identity and defaults", async () => {
    shell();
    const api = stubApi({
      [SAVE]: loaded({ ...value, name: "Friends" }),
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    expect(field("Workspace name").value).toBe("Circle");
    expect(field("Default reminder time").value).toBe("12:00");
    await expectNoAxeViolations(document.body);
    type(field("Workspace name"), " Friends ");
    type(field("Workspace slug"), "");
    type(field("Default time zone"), "");
    type(field("Default currency"), "");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Workspace settings saved.")
    );
    expect(api.bodies()).toEqual([{
      defaultLocale: "en",
      defaultReminderTime: "12:00",
      name: "Friends",
    }]);
  });

  it("sends every optional default it holds, the currency chosen from the catalog", async () => {
    shell();
    const api = stubApi({
      [SAVE]: loaded(),
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded({
        defaultLocale: "en",
        defaultReminderTime: "09:30",
        name: "Circle",
      }),
    });
    await mount();
    expect(field("Workspace slug").value).toBe("");
    type(field("Workspace slug"), "circle");
    type(field("Default time zone"), "Europe/Belgrade");
    type(field("Default currency"), "EUR");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Workspace settings saved.")
    );
    expect(api.bodies()).toEqual([{
      defaultCurrencyCode: "EUR",
      defaultLocale: "en",
      defaultReminderTime: "09:30",
      defaultTimezone: "Europe/Belgrade",
      name: "Circle",
      slug: "circle",
    }]);
  });

  it("maps invalid defaults beside the fields they name", async () => {
    shell();
    stubApi({
      [SAVE]: [
        problemResponse(400, {
          detail: "Review the workspace identity and default values.",
          errors: { defaultTimezone: "Enter a valid IANA time zone." },
        }),
        problemResponse(400, {
          detail: "Review the workspace identity and default values.",
          errors: { defaultCurrencyCode: "Choose a supported currency." },
        }),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    const timezone = field("Default time zone");
    type(timezone, "Not/AZone");
    submit();
    await waitFor(() =>
      expect(timezone.getAttribute("aria-invalid")).toBe("true")
    );
    expect(element('[data-field-error="defaultTimezone"]').textContent).toBe(
      "Enter a valid IANA time zone.",
    );
    expect(document.activeElement).toBe(timezone);
    type(timezone, "Europe/Belgrade");
    const currency = field("Default currency");
    type(currency, "RSD");
    submit();
    await waitFor(() =>
      expect(currency.getAttribute("aria-invalid")).toBe("true")
    );
    expect(element("#default-currency-error").textContent).toBe(
      "Choose a supported currency.",
    );
    expect(document.activeElement).toBe(currency);
  });

  it("[GIFTS-001] offers the supported currencies and a none option", async () => {
    shell();
    stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded({ ...value, defaultCurrencyCode: "XAU" }),
    });
    await mount();
    const currency = screen.getByLabelText<HTMLSelectElement>(
      "Default currency",
    );
    expect([...currency.options].map((option) => option.value)).toEqual([
      "",
      "EUR",
      "RSD",
      "USD",
      "XAU",
    ]);
    expect(currency.options[0]?.textContent).toBe("None (US dollars)");
    expect(currency.value).toBe("XAU");
  });

  it("reports unavailable settings with the server's words and stays disabled", async () => {
    for (
      const [answer, message] of [
        [
          problemResponse(403, { detail: "Only owners and admins." }),
          "Only owners and admins.",
        ],
        [unreachable, "Workspace settings could not be loaded."],
      ] as const
    ) {
      shell();
      stubApi({
        [SESSION]: jsonResponse(workspaceSession()),
        [WORKSPACE]: answer,
      });
      const unmount = await mount();
      expect(status().textContent).toBe(message);
      expect(field("Workspace name").disabled).toBe(true);
      unmount();
    }
  });

  it("keeps a save retryable after a transport failure", async () => {
    shell();
    stubApi({
      [SAVE]: unreachable,
      [SESSION]: jsonResponse(workspaceSession()),
      [WORKSPACE]: loaded(),
    });
    await mount();
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Workspace settings could not be saved.",
      )
    );
  });
});
