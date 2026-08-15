// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountPreferenceSettings,
  mountProfileSettings,
  mountSecuritySettings,
  mountWorkspaceSettings,
} from "./settings.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const session = {
  status: "authenticated",
  principal: { userId: "user" },
  workspace: { id: "workspace", name: "Circle" },
  member: { id: "member", role: "owner" },
  workspaces: [{ id: "workspace", name: "Circle" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("AUTH-004 personal settings", () => {
  it("recovers a stale saved workspace through one valid default session", async () => {
    document.body.innerHTML =
      `<form id="profile-form"><div id="settings-errors" hidden></div><input name="email"><input name="firstName"><input name="lastName"><button></button><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const staleWorkspace = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", staleWorkspace);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ code: "session_invalid", status: 401 }, 401),
      )
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Recovered",
          lastName: "Owner",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileSettings();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": staleWorkspace,
      "content-type": "application/json",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('[name="firstName"]')?.value,
    ).toBe("Recovered");
  });

  it("retains a saved workspace on transport, 503, and 403 session failures", async () => {
    const staleWorkspace = "00000000-0000-4000-8000-000000000099";
    for (
      const failure of [
        new Error("offline"),
        response({ code: "session_unavailable", status: 503 }, 503),
        response({ code: "session_forbidden", status: 403 }, 403),
      ]
    ) {
      document.body.innerHTML =
        `<form id="profile-form"></form><p id="settings-status"></p>`;
      sessionStorage.setItem("kinship.active-workspace", staleWorkspace);
      const fetchMock = vi.fn();
      if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure);
      else fetchMock.mockResolvedValueOnce(failure);
      vi.stubGlobal("fetch", fetchMock);

      await mountProfileSettings();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
        staleWorkspace,
      );
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /could not be confirmed/i,
      );
      sessionStorage.clear();
    }
  });

  it("loads and saves only the current profile", async () => {
    document.body.innerHTML =
      `<form id="profile-form"><div id="settings-errors" tabindex="-1" hidden></div><input name="email"><input name="firstName" required><input name="lastName"><button></button><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(
        response({
          status: "ready",
          profile: {
            email: "owner@example.test",
            firstName: "Old",
            lastName: "Name",
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          status: "ready",
          profile: {
            email: "owner@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("firstName") as HTMLInputElement).value = " Ada ";
    (form.elements.namedItem("lastName") as HTMLInputElement).value =
      " Lovelace ";
    form.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#settings-dirty")?.textContent).toMatch(
      /unsaved/i,
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /saved/i,
      )
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ firstName: "Ada", lastName: "Lovelace" }),
    );
    expect(document.querySelector("#settings-dirty")?.textContent).toMatch(
      /all changes saved/i,
    );
  });

  it("focuses native validation and protects unsaved profile navigation", async () => {
    document.body.innerHTML =
      `<form id="profile-form"><div id="settings-errors" role="alert" tabindex="-1" hidden></div><input name="email"><input name="firstName" required><input name="lastName"><button></button><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Owner",
          lastName: "Person",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileSettings();
    const firstName = document.querySelector<HTMLInputElement>(
      '[name="firstName"]',
    )!;
    firstName.value = "";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
    const unload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(firstName);
    expect(document.querySelector("#settings-errors")?.textContent).toMatch(
      /review/i,
    );
  });

  it("focuses field-adjacent errors for invalid IANA time zones", async () => {
    document.body.innerHTML =
      `<form id="preferences-form"><p id="settings-errors" role="alert" tabindex="-1" hidden></p><input name="locale"><label>Time zone<input name="timezone" aria-describedby="timezone-error"><small id="timezone-error" data-field-error="timezone"></small></label><input name="currencyCode"><input name="fluidLayout" type="checkbox"><select name="temperatureScale"><option value="celsius"></option></select><select name="measurementSystem"><option value="metric"></option></select><select name="contactSortOrder"><option value="given_name_asc"></option></select><select name="contactNameOrder"><option value="given_family_nickname"></option></select><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        status: "ready",
        preferences: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
          timezone: "Europe/Belgrade",
        },
      }))
      .mockResolvedValueOnce(response({
        code: "validation_failed",
        detail: "Review the preference values.",
        errors: { timezone: "Enter a valid IANA time zone." },
        status: 400,
        title: "Invalid preferences",
        type: "https://kinship.test/problems/validation_failed",
      }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await mountPreferenceSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    const timezone = form.elements.namedItem("timezone") as HTMLInputElement;
    timezone.value = "Not/AZone";
    timezone.dispatchEvent(new Event("input", { bubbles: true }));

    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(timezone.getAttribute("aria-invalid")).toBe("true")
    );
    expect(document.querySelector("#timezone-error")?.textContent).toMatch(
      /valid IANA time zone/i,
    );
    expect(document.querySelector("#settings-errors")?.textContent).toMatch(
      /review/i,
    );
    expect(document.activeElement).toBe(timezone);
  });

  it("focuses the personal currency field when the catalog rejects it", async () => {
    document.body.innerHTML =
      `<form id="preferences-form"><p id="settings-errors" role="alert" tabindex="-1" hidden></p><input name="locale"><input name="timezone"><label>Currency<input name="currencyCode" aria-describedby="currency-error"><small id="currency-error" data-field-error="currencyCode"></small></label><input name="fluidLayout" type="checkbox"><select name="temperatureScale"><option value="celsius"></option></select><select name="measurementSystem"><option value="metric"></option></select><select name="contactSortOrder"><option value="given_name_asc"></option></select><select name="contactNameOrder"><option value="given_family_nickname"></option></select><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        status: "ready",
        preferences: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
        },
      }))
      .mockResolvedValueOnce(response({
        code: "validation_failed",
        detail: "Review the preference values.",
        errors: { currencyCode: "Choose a supported currency." },
        status: 400,
        title: "Invalid preferences",
        type: "https://kinship.test/problems/validation_failed",
      }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await mountPreferenceSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    const currency = form.elements.namedItem(
      "currencyCode",
    ) as HTMLInputElement;
    currency.value = "ZZZ";
    form.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(currency.getAttribute("aria-invalid")).toBe("true")
    );
    expect(document.querySelector("#currency-error")?.textContent).toMatch(
      /supported currency/i,
    );
    expect(document.activeElement).toBe(currency);
  });

  it("round-trips personal preferences and revokes a selected session", async () => {
    document.body.innerHTML =
      `<form id="preferences-form"><input name="locale"><input name="timezone"><input name="currencyCode"><input name="fluidLayout" type="checkbox"><select name="temperatureScale"><option value="celsius"></option><option value="fahrenheit"></option></select><select name="measurementSystem"><option value="metric"></option><option value="imperial"></option></select><select name="contactSortOrder"><option value="given_name_asc"></option><option value="family_name_asc"></option></select><select name="contactNameOrder"><option value="given_family_nickname"></option><option value="family_given_nickname"></option></select></form><p id="settings-status"></p>`;
    const preferenceFetch = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        status: "ready",
        preferences: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
        },
      }))
      .mockResolvedValueOnce(response({ status: "ready" }));
    vi.stubGlobal("fetch", preferenceFetch);
    await mountPreferenceSettings();
    expect(
      (document.querySelector('[name="locale"]') as HTMLInputElement).value,
    ).toBe("en");
    const preferenceForm = document.querySelector<HTMLFormElement>("form")!;
    (preferenceForm.elements.namedItem("locale") as HTMLInputElement).value =
      "sr-Latn";
    preferenceForm.dispatchEvent(new Event("input", { bubbles: true }));
    preferenceForm.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /saved/i,
      )
    );

    document.body.innerHTML =
      `<p id="settings-status"></p><span id="session-count"></span><ul id="session-list"></ul>`;
    const sessions = {
      status: "ready",
      sessions: [{
        id: "00000000-0000-4000-8000-000000000010",
        current: false,
        createdAt: "2026-08-15T09:00:00Z",
        lastSeenAt: "2026-08-15T10:00:00Z",
        expiresAt: "2026-08-15T20:00:00Z",
        ipAddress: "192.0.2.10",
        userAgent: "Firefox",
      }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(sessions))
      .mockResolvedValueOnce(response({ status: "revoked", current: false }))
      .mockResolvedValueOnce(response({ status: "ready", sessions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mountSecuritySettings();
    expect(document.querySelector("#session-list")?.textContent).toContain(
      "Firefox",
    );
    (document.querySelector("#session-list button") as HTMLButtonElement)
      .click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(document.querySelector("#session-count")?.textContent).toBe(
      "0 active",
    );
  });
});

describe("WORKSPACE-001 workspace settings", () => {
  it("maps invalid default time zones beside the workspace field", async () => {
    document.body.innerHTML =
      `<form id="workspace-form"><p id="settings-errors" role="alert" tabindex="-1" hidden></p><input name="name"><input name="slug"><input name="defaultLocale"><label>Default time zone<input name="defaultTimezone"><small data-field-error="defaultTimezone"></small></label><input name="defaultCurrencyCode"><input name="defaultReminderTime"><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const workspace = {
      defaultLocale: "en",
      defaultReminderTime: "12:00",
      defaultTimezone: "Europe/Belgrade",
      name: "Circle",
      slug: "circle",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ status: "ready", workspace }))
      .mockResolvedValueOnce(response({
        code: "validation_failed",
        detail: "Review the workspace identity and default values.",
        errors: { defaultTimezone: "Enter a valid IANA time zone." },
        status: 400,
        title: "Invalid workspace settings",
        type: "https://kinship.test/problems/validation_failed",
      }, 400));
    vi.stubGlobal("fetch", fetchMock);
    await mountWorkspaceSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    const timezone = form.elements.namedItem(
      "defaultTimezone",
    ) as HTMLInputElement;
    timezone.value = "Not/AZone";
    form.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(timezone.getAttribute("aria-invalid")).toBe("true")
    );
    expect(
      document.querySelector('[data-field-error="defaultTimezone"]')
        ?.textContent,
    ).toMatch(/valid IANA time zone/i);
    expect(document.activeElement).toBe(timezone);
  });

  it("focuses an unsupported default currency beside its field", async () => {
    document.body.innerHTML =
      `<form id="workspace-form"><p id="settings-errors" role="alert" tabindex="-1" hidden></p><input name="name"><input name="slug"><input name="defaultLocale"><input name="defaultTimezone"><label>Default currency<input name="defaultCurrencyCode" aria-describedby="default-currency-error"><small id="default-currency-error" data-field-error="defaultCurrencyCode"></small></label><input name="defaultReminderTime"><p id="settings-dirty"></p></form><p id="settings-status"></p>`;
    const workspace = {
      defaultLocale: "en",
      defaultReminderTime: "12:00",
      name: "Circle",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({ status: "ready", workspace }))
        .mockResolvedValueOnce(response({
          code: "validation_failed",
          detail: "Review the workspace identity and default values.",
          errors: {
            defaultCurrencyCode: "Choose a supported currency.",
          },
          status: 400,
          title: "Invalid workspace settings",
          type: "https://kinship.test/problems/validation_failed",
        }, 400)),
    );
    await mountWorkspaceSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    const currency = form.elements.namedItem(
      "defaultCurrencyCode",
    ) as HTMLInputElement;
    currency.value = "ZZZ";
    form.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(currency.getAttribute("aria-invalid")).toBe("true")
    );
    expect(document.querySelector("#default-currency-error")?.textContent)
      .toMatch(/supported currency/i);
    expect(document.activeElement).toBe(currency);
  });

  it("loads and saves active-workspace identity and defaults", async () => {
    document.body.innerHTML =
      `<form id="workspace-form"><input name="name"><input name="slug"><input name="defaultLocale"><input name="defaultTimezone"><input name="defaultCurrencyCode"><input name="defaultReminderTime"><button></button></form><p id="settings-status"></p>`;
    const value = {
      name: "Circle",
      slug: "circle",
      defaultLocale: "en",
      defaultTimezone: "Europe/Belgrade",
      defaultCurrencyCode: "EUR",
      defaultReminderTime: "12:00",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ status: "ready", workspace: value }))
      .mockResolvedValueOnce(
        response({ status: "ready", workspace: { ...value, name: "Friends" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountWorkspaceSettings();
    const form = document.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("name") as HTMLInputElement).value = "Friends";
    (form.elements.namedItem("slug") as HTMLInputElement).value = "";
    (form.elements.namedItem("defaultTimezone") as HTMLInputElement).value = "";
    (form.elements.namedItem("defaultCurrencyCode") as HTMLInputElement).value =
      "";
    form.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /saved/i,
      )
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain('"name":"Friends"');
  });

  it("reports unavailable profile, preference, session, and workspace data", async () => {
    const cases: readonly [string, () => Promise<void>, string][] = [
      [
        '<form id="profile-form"></form><p id="settings-status"></p>',
        mountProfileSettings,
        "profile",
      ],
      [
        '<form id="preferences-form"></form><p id="settings-status"></p>',
        mountPreferenceSettings,
        "preferences",
      ],
      [
        '<span id="session-count"></span><ul id="session-list"></ul><p id="settings-status"></p>',
        mountSecuritySettings,
        "sessions",
      ],
      [
        '<form id="workspace-form"></form><p id="settings-status"></p>',
        mountWorkspaceSettings,
        "workspace",
      ],
    ];
    for (const [markup, mount, expected] of cases) {
      document.body.innerHTML = markup;
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(response(session))
          .mockRejectedValueOnce(new Error("offline")),
      );
      await mount();
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        new RegExp(expected, "i"),
      );
    }
  });

  it("keeps rejected mutations visible and retryable", async () => {
    document.body.innerHTML =
      `<form id="profile-form"><input name="email"><input name="firstName"><input name="lastName"></form><p id="settings-status"></p>`;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          status: "ready",
          profile: {
            email: "owner@example.test",
            firstName: "Owner",
            lastName: "Person",
          },
        }))
        .mockRejectedValueOnce(new Error("offline")),
    );
    await mountProfileSettings();
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /could not be saved/i,
      )
    );

    document.body.innerHTML =
      `<span id="session-count"></span><ul id="session-list"></ul><p id="settings-status"></p>`;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          status: "ready",
          sessions: [{
            id: "00000000-0000-4000-8000-000000000020",
            current: false,
            createdAt: "2026-08-15T09:00:00Z",
            lastSeenAt: "2026-08-15T10:00:00Z",
            expiresAt: "2026-08-15T20:00:00Z",
          }],
        }))
        .mockRejectedValueOnce(new Error("offline")),
    );
    await mountSecuritySettings();
    const revoke = document.querySelector<HTMLButtonElement>(
      "#session-list button",
    )!;
    revoke.click();
    await vi.waitFor(() => expect(revoke.disabled).toBe(false));
    expect(document.querySelector("#settings-status")?.textContent).toMatch(
      /could not be revoked/i,
    );
  });
});
