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
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import { MEMBER_LAYOUT_SAVED_EVENT } from "../../../lib/app-shell.ts";
import {
  mountPreferenceSettings,
  PREFERENCE_SETTINGS_ISLAND,
} from "./preference-settings.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const SAVE = "PUT /api/v1/settings/preferences";
const loaded = (overrides = {}) =>
  jsonResponse({
    preferences: preferences({ timezone: "Europe/Belgrade", ...overrides }),
    status: "ready",
    supportedCurrencyCodes: ["EUR", "RSD", "USD"],
  });

function shell(): void {
  drawShell("<main><div data-settings-preferences></div></main>");
}

const mount = () => mountSettled(() => mountPreferenceSettings());
const form = () => element<HTMLFormElement>("#preferences-form");
const status = () => element("#settings-status");
const field = (label: string) => screen.getByLabelText<HTMLInputElement>(label);

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    fireEvent.input(input, { target: { value } });
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

afterEach(() => sessionStorage.clear());

describe("AUTH-004 personal preferences", () => {
  it("does nothing when the form is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(PREFERENCE_SETTINGS_ISLAND).toBe("settings-preferences");
  });

  it("round-trips every preference and tells the shell the saved layout", async () => {
    shell();
    const api = stubApi({
      [PREFERENCES]: loaded({ currencyCode: "EUR" }),
      [SAVE]: jsonResponse({
        preferences: preferences({ fluidLayout: true }),
        status: "ready",
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    expect(field("Locale").value).toBe("en");
    expect(field("Time zone").value).toBe("Europe/Belgrade");
    expect(field("Currency").value).toBe("EUR");
    expect(field("Use fluid layout").checked).toBe(false);
    await expectNoAxeViolations(document.body);
    const saved: unknown[] = [];
    document.addEventListener(
      MEMBER_LAYOUT_SAVED_EVENT,
      (event) => saved.push((event as CustomEvent).detail),
    );
    type(field("Locale"), "sr-Latn");
    type(field("Time zone"), "");
    type(field("Currency"), "RSD");
    act(() => {
      fireEvent.click(field("Use fluid layout"));
      fireEvent.change(field("Temperature"), {
        target: { value: "fahrenheit" },
      });
      fireEvent.change(field("Measurements"), {
        target: { value: "imperial" },
      });
      fireEvent.change(field("Contact sorting"), {
        target: { value: "family_name_asc" },
      });
      fireEvent.change(field("Name display"), {
        target: { value: "family_given_nickname" },
      });
    });
    expect(element("#settings-dirty").textContent).toBe("Unsaved changes.");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Preferences saved.")
    );
    expect(api.bodies()).toEqual([{
      contactNameOrder: "family_given_nickname",
      contactSortOrder: "family_name_asc",
      currencyCode: "RSD",
      digestTime: null,
      fluidLayout: true,
      locale: "sr-Latn",
      measurementSystem: "imperial",
      reminderDelivery: "in_app",
      temperatureScale: "fahrenheit",
    }]);
    expect(saved).toEqual([{ fluidLayout: true, workspaceId: ids.workspace }]);
    expect(element("#settings-dirty").textContent).toBe("All changes saved.");
  });

  it("focuses field-adjacent errors for an invalid IANA time zone", async () => {
    shell();
    stubApi({
      [PREFERENCES]: loaded(),
      [SAVE]: problemResponse(400, {
        code: "validation_failed",
        detail: "Review the preference values.",
        errors: {
          ignored: "Not a field.",
          timezone: "Enter a valid IANA time zone.",
        },
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const timezone = field("Time zone");
    type(timezone, "Not/AZone");
    submit();
    await waitFor(() =>
      expect(timezone.getAttribute("aria-invalid")).toBe("true")
    );
    expect(element("#timezone-error").textContent).toBe(
      "Enter a valid IANA time zone.",
    );
    expect(timezone.validationMessage).toBe("Enter a valid IANA time zone.");
    expect(element("#settings-errors").textContent).toMatch(/review/i);
    expect(status().textContent).toBe("Review the preference values.");
    expect(document.activeElement).toBe(timezone);
    type(timezone, "Europe/Belgrade");
    expect(timezone.hasAttribute("aria-invalid")).toBe(false);
    expect(element("#timezone-error").textContent).toBe("");
    expect(timezone.validationMessage).toBe("");
  });

  it("focuses the currency field when the catalog rejects it", async () => {
    shell();
    stubApi({
      [PREFERENCES]: loaded(),
      [SAVE]: problemResponse(400, {
        detail: "Review the preference values.",
        errors: { currencyCode: "Choose a supported currency." },
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const currency = field("Currency");
    type(currency, "USD");
    submit();
    await waitFor(() =>
      expect(currency.getAttribute("aria-invalid")).toBe("true")
    );
    expect(element("#currency-error").textContent).toBe(
      "Choose a supported currency.",
    );
    expect(document.activeElement).toBe(currency);
  });

  it("[GIFTS-001] chooses a supported currency or the workspace default", async () => {
    shell();
    const api = stubApi({
      [PREFERENCES]: loaded({ currencyCode: "EUR" }),
      [SAVE]: jsonResponse({ preferences: preferences(), status: "ready" }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const currency = screen.getByLabelText<HTMLSelectElement>("Currency");
    expect([...currency.options].map((option) => option.textContent))
      .toEqual(["Workspace default", "EUR", "RSD", "USD"]);
    type(field("Currency"), "");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Preferences saved.")
    );
    expect(api.bodies()[0]).not.toHaveProperty("currencyCode");
  });

  it("keeps ready saves retryable after server and transport failures", async () => {
    shell();
    stubApi({
      [PREFERENCES]: loaded(),
      [SAVE]: [
        problemResponse(503, {
          detail: "Settings are temporarily unavailable.",
        }),
        problemResponse(400, { detail: "Refused without fields." }),
        unreachable,
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const save = screen.getByRole<HTMLButtonElement>("button", {
      name: "Save changes",
    });
    for (
      const expected of [
        "Settings are temporarily unavailable.",
        "Refused without fields.",
        "Preferences could not be saved.",
      ]
    ) {
      submit();
      await waitFor(() => expect(status().textContent).toBe(expected));
      expect(save.disabled).toBe(false);
    }
    expect(element("#settings-errors").hidden).toBe(true);
  });

  it("keeps the form unavailable when its session or values cannot be loaded", async () => {
    for (
      const [routes, message] of [
        [{ [SESSION]: unreachable }, "Your session could not be confirmed."],
        [{
          [PREFERENCES]: unreachable,
          [SESSION]: jsonResponse(workspaceSession()),
        }, "Your preferences could not be loaded."],
        [{
          [PREFERENCES]: problemResponse(403),
          [SESSION]: jsonResponse(workspaceSession()),
        }, "Your preferences could not be loaded."],
      ] as const
    ) {
      shell();
      stubApi(routes);
      const unmount = await mount();
      expect(status().textContent).toBe(message);
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save changes" })
          .disabled,
      ).toBe(true);
      unmount();
    }
  });

  it("tells the shell only a saved layout, on #protected-shell", async () => {
    drawShell(
      '<div id="protected-shell"><main><div data-settings-preferences></div></main></div>',
    );
    stubApi({
      [PREFERENCES]: loaded(),
      [SAVE]: [
        problemResponse(503, { detail: "Down." }),
        problemResponse(400, {
          detail: "Review the preference values.",
          errors: { timezone: "Enter a valid IANA time zone." },
        }),
        jsonResponse({
          preferences: preferences({ fluidLayout: true }),
          status: "ready",
        }),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const saved: unknown[] = [];
    element("#protected-shell").addEventListener(
      "kinship:member-layout-saved",
      (event) => saved.push((event as CustomEvent).detail),
    );
    act(() => {
      fireEvent.click(field("Use fluid layout"));
    });
    submit();
    await waitFor(() => expect(status().textContent).toBe("Down."));
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Review the preference values.")
    );
    expect(saved).toEqual([]);
    type(element<HTMLInputElement>("[name=timezone]"), "Europe/Belgrade");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Preferences saved.")
    );
    expect(saved).toEqual([{ fluidLayout: true, workspaceId: ids.workspace }]);
  });

  it("[PLANNING-003] saves reminder delivery and a digest time for reminders scheduled from now on", async () => {
    shell();
    const api = stubApi({
      [PREFERENCES]: loaded({ digestTime: "08:15", reminderDelivery: "both" }),
      [SAVE]: [
        jsonResponse({
          preferences: preferences({ reminderDelivery: "email" }),
          status: "ready",
        }),
        jsonResponse({
          preferences: preferences({
            digestTime: "07:30",
            reminderDelivery: "email",
          }),
          status: "ready",
        }),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const delivery = screen.getByLabelText<HTMLSelectElement>(
      "Reminder delivery",
    );
    const digest = field("Daily email digest");
    expect(delivery.value).toBe("both");
    expect(digest.value).toBe("08:15");
    const hint = element("#reminder-delivery-hint").textContent ?? "";
    expect(hint).toMatch(/verified email address/);
    expect(hint).toMatch(/stay in the app/);
    expect(hint).toMatch(/scheduled from now on/);
    expect(hint).toMatch(
      /digest time applies to every email reminder still waiting/,
    );
    expect(delivery.getAttribute("aria-describedby")).toContain(
      "reminder-delivery-hint",
    );
    await expectNoAxeViolations(document.body);
    act(() => {
      fireEvent.change(delivery, { target: { value: "email" } });
    });
    type(digest, "");
    submit();
    await waitFor(() =>
      expect(status().textContent).toBe("Preferences saved.")
    );
    type(digest, "07:30");
    submit();
    await waitFor(() => expect(api.bodies()).toHaveLength(2));
    expect(
      api.bodies().map((body) => {
        const { digestTime, reminderDelivery } = body as Record<
          string,
          unknown
        >;
        return [reminderDelivery, digestTime];
      }),
    ).toEqual([["email", null], ["email", "07:30"]]);
  });

  it("[PLANNING-003] focuses the digest time when the server refuses it", async () => {
    shell();
    stubApi({
      [PREFERENCES]: loaded(),
      [SAVE]: problemResponse(400, {
        detail: "Review the preference values.",
        errors: { digestTime: "Enter a time as HH:MM." },
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const digest = field("Daily email digest");
    type(digest, "07:30");
    submit();
    await waitFor(() =>
      expect(digest.getAttribute("aria-invalid")).toBe("true")
    );
    expect(element("#digest-time-error").textContent).toBe(
      "Enter a time as HH:MM.",
    );
    expect(document.activeElement).toBe(digest);
  });
});
