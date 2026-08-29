// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  mountPersonalLifecycle,
  mountPreferenceSettings,
  mountProfileSettings,
  mountSecuritySettings,
  mountWorkspaceSettings,
} from "./settings.ts";

const profilePage = readFileSync(
  "apps/web/src/pages/app/settings/profile.astro",
  "utf8",
);
const preferencePage = readFileSync(
  "apps/web/src/pages/app/settings/preferences.astro",
  "utf8",
);
const workspacePage = readFileSync(
  "apps/web/src/pages/app/settings/workspace.astro",
  "utf8",
);

function formMarkup(page: string, id: string): string {
  const markup = page.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))
    ?.[0];
  if (!markup) throw new Error(`Missing ${id} fixture markup.`);
  return markup;
}

function deferredResponse(): {
  promise: Promise<Response>;
  resolve(value: Response): void;
} {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => resolve = done);
  return { promise, resolve };
}

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

const lifecycleMarkup = `
  <section id="account-lifecycle">
    <p id="lifecycle-loading"></p>
    <dl id="lifecycle-counts" hidden></dl>
    <span id="lifecycle-membership-count"></span>
    <span id="lifecycle-session-count"></span>
    <code id="leave-confirmation-value"></code>
    <code id="delete-confirmation-value"></code>
    <ul id="lifecycle-memberships"></ul>
    <p id="lifecycle-blockers" hidden></p>
    <form id="leave-workspace-form">
      <input name="confirmation"><input name="password" type="password"><button></button>
    </form>
    <form id="delete-identity-form">
      <input name="confirmation"><input name="password" type="password"><button></button>
    </form>
    <p id="lifecycle-status"></p>
  </section>`;

