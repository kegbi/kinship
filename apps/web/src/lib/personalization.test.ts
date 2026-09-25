// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  mountPersonalization,
  PERSONALIZATION_SECTIONS,
  resolvePersonalizationSection,
} from "./personalization.ts";
import { requestWorkspaceChange } from "./workspace-context.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => resolve = settle);
  return { promise, resolve };
}

const session = {
  status: "authenticated",
  principal: { userId: "user" },
  workspace: { id: "workspace", name: "Circle" },
  member: { id: "member", role: "owner" },
  workspaces: [{ id: "workspace", name: "Circle" }],
};

function markup(): void {
  document.body.innerHTML = `
    <nav>${
    PERSONALIZATION_SECTIONS.map(({ id, label }) =>
      `<a data-personalization-section="${id}" href="?section=${id}">${label}</a>`
    ).join("")
  }</nav>
    <h2 id="personalization-heading" tabindex="-1"></h2>
    <form id="personalization-create"><input name="name"><button type="submit">Create option</button></form>
    <p id="personalization-dirty" role="status"></p>
    <p id="personalization-status" tabindex="-1"></p>
    <ul id="personalization-list"></ul>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("WORKSPACE-003 personalization deep links", () => {
  it("accepts exactly the cataloged section ids", () => {
    expect(PERSONALIZATION_SECTIONS).toHaveLength(11);
    for (const { id } of PERSONALIZATION_SECTIONS) {
      expect(resolvePersonalizationSection(`?section=${id}`)).toBe(id);
    }
    expect(resolvePersonalizationSection("?section=uncataloged-route")).toBe(
      "profile-modules",
    );
  });

  it("prevents implicit row actions from discarding a dirty draft", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const tag = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000001",
      isActive: true,
      isDefault: false,
      name: "Close friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") return response(session);
        if (init?.method === "PATCH") {
          return response({
            entry: { ...tag, isActive: false },
            status: "saved",
          });
        }
        return response({ entries: [tag], section: "tags", status: "ready" });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Close friends"]',
    )!;
    name.value = "Inner circle";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    const disable = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".personalization-actions button",
    )).find((button) => button.textContent === "Disable")!;
    const remove = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".personalization-actions button",
    )).find((button) => button.textContent === "Delete")!;
    expect(disable.disabled).toBe(true);
    expect(remove.disabled).toBe(true);
    expect(disable.getAttribute("aria-describedby")).toBe(
      "personalization-dirty",
    );
    disable.click();
    expect(
      fetchMock.mock.calls.some((call) =>
        (call[1] as RequestInit | undefined)?.method === "PATCH"
      ),
    ).toBe(false);
    expect(name.value).toBe("Inner circle");

    name.value = "Close friends";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(disable.disabled).toBe(false);
    expect(remove.disabled).toBe(false);
    disable.click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) =>
          (call[1] as RequestInit | undefined)?.method === "PATCH"
        ),
      ).toBe(true)
    );
  });

  it("allows only the active dirty form to mutate and provides keyboard Revert", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const entries = [
      {
        canDelete: true,
        id: "00000000-0000-4000-8000-000000000001",
        isActive: true,
        isDefault: false,
        name: "Close friends",
        referenceCount: 0,
        sortOrder: 0,
        updatedAt: "2026-08-17T10:00:00.000Z",
      },
      {
        canDelete: true,
        id: "00000000-0000-4000-8000-000000000002",
        isActive: true,
        isDefault: false,
        name: "Trusted people",
        referenceCount: 0,
        sortOrder: 1,
        updatedAt: "2026-08-17T10:00:00.000Z",
      },
    ];
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input) === "/api/v1/session"
        ? Promise.resolve(response(session))
        : Promise.resolve(
          response({ entries, section: "tags", status: "ready" }),
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const close = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Close friends"]',
    )!;
    const closeForm = close.form!;
    const trusted = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Trusted people"]',
    )!;
    const trustedSave = trusted.form!.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    const createSubmit = create.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    close.value = "Inner circle";
    close.dispatchEvent(new Event("input", { bubbles: true }));

    expect(
      closeForm.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(false);
    expect(createSubmit.disabled).toBe(true);
    expect(trustedSave.disabled).toBe(true);
    create.requestSubmit();
    trusted.form!.requestSubmit();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(close.value).toBe("Inner circle");

    const revert = Array.from(closeForm.querySelectorAll<HTMLButtonElement>(
      "button",
    )).find((button) => button.textContent === "Revert")!;
    expect(revert.hidden).toBe(false);
    expect(revert.tabIndex).toBeGreaterThanOrEqual(0);
    revert.focus();
    revert.click();
    expect(close.value).toBe("Close friends");
    expect(document.activeElement).toBe(close);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes reverted.");
    expect(createSubmit.disabled).toBe(false);
    expect(trustedSave.disabled).toBe(false);

    const createName = create.elements.namedItem("name") as HTMLInputElement;
    createName.value = "Draft tag";
    createName.dispatchEvent(new Event("input", { bubbles: true }));
    expect(createSubmit.disabled).toBe(false);
    expect(trustedSave.disabled).toBe(true);
    const createRevert = Array.from(create.querySelectorAll<HTMLButtonElement>(
      "button",
    )).find((button) => button.textContent === "Revert")!;
    expect(createRevert.hidden).toBe(false);
    createRevert.click();
    expect(createName.value).toBe("");
  });

  it("reports a committed Save refresh failure and retries authoritatively", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const original = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000001",
      isActive: true,
      isDefault: false,
      name: "Close friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    const saved = {
      ...original,
      name: "Inner circle",
      updatedAt: "2026-08-17T10:01:00.000Z",
    };
    let listCount = 0;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") return response(session);
        if (init?.method === "PATCH") {
          return response({ entry: saved, status: "saved" });
        }
        listCount += 1;
        if (listCount === 2) {
          return response({
            code: "personalization_unavailable",
            detail: "Refresh unavailable.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503);
        }
        return response({
          entries: [listCount > 2 ? saved : original],
          section: "tags",
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Close friends"]',
    )!;
    name.value = "Inner circle";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.form!.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("Change saved, but this section could not be refreshed.")
    );
    expect(name.value).toBe("Inner circle");
    expect(name.disabled).toBe(false);
    expect(document.querySelector("#personalization-status")?.textContent)
      .not.toContain("Option saved.");
    const retry = Array.from(document.querySelectorAll<HTMLButtonElement>(
      "#personalization-status button",
    )).find((button) => button.textContent === "Retry")!;
    expect(retry).toBeDefined();
    retry.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Name for Inner circle"]',
        )?.value,
      ).toBe("Inner circle")
    );
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("All changes saved.");
  });

  it("restores implicit controls after a committed refresh failure and Retry", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=profile-modules",
    );
    const original = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000001",
      isActive: true,
      isDefault: false,
      name: "Tags",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    const saved = {
      ...original,
      isActive: false,
      updatedAt: "2026-08-17T10:01:00.000Z",
    };
    let listCount = 0;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") return response(session);
        if (init?.method === "PATCH") {
          return response({ entry: saved, status: "saved" });
        }
        listCount += 1;
        if (listCount === 2) {
          return response({
            code: "personalization_unavailable",
            detail: "Refresh unavailable.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503);
        }
        return response({
          entries: [listCount > 2 ? saved : original],
          section: "profile-modules",
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const disable = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".personalization-actions button",
    )).find((button) => button.textContent === "Disable")!;
    disable.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("Change saved, but this section could not be refreshed.")
    );
    expect(disable.disabled).toBe(false);
    expect(document.querySelector("#personalization-status")?.textContent)
      .not.toContain("Option updated.");
    document.querySelector<HTMLButtonElement>(
      "#personalization-status button",
    )!.click();
    await vi.waitFor(() =>
      expect(
        Array.from(document.querySelectorAll<HTMLButtonElement>(
          ".personalization-actions button",
        )).some((button) => button.textContent === "Enable"),
      ).toBe(true)
    );
  });

  it("keeps workspace drafts until an accepted switch actually proceeds", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const tag = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000001",
      isActive: true,
      isDefault: false,
      name: "Close friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input) === "/api/v1/session"
          ? Promise.resolve(response(session))
          : Promise.resolve(response({
            entries: [tag],
            section: "tags",
            status: "ready",
          }))
      ),
    );
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    await mountPersonalization();
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Close friends"]',
    )!;
    name.value = "Workspace draft";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.focus();
    const canceled = requestWorkspaceChange("workspace", "other-workspace");
    expect(canceled.allowed).toBe(false);
    expect(name.value).toBe("Workspace draft");
    expect(document.activeElement).toBe(name);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toContain("Unsaved");

    confirm.mockReturnValue(true);
    const accepted = requestWorkspaceChange("workspace", "other-workspace");
    expect(accepted.allowed).toBe(true);
    expect(name.value).toBe("Workspace draft");
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toContain("Unsaved");
    const failedTargetUnload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(failedTargetUnload);
    expect(failedTargetUnload.defaultPrevented).toBe(true);

    accepted.proceed();
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes discarded for workspace switch.");
    const committedUnload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(committedUnload);
    expect(committedUnload.defaultPrevented).toBe(false);
  });

  it("renders, navigates, edits, replaces, and announces API outcomes", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    let entries = [
      {
        canDelete: true,
        id: first,
        isActive: true,
        isDefault: false,
        name: "Close friends",
        referenceCount: 1,
        sortOrder: 0,
        updatedAt: "2026-08-16T10:00:00.000Z",
      },
      {
        canDelete: true,
        id: second,
        isActive: true,
        isDefault: false,
        name: "Trusted people",
        referenceCount: 0,
        sortOrder: 1,
        updatedAt: "2026-08-16T10:00:00.000Z",
      },
      {
        canDelete: false,
        id: "tags-shared",
        isActive: true,
        isDefault: true,
        name: "Shared",
        referenceCount: 0,
        sortOrder: 2,
        updatedAt: "1970-01-01T00:00:00.000Z",
      },
    ];
    let duplicate = true;
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/session") return response(session);
        if (init?.method === "POST") {
          if (duplicate) {
            duplicate = false;
            return response({
              code: "personalization_duplicate",
              detail: "Choose a unique name in this workspace.",
              status: 409,
              title: "Name already used",
              type: "problem",
            }, 409);
          }
          return response({ entry: entries[1], status: "saved" });
        }
        if (init?.method === "PATCH") {
          return response({ entry: entries[0], status: "saved" });
        }
        if (init?.method === "DELETE") {
          entries = entries.filter((item) => item.id !== first);
          return response({ id: first, status: "deleted" });
        }
        return response({
          entries: path.includes("reminder-rules") ? [] : entries,
          section: path.includes("reminder-rules") ? "reminder-rules" : "tags",
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    expect(document.querySelectorAll(".personalization-row")).toHaveLength(3);
    expect(document.body.textContent).toContain("Shared required option");
    const row = (): HTMLElement =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".personalization-row"),
      )
        .find((candidate) =>
          candidate.querySelector<HTMLInputElement>('input[name="name"]')
            ?.value === "Close friends"
        )!;
    row().querySelector<HTMLButtonElement>("button[type=submit]")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    Array.from(row().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Disable",
    )!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    Array.from(row().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Replace and delete",
    )!.click();
    expect(document.querySelector("#personalization-status")?.textContent)
      .toContain("require a replacement");
    row().querySelector<HTMLSelectElement>("select")!.value = second;
    Array.from(row().querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Replace and delete",
    )!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    expect(document.body.textContent).not.toContain("Close friends");

    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    create.querySelector("input")!.value = "Trusted people";
    create.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("Choose a unique name")
    );
    create.requestSubmit();
    await vi.waitFor(() =>
      expect(create.querySelector("input")!.value).toBe("")
    );
    const createBodies = fetchMock.mock.calls.filter((call) =>
      (call[1] as RequestInit | undefined)?.method === "POST"
    ).map((call) =>
      JSON.parse(String((call[1] as RequestInit).body)) as unknown
    );
    expect(createBodies).toEqual([
      { name: "Trusted people" },
      { name: "Trusted people" },
    ]);

    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-heading")?.textContent)
        .toBe("Reminder rules")
    );
    expect(location.search).toBe("?section=reminder-rules");
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("No options yet")
    );
    const tagsHistory = {
      personalization: { index: 2, section: "tags" },
    };
    history.pushState(tagsHistory, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: tagsHistory }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-heading")?.textContent)
        .toBe("Tags")
    );
  });

  it("keeps the create form out of reach until its section has loaded", async () => {
    expect(
      readFileSync(
        "apps/web/src/pages/app/settings/personalization.astro",
        "utf8",
      ),
    ).toMatch(/<form method="post" id="personalization-create"[^>]*\shidden>/);
    markup();
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    create.hidden = true;
    let resolveSession!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => resolveSession = resolve),
        )
        .mockResolvedValueOnce(response({
          entries: [],
          section: "profile-modules",
          status: "ready",
        })),
    );
    const mounted = mountPersonalization();
    expect(create.hidden).toBe(true);
    resolveSession(response(session));
    await mounted;
    expect(create.hidden).toBe(false);
  });

  it("reports session and section loading failures without stale rows", async () => {
    markup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await mountPersonalization();
    expect(document.querySelector("#personalization-status")?.textContent)
      .toContain("session could not be confirmed");

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response({
            code: "personalization_unavailable",
            detail: "Section unavailable.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503),
        ),
    );
    await mountPersonalization();
    expect(document.querySelector("#personalization-status")?.textContent)
      .toContain("Section unavailable. Retry");
    expect(document.querySelector("#personalization-list")?.children)
      .toHaveLength(0);
  });

  it("keeps an initial failed section inert until Retry establishes a baseline", async () => {
    markup();
    const entry = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000001",
      isActive: true,
      isDefault: false,
      name: "Close friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-17T10:00:00.000Z",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        code: "personalization_unavailable",
        detail: "Section unavailable.",
        status: 503,
        title: "Unavailable",
        type: "problem",
      }, 503))
      .mockResolvedValueOnce(response({
        entries: [entry],
        section: "profile-modules",
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();

    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    const name = create.elements.namedItem("name") as HTMLInputElement;
    const submit = create.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    )!;
    const revert = Array.from(create.querySelectorAll("button")).find(
      (button) => button.textContent === "Revert",
    )!;
    expect(name.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(revert.hidden).toBe(true);
    name.value = "No baseline draft";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    submit.click();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("All changes saved.");
    expect(document.querySelector("#personalization-status")?.textContent)
      .toContain("Section unavailable. Retry");

    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    )!;
    retry.click();
    await vi.waitFor(() => expect(name.disabled).toBe(false));
    expect(name.value).toBe("");
    const rowName = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Close friends"]',
    )!;
    rowName.value = "Inner circle";
    rowName.dispatchEvent(new Event("input", { bubbles: true }));
    const rowRevert = Array.from(rowName.form!.querySelectorAll("button")).find(
      (button) => button.textContent === "Revert",
    )!;
    expect(rowRevert.hidden).toBe(false);
    rowRevert.focus();
    rowRevert.click();
    expect(rowName.value).toBe("Close friends");
    expect(document.activeElement).toBe(rowName);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes reverted.");
  });

  it("renders global vocabularies as explicitly read-only", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=emotion-options",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          capabilities: { create: false },
          entries: [{
            capabilities: {
              delete: false,
              disable: false,
              reorder: false,
              rename: false,
              replace: false,
              setDefault: false,
            },
            canDelete: false,
            id: "00000000-0000-4000-8000-000000000050",
            isActive: true,
            isDefault: false,
            kind: "named",
            name: "Joy",
            readOnly: true,
            referenceCount: 2,
            sortOrder: 10,
            updatedAt: "2026-08-16T10:00:00.000Z",
          }],
          readOnly: true,
          section: "emotion-options",
          status: "ready",
        })),
    );

    await mountPersonalization();

    expect(document.body.textContent).toContain("Joy");
    expect(document.body.textContent).toContain("Read-only shared option");
    expect(
      document.querySelector("#personalization-create")?.hasAttribute("hidden"),
    )
      .toBe(true);
    expect(document.querySelectorAll(".personalization-actions button"))
      .toHaveLength(0);
  });

  it("describes an empty shared catalog without offering creation", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=pet-categories",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          capabilities: { create: false },
          entries: [],
          readOnly: true,
          section: "pet-categories",
          status: "ready",
        })),
    );

    await mountPersonalization();

    expect(document.querySelector("#personalization-status")?.textContent)
      .toBe("No shared options are available.");
    expect(
      document.querySelector("#personalization-create")?.hasAttribute(
        "hidden",
      ),
    ).toBe(true);
  });

  it("keeps relationship direction labels separate in the edit form", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=relationship-types",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          capabilities: { create: true },
          entries: [{
            capabilities: {
              delete: true,
              disable: true,
              reorder: true,
              rename: true,
              replace: true,
              setDefault: false,
            },
            canDelete: true,
            forwardLabel: "Mentor",
            id: "00000000-0000-4000-8000-000000000060",
            isActive: true,
            isDefault: false,
            kind: "relationship-type",
            name: "Mentor / Mentee",
            readOnly: false,
            referenceCount: 1,
            reverseLabel: "Mentee",
            sortOrder: 10,
            updatedAt: "2026-08-16T10:00:00.000Z",
          }],
          readOnly: false,
          section: "relationship-types",
          status: "ready",
        })),
    );

    await mountPersonalization();

    expect(
      document.querySelector<HTMLInputElement>(
        '.personalization-entry-form input[name="forwardLabel"]',
      )?.value,
    )
      .toBe("Mentor");
    expect(
      document.querySelector<HTMLInputElement>(
        '.personalization-entry-form input[name="reverseLabel"]',
      )?.value,
    )
      .toBe("Mentee");
  });

  it("edits reminder lead time only when the value capability is declared", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=reminder-rules",
    );
    const reminder = {
      capabilities: {
        delete: true,
        disable: true,
        editValue: true,
        rename: false,
        reorder: false,
        replace: false,
        setDefault: false,
      },
      canDelete: true,
      daysBefore: 7,
      id: "00000000-0000-4000-8000-000000000030",
      isActive: true,
      isDefault: false,
      kind: "reminder-rule",
      name: "7 days before",
      readOnly: false,
      referenceCount: 0,
      sortOrder: 7,
      updatedAt: "2026-08-16T10:00:00.000Z",
    };
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") return response(session);
        if (init?.method === "PATCH") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return response({
            entry: {
              ...reminder,
              daysBefore: body.daysBefore,
              name: "3 days before",
              updatedAt: "2026-08-16T10:01:00.000Z",
            },
            status: "saved",
          });
        }
        return response({
          capabilities: { create: true },
          entries: [reminder],
          readOnly: false,
          section: "reminder-rules",
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const input = document.querySelector<HTMLInputElement>(
      '.personalization-entry-form input[name="daysBefore"]',
    )!;
    expect(input.disabled).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>(
        ".personalization-entry-form button[type=submit]",
      )?.textContent,
    ).toBe("Save");
    input.value = "3";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");
    input.form!.requestSubmit();
    await vi.waitFor(() => {
      const patchCall = fetchMock.mock.calls.find((call) =>
        (call[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
        daysBefore: 3,
        expectedUpdatedAt: reminder.updatedAt,
      });
      expect(document.querySelector("#personalization-status")?.textContent)
        .toBe("Option saved.");
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("All changes saved.");
    });
  });

  it("surfaces an actionable relationship replacement collision without clearing the form", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=relationship-types",
    );
    const relationship = (
      id: string,
      forwardLabel: string,
      reverseLabel: string,
    ) => ({
      canDelete: true,
      forwardLabel,
      id,
      isActive: true,
      isDefault: false,
      kind: "relationship-type" as const,
      name: `${forwardLabel} / ${reverseLabel}`,
      referenceCount: 1,
      reverseLabel,
      sortOrder: 0,
      updatedAt: "2026-08-16T10:00:00.000Z",
    });
    const source = relationship(
      "00000000-0000-4000-8000-000000000080",
      "Coach",
      "Student",
    );
    const target = relationship(
      "00000000-0000-4000-8000-000000000081",
      "Advisor",
      "Advisee",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") return response(session);
        if (init?.method === "DELETE") {
          return response({
            code: "personalization_replacement_conflict",
            detail:
              "Some of the same people already have both relationship types. Remove the duplicate relationship before replacing this option.",
            status: 409,
            title: "Replacement conflicts with existing history",
            type: "problem",
          }, 409);
        }
        return response({
          entries: [source, target],
          section: "relationship-types",
          status: "ready",
        });
      }),
    );

    await mountPersonalization();
    const sourceRow = Array.from(
      document.querySelectorAll<HTMLElement>(".personalization-row"),
    ).find((row) =>
      row.querySelector<HTMLInputElement>('input[name="forwardLabel"]')
        ?.value === "Coach"
    )!;
    sourceRow.querySelector<HTMLSelectElement>("select")!.value = target.id;
    sourceRow.querySelector<HTMLButtonElement>("button:last-child")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("same people")
    );
    expect(document.querySelectorAll(".personalization-row")).toHaveLength(2);
    expect(
      sourceRow.querySelector<HTMLInputElement>('input[name="forwardLabel"]')
        ?.value,
    ).toBe("Coach");
  });

  it("guards link, back, and forward history with indexed stay and discard outcomes", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const tag = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000070",
      isActive: true,
      isDefault: false,
      name: "Friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-16T10:00:00.000Z",
    };
    const confirm = vi.fn(() => false);
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    vi.stubGlobal("confirm", confirm);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input) === "/api/v1/session"
          ? Promise.resolve(response(session))
          : Promise.resolve(response({
            entries: String(input).includes("reminder-rules") ? [] : [tag],
            section: String(input).includes("reminder-rules")
              ? "reminder-rules"
              : "tags",
            status: "ready",
          }))
      ),
    );

    await mountPersonalization();
    expect(history.state.personalization).toEqual({
      index: 0,
      section: "tags",
    });
    const name = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Friends"]',
    )!;
    name.value = "Closest friends";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");
    const unload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    expect(location.search).toBe("?section=tags");
    expect(name.value).toBe("Closest friends");

    confirm.mockReturnValue(true);
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-heading")?.textContent)
        .toBe("Reminder rules")
    );
    expect(location.search).toBe("?section=reminder-rules");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );

    await vi.waitFor(() =>
      expect(document.querySelector('input[name="daysBefore"]')).not.toBeNull()
    );
    const days = document.querySelector<HTMLInputElement>(
      'input[name="daysBefore"]',
    )!;
    days.value = "14";
    days.dispatchEvent(new Event("input", { bubbles: true }));
    confirm.mockReturnValue(false);
    const tagsState = { personalization: { index: 0, section: "tags" } };
    history.replaceState(tagsState, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: tagsState }));
    expect(go).toHaveBeenLastCalledWith(1);
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Reminder rules");
    expect(days.value).toBe("14");

    const reminderState = {
      personalization: { index: 1, section: "reminder-rules" },
    };
    history.replaceState(reminderState, "", "?section=reminder-rules");
    dispatchEvent(new PopStateEvent("popstate", { state: reminderState }));
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(days.value).toBe("14");

    confirm.mockReturnValue(true);
    history.replaceState(tagsState, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: tagsState }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-heading")?.textContent)
        .toBe("Tags")
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );

    await vi.waitFor(() =>
      expect(
        document.querySelector('input[aria-label="Name for Friends"]'),
      ).not.toBeNull()
    );
    const forwardName = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Friends"]',
    )!;
    forwardName.value = "Forward draft";
    forwardName.dispatchEvent(new Event("input", { bubbles: true }));
    confirm.mockReturnValue(false);
    history.replaceState(reminderState, "", "?section=reminder-rules");
    dispatchEvent(new PopStateEvent("popstate", { state: reminderState }));
    expect(go).toHaveBeenLastCalledWith(-1);
    expect(forwardName.value).toBe("Forward draft");

    history.replaceState(tagsState, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: tagsState }));
    expect(confirm).toHaveBeenCalledTimes(5);
    expect(forwardName.value).toBe("Forward draft");

    confirm.mockReturnValue(true);
    history.replaceState(reminderState, "", "?section=reminder-rules");
    dispatchEvent(new PopStateEvent("popstate", { state: reminderState }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-heading")?.textContent)
        .toBe("Reminder rules")
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    await vi.waitFor(() =>
      expect(document.querySelector('input[name="daysBefore"]')).not.toBeNull()
    );
    const invalidDays = document.querySelector<HTMLInputElement>(
      'input[name="daysBefore"]',
    )!;
    invalidDays.value = "21";
    invalidDays.dispatchEvent(new Event("input", { bubbles: true }));
    const invalidState = {};
    history.replaceState(invalidState, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: invalidState }));
    expect(location.search).toBe("?section=reminder-rules");
    expect(invalidDays.value).toBe("21");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
  });

  it("resets discarded create controls only after the target section loads", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=relationship-types",
    );
    let failTags = true;
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const path = String(input);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.includes("tags") && failTags) {
          return Promise.resolve(response({
            code: "personalization_unavailable",
            detail: "Tags could not be loaded.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503));
        }
        const section = PERSONALIZATION_SECTIONS.find(({ id }) =>
          path.includes(id)
        )?.id ?? "profile-modules";
        return Promise.resolve(response({
          capabilities: { create: true },
          entries: [],
          section,
          status: "ready",
        }));
      }),
    );

    await mountPersonalization();
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    const forward = create.elements.namedItem(
      "forwardLabel",
    ) as HTMLInputElement;
    const reverse = create.elements.namedItem(
      "reverseLabel",
    ) as HTMLInputElement;
    forward.value = "Mentor";
    reverse.value = "Student";
    forward.dispatchEvent(new Event("input", { bubbles: true }));

    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="tags"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("Tags could not be loaded. Retry")
    );
    expect(location.search).toBe("?section=tags");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "tags",
    });
    expect(forward.value).toBe("Mentor");
    expect(reverse.value).toBe("Student");
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");

    failTags = false;
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    expect(create.elements.namedItem("forwardLabel")).toBeNull();
    expect(create.elements.namedItem("reverseLabel")).toBeNull();
    const days = create.elements.namedItem("daysBefore") as HTMLInputElement;
    expect(days.value).toBe("");
    expect((create.elements.namedItem("name") as HTMLInputElement).value).toBe(
      "",
    );

    days.value = "21";
    days.dispatchEvent(new Event("input", { bubbles: true }));
    const relationshipState = {
      personalization: { index: 0, section: "relationship-types" },
    };
    history.replaceState(
      relationshipState,
      "",
      "?section=relationship-types",
    );
    dispatchEvent(new PopStateEvent("popstate", { state: relationshipState }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    expect(create.elements.namedItem("daysBefore")).toBeNull();
    expect(
      (create.elements.namedItem("forwardLabel") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (create.elements.namedItem("reverseLabel") as HTMLInputElement).value,
    ).toBe("");

    const newForward = create.elements.namedItem(
      "forwardLabel",
    ) as HTMLInputElement;
    newForward.value = "Parent";
    newForward.dispatchEvent(new Event("input", { bubbles: true }));
    const reminderState = {
      personalization: { index: 2, section: "reminder-rules" },
    };
    history.replaceState(reminderState, "", "?section=reminder-rules");
    dispatchEvent(new PopStateEvent("popstate", { state: reminderState }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    expect(
      (create.elements.namedItem("daysBefore") as HTMLInputElement).value,
    ).toBe("");
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes discarded.");
  });

  it("keeps edited authoritative forms when link or back loading fails", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const go = vi.spyOn(history, "go").mockImplementation(() => undefined);
    let failTags = false;
    const tag = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000072",
      isActive: true,
      isDefault: false,
      name: "Friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-16T10:00:00.000Z",
    };
    const gender = {
      ...tag,
      id: "00000000-0000-4000-8000-000000000073",
      name: "Custom",
    };
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const path = String(input);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.includes("reminder-rules")) {
          return Promise.reject(new Error("offline"));
        }
        if (path.includes("tags") && failTags) {
          return Promise.resolve(response({
            code: "personalization_unavailable",
            detail: "Target section could not be loaded.",
            status: 503,
            title: "Unavailable",
            type: "problem",
          }, 503));
        }
        const section = path.includes("gender-options")
          ? "gender-options"
          : "tags";
        return Promise.resolve(response({
          capabilities: { create: true },
          entries: section === "tags" ? [tag] : [gender],
          section,
          status: "ready",
        }));
      }),
    );

    await mountPersonalization();
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    const tagName = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Friends"]',
    )!;
    const createName = create.elements.namedItem("name") as HTMLInputElement;
    tagName.value = "Closest friends";
    tagName.dispatchEvent(new Event("input", { bubbles: true }));
    createName.value = "Family";
    createName.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("This section could not be loaded. Retry")
    );
    expect(location.search).toBe("?section=reminder-rules");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "reminder-rules",
    });
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Tags");
    expect(tagName.value).toBe("Closest friends");
    expect(tagName.disabled).toBe(false);
    expect(createName.value).toBe("Family");
    expect(createName.disabled).toBe(false);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");

    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="gender-options"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    const genderName = document.querySelector<HTMLInputElement>(
      'input[aria-label="Name for Custom"]',
    )!;
    genderName.value = "Individual";
    genderName.dispatchEvent(new Event("input", { bubbles: true }));
    createName.value = "Another gender";
    createName.dispatchEvent(new Event("input", { bubbles: true }));
    failTags = true;
    const tagsState = { personalization: { index: 0, section: "tags" } };
    history.replaceState(tagsState, "", "?section=tags");
    dispatchEvent(new PopStateEvent("popstate", { state: tagsState }));
    await vi.waitFor(() => expect(go).toHaveBeenLastCalledWith(2));
    const genderState = {
      personalization: { index: 2, section: "gender-options" },
    };
    history.replaceState(genderState, "", "?section=gender-options");
    dispatchEvent(new PopStateEvent("popstate", { state: genderState }));
    expect(location.search).toBe("?section=gender-options");
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Gender options");
    expect(genderName.value).toBe("Individual");
    expect(genderName.disabled).toBe(false);
    expect(createName.value).toBe("Another gender");
    expect(createName.disabled).toBe(false);
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");
  });

  it("announces discard only after the authoritative target load wins", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const initial = deferred<Response>();
    const target = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input) === "/api/v1/session") {
        return Promise.resolve(response(session));
      }
      return String(input).includes("reminder-rules")
        ? target.promise
        : initial.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    const mounted = mountPersonalization();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    initial.resolve(response({
      capabilities: { create: true },
      entries: [],
      section: "tags",
      status: "ready",
    }));
    await mounted;
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    create.querySelector<HTMLInputElement>('input[name="name"]')!.value =
      "Draft";
    create.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .not.toBe("Changes discarded.");
    const unload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    target.resolve(response({
      capabilities: { create: true },
      entries: [],
      section: "reminder-rules",
      status: "ready",
    }));
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-dirty")?.textContent)
        .toBe("Changes discarded.")
    );
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Reminder rules");
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes discarded.");
    const days = document.querySelector<HTMLInputElement>(
      'input[name="daysBefore"]',
    )!;
    days.dispatchEvent(new Event("input", { bubbles: true }));
    days.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Changes discarded.");
    days.value = "7";
    days.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("Unsaved changes.");
    days.value = "";
    days.dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.querySelector("#personalization-dirty")?.textContent)
      .toBe("All changes saved.");
  });

  it("makes stale mutation controls inert while a target section loads", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const reminder = deferred<Response>();
    const tag = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000071",
      isActive: true,
      isDefault: false,
      name: "Friends",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-16T10:00:00.000Z",
    };
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (init?.method) {
          return Promise.resolve(response({ entry: tag, status: "saved" }));
        }
        if (path.includes("reminder-rules")) return reminder.promise;
        const section = path.includes("relationship-types")
          ? "relationship-types"
          : "tags";
        return Promise.resolve(response({
          capabilities: { create: true },
          entries: section === "tags" ? [tag] : [],
          section,
          status: "ready",
        }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    const staleRow = document.querySelector<HTMLFormElement>(
      ".personalization-entry-form",
    )!;
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    expect(
      document.querySelector("#personalization-list")?.getAttribute(
        "aria-busy",
      ),
    ).toBe("true");
    for (
      const control of document.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >("#personalization-create input, #personalization-create button, #personalization-list input, #personalization-list select, #personalization-list button")
    ) {
      expect(control.disabled).toBe(true);
    }
    create.querySelector<HTMLButtonElement>("button")!.click();
    staleRow.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method),
    ).toHaveLength(0);

    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="relationship-types"]',
    )!.click();
    await vi.waitFor(() =>
      expect(create.elements.namedItem("forwardLabel")).not.toBeNull()
    );
    expect(
      document.querySelector("#personalization-list")?.getAttribute(
        "aria-busy",
      ),
    ).toBe("false");
    expect(
      (create.elements.namedItem("forwardLabel") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(
      (create.elements.namedItem("reverseLabel") as HTMLInputElement).disabled,
    ).toBe(false);
    expect(create.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );

    reminder.resolve(response({
      capabilities: { create: true },
      entries: [],
      section: "reminder-rules",
      status: "ready",
    }));
    await Promise.resolve();
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Relationship types");
    expect(create.elements.namedItem("daysBefore")).toBeNull();
    expect(create.elements.namedItem("forwardLabel")).not.toBeNull();
  });

  it("does not let a delayed initial section response overwrite a created option", async () => {
    markup();
    const initial = deferred<Response>();
    const created = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000003",
      isActive: true,
      isDefault: false,
      name: "Tags",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-16T11:00:00.000Z",
    };
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        if (String(input) === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (init?.method === "POST") {
          return Promise.resolve(response({ entry: created, status: "saved" }));
        }
        if (fetchMock.mock.calls.length === 2) return initial.promise;
        return Promise.resolve(response({
          entries: [created],
          section: "profile-modules",
          status: "ready",
        }));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const mounted = mountPersonalization();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const create = document.querySelector<HTMLFormElement>(
      "#personalization-create",
    )!;
    create.querySelector("input")!.value = "Tags";
    create.requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Name for Tags"]',
        )?.value,
      ).toBe("Tags")
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toBe("Option created.")
    );
    initial.resolve(response({
      entries: [],
      section: "profile-modules",
      status: "ready",
    }));
    await mounted;

    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="Name for Tags"]',
      )?.value,
    ).toBe("Tags");
    expect(document.querySelector("#personalization-status")?.textContent)
      .toBe("Option created.");
  });

  it("discards a delayed response after section navigation", async () => {
    markup();
    history.replaceState({}, "", "/app/settings/personalization?section=tags");
    const initial = deferred<Response>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      if (String(input) === "/api/v1/session") {
        return Promise.resolve(response(session));
      }
      if (fetchMock.mock.calls.length === 2) return initial.promise;
      return Promise.resolve(response({
        entries: [],
        section: "reminder-rules",
        status: "ready",
      }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const mounted = mountPersonalization();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="reminder-rules"]',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#personalization-status")?.textContent)
        .toContain("No options yet")
    );
    initial.resolve(response({
      entries: [{
        canDelete: true,
        id: "00000000-0000-4000-8000-000000000004",
        isActive: true,
        isDefault: false,
        name: "Late tag",
        referenceCount: 0,
        sortOrder: 0,
        updatedAt: "2026-08-16T11:00:00.000Z",
      }],
      section: "tags",
      status: "ready",
    }));
    await mounted;

    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Reminder rules");
    expect(document.querySelector("#personalization-list")?.children)
      .toHaveLength(0);
    expect(document.querySelector("#personalization-status")?.textContent)
      .toContain("No options yet");
  });

  it("keeps section navigation authoritative over a later refresh", async () => {
    markup();
    const unknownLink = document.createElement("a");
    unknownLink.dataset.personalizationSection = "unknown";
    unknownLink.href = "?section=unknown";
    document.querySelector("nav")!.append(unknownLink);
    history.replaceState(
      {},
      "",
      "/app/settings/personalization?section=profile-modules",
    );
    const mutation = deferred<Response>();
    const navigation = deferred<Response>();
    const trailingRefresh = deferred<Response>();
    const profileModule = {
      canDelete: true,
      id: "00000000-0000-4000-8000-000000000005",
      isActive: true,
      isDefault: false,
      name: "Tags",
      referenceCount: 0,
      sortOrder: 0,
      updatedAt: "2026-08-16T11:00:00.000Z",
    };
    let initialProfileRead = true;
    let tagReads = 0;
    let trailingSection = "";
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (init?.method === "PATCH") return mutation.promise;
        if (path.includes("/tags")) {
          tagReads += 1;
          if (tagReads === 1) return navigation.promise;
          trailingSection = "tags";
          return trailingRefresh.promise;
        }
        if (initialProfileRead) {
          initialProfileRead = false;
          return Promise.resolve(response({
            entries: [profileModule],
            section: "profile-modules",
            status: "ready",
          }));
        }
        trailingSection = "profile-modules";
        return trailingRefresh.promise;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonalization();
    const toggle = Array.from(document.querySelectorAll<HTMLButtonElement>(
      ".personalization-actions button",
    )).find((button) => button.textContent === "Disable")!;
    toggle.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const tagsLink = document.querySelector<HTMLAnchorElement>(
      '[data-personalization-section="tags"]',
    )!;
    tagsLink.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    mutation.resolve(response({
      entry: { ...profileModule, isActive: false },
      status: "saved",
    }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    navigation.resolve(response({
      entries: [],
      section: "tags",
      status: "ready",
    }));
    trailingRefresh.resolve(response({
      entries: trailingSection === "profile-modules" ? [profileModule] : [],
      section: trailingSection,
      status: "ready",
    }));
    await vi.waitFor(() =>
      expect(
        document.querySelector("#personalization-list")?.getAttribute(
          "aria-busy",
        ),
      ).toBe("false")
    );

    expect(location.search).toBe("?section=tags");
    expect(history.state.personalization).toEqual({
      index: 1,
      section: "tags",
    });
    expect(document.querySelector("#personalization-heading")?.textContent)
      .toBe("Tags");
    expect(trailingSection).toBe("tags");
    const requestCount = fetchMock.mock.calls.length;
    tagsLink.focus();
    tagsLink.click();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
    expect(document.activeElement).toBe(tagsLink);
    expect(document.querySelector("#personalization-status")?.textContent)
      .toBe("That personalization section is already open.");
    unknownLink.focus();
    unknownLink.click();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
    expect(location.search).toBe("?section=tags");
    expect(document.activeElement).toBe(unknownLink);
    expect(document.querySelector("#personalization-status")?.textContent)
      .toBe("That personalization section is already open.");
  });
});