const lifecyclePreview = {
  activeSessionCount: 2,
  blockingWorkspaces: [],
  confirmations: {
    deleteIdentity: "DELETE owner@example.test",
    leaveWorkspace: "LEAVE Circle",
  },
  memberships: [{
    finalOwner: false,
    id: "member",
    role: "owner",
    status: "active",
    workspace: { id: "workspace", name: "Circle" },
  }, {
    finalOwner: false,
    id: "member-next",
    role: "member",
    status: "active",
    workspace: { id: "workspace-next", name: "Friends" },
  }],
  retainedLegalRecords: true,
  status: "ready",
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("AUTH-004 personal settings", () => {
  it.each([
    {
      changedValue: "Changed",
      field: "firstName",
      formId: "profile-form",
      loaded: {
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Loaded",
          lastName: "Profile",
        },
      },
      loadedValue: "Loaded",
      mount: mountProfileSettings,
      name: "profile",
      page: profilePage,
      saved: {
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Changed",
          lastName: "Profile",
        },
      },
      savedStatus: /profile saved/i,
    },
    {
      changedValue: "sr-Latn",
      field: "locale",
      formId: "preferences-form",
      loaded: {
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
      },
      loadedValue: "en",
      mount: mountPreferenceSettings,
      name: "preferences",
      page: preferencePage,
      saved: { status: "ready" },
      savedStatus: /preferences saved/i,
    },
    {
      changedValue: "Changed",
      field: "name",
      formId: "workspace-form",
      loaded: {
        status: "ready",
        workspace: {
          defaultCurrencyCode: "EUR",
          defaultLocale: "en",
          defaultReminderTime: "12:00",
          defaultTimezone: "Europe/Belgrade",
          name: "Loaded",
          slug: "circle",
        },
      },
      loadedValue: "Loaded",
      mount: mountWorkspaceSettings,
      name: "workspace",
      page: workspacePage,
      saved: {
        status: "ready",
        workspace: {
          defaultCurrencyCode: "EUR",
          defaultLocale: "en",
          defaultReminderTime: "12:00",
          defaultTimezone: "Europe/Belgrade",
          name: "Changed",
          slug: "circle",
        },
      },
      savedStatus: /workspace settings saved/i,
    },
  ])(
    "keeps the $name form explained and inoperable until it is ready",
    async ({
      changedValue,
      field,
      formId,
      loaded,
      loadedValue,
      mount,
      page,
      saved,
      savedStatus,
    }) => {
      document.body.innerHTML = formMarkup(page, formId);
      const form = document.querySelector<HTMLFormElement>("form")!;
      const submit = form.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      const changed = form.elements.namedItem(field) as HTMLInputElement;
      const initiallyDisabled = submit.disabled;
      const fieldInitiallyDisabled = changed.disabled;
      const initialStatus = document.querySelector("#settings-status")
        ?.textContent;
      const pending = deferredResponse();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(response(saved));
      vi.stubGlobal("fetch", fetchMock);

      const mounting = mount();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect({
        initialStatus,
        initiallyDisabled,
        fieldInitiallyDisabled,
        fieldPendingDisabled: changed.disabled,
        pendingDisabled: submit.disabled,
        pendingStatus: document.querySelector("#settings-status")?.textContent,
      }).toEqual({
        initialStatus: expect.stringMatching(/loading/i),
        initiallyDisabled: true,
        fieldInitiallyDisabled: true,
        fieldPendingDisabled: true,
        pendingDisabled: true,
        pendingStatus: expect.stringMatching(/loading/i),
      });
      submit.click();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      pending.resolve(response(loaded));
      await mounting;

      expect(changed.value).toBe(loadedValue);
      expect(changed.disabled).toBe(false);
      expect(submit.disabled).toBe(false);
      changed.value = changedValue;
      changed.dispatchEvent(new Event("input", { bubbles: true }));
      submit.click();
      await vi.waitFor(() =>
        expect(document.querySelector("#settings-status")?.textContent).toMatch(
          savedStatus,
        )
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it("does not initialize settings when their forms are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([
      mountProfileSettings(),
      mountPreferenceSettings(),
      mountWorkspaceSettings(),
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      formId: "preferences-form",
      mount: mountPreferenceSettings,
      name: "preferences",
      page: preferencePage,
    },
    {
      formId: "workspace-form",
      mount: mountWorkspaceSettings,
      name: "workspace",
      page: workspacePage,
    },
  ])(
    "keeps the $name form unavailable when its session cannot be confirmed",
    async ({ formId, mount, page }) => {
      document.body.innerHTML = formMarkup(page, formId);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        ),
      );

      await mount();

      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(true);
      expect(document.querySelector("#settings-status")?.textContent).toMatch(
        /could not be confirmed/i,
      );
    },
  );

  it.each([
    {
      formId: "preferences-form",
      loaded: {
        status: "ready",
        preferences: {
          contactNameOrder: "given_family_nickname",
          contactSortOrder: "given_name_asc",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
        },
      },
      mount: mountPreferenceSettings,
      name: "preferences",
      page: preferencePage,
      unavailable: "Preferences could not be saved.",
    },
    {
      formId: "workspace-form",
      loaded: {
        status: "ready",
        workspace: {
          defaultLocale: "en",
          defaultReminderTime: "12:00",
          name: "Circle",
        },
      },
      mount: mountWorkspaceSettings,
      name: "workspace",
      page: workspacePage,
      unavailable: "Workspace settings could not be saved.",
    },
  ])(
    "keeps ready $name saves retryable after server and transport failures",
    async ({ formId, loaded, mount, page, unavailable }) => {
      for (
        const [failure, expected] of [
          [
            response({
              code: "settings_unavailable",
              detail: "Settings are temporarily unavailable.",
              status: 503,
            }, 503),
            "Settings are temporarily unavailable.",
          ],
          [new Error("offline"), unavailable],
        ] as const
      ) {
        document.body.innerHTML = formMarkup(page, formId);
        const fetchMock = vi.fn()
          .mockResolvedValueOnce(response(session))
          .mockResolvedValueOnce(response(loaded));
        if (failure instanceof Error) {
          fetchMock.mockRejectedValueOnce(failure);
        } else {
          fetchMock.mockResolvedValueOnce(failure);
        }
        vi.stubGlobal("fetch", fetchMock);

        await mount();
        const submit = document.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        )!;
        submit.click();

        await vi.waitFor(() =>
          expect(document.querySelector("#settings-status")?.textContent).toBe(
            expected,
          )
        );
        expect(submit.disabled).toBe(false);
      }
    },
  );

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

describe("AUTH-005 personal lifecycle", () => {
  it("labels mixed active and suspended membership impact truthfully", async () => {
    document.body.innerHTML = lifecycleMarkup;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        ...lifecyclePreview,
        memberships: [lifecyclePreview.memberships[0], {
          ...lifecyclePreview.memberships[1],
          status: "suspended",
        }],
      })),
    );

    await mountPersonalLifecycle("workspace");

    expect(document.querySelector("#lifecycle-membership-count")?.textContent)
      .toBe("2");
    expect(document.querySelector("#lifecycle-memberships")?.textContent)
      .toMatch(/suspended/i);
    expect(profilePage).toContain("<dt>Affected memberships</dt>");
  });

  it("shows current impact and disables actions that would orphan a workspace", async () => {
    document.body.innerHTML = lifecycleMarkup;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        ...lifecyclePreview,
        blockingWorkspaces: [{ id: "workspace", name: "Circle" }],
        memberships: [{
          ...lifecyclePreview.memberships[0],
          finalOwner: true,
        }],
      })),
    );

    await mountPersonalLifecycle("workspace");

    expect(document.querySelector("#lifecycle-membership-count")?.textContent)
      .toBe("1");
    expect(document.querySelector("#lifecycle-session-count")?.textContent)
      .toBe("2");
    expect(document.querySelector("#lifecycle-memberships")?.textContent)
      .toMatch(/final active owner/i);
    expect(document.querySelector("#lifecycle-blockers")?.textContent)
      .toMatch(/transfer ownership/i);
    expect(
      document.querySelector<HTMLButtonElement>("#leave-workspace-form button")
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("#delete-identity-form button")
        ?.disabled,
    ).toBe(true);
  });

  it("reauthenticates, leaves, and selects the next valid workspace", async () => {
    document.body.innerHTML = lifecycleMarkup;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(lifecyclePreview))
      .mockResolvedValueOnce(response({
        next: "/app",
        nextWorkspaceId: "workspace-next",
        status: "left",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    await mountPersonalLifecycle("workspace", navigate);
    const form = document.querySelector<HTMLFormElement>(
      "#leave-workspace-form",
    )!;
    (form.elements.namedItem("confirmation") as HTMLInputElement).value =
      "LEAVE Circle";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "current password";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/app"));
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      confirmation: "LEAVE Circle",
      password: "current password",
    }));
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      "workspace-next",
    );
  });

  it("keeps a failed reauthentication retryable without changing navigation", async () => {
    document.body.innerHTML = lifecycleMarkup;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(lifecyclePreview))
        .mockResolvedValueOnce(response({
          code: "reauthentication_required",
          detail: "Enter your current password.",
          status: 403,
        }, 403)),
    );
    const navigate = vi.fn();
    await mountPersonalLifecycle("workspace", navigate);
    const form = document.querySelector<HTMLFormElement>(
      "#delete-identity-form",
    )!;
    (form.elements.namedItem("confirmation") as HTMLInputElement).value =
      "DELETE owner@example.test";
    (form.elements.namedItem("password") as HTMLInputElement).value = "wrong";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(document.querySelector("#lifecycle-status")?.textContent).toMatch(
        /current password/i,
      )
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLButtonElement>("#delete-identity-form button")
        ?.disabled,
    ).toBe(false);
  });

  it("clears workspace state after confirmed personal identity deletion", async () => {
    document.body.innerHTML = lifecycleMarkup;
    sessionStorage.setItem("kinship.active-workspace", "workspace");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(lifecyclePreview))
        .mockResolvedValueOnce(response({
          next: "/auth/sign-in",
          status: "deleted",
        })),
    );
    const navigate = vi.fn();
    await mountPersonalLifecycle("workspace", navigate);
    const form = document.querySelector<HTMLFormElement>(
      "#delete-identity-form",
    )!;
    (form.elements.namedItem("confirmation") as HTMLInputElement).value =
      "DELETE owner@example.test";
    (form.elements.namedItem("password") as HTMLInputElement).value =
      "current password";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/auth/sign-in")
    );
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
  });
});
