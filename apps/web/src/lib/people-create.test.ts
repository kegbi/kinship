// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPeopleCreate } from "./people-create.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function markup(): HTMLFormElement {
  document.body.dataset.pageId = "people.create";
  document.body.innerHTML = `
    <header id="people-create-heading"><h1>Add a person</h1></header>
    <form id="people-create-form">
      <p id="people-form-errors" tabindex="-1" hidden></p>
      <input name="givenName"><small data-field-error="givenName"></small>
      <input name="middleName"><input name="familyName"><input name="nickname">
      <input name="isPartial" type="checkbox"><small data-field-error="isPartial"></small>
      <section id="duplicate-warning" tabindex="-1" hidden><p id="duplicate-detail"></p><button id="create-anyway" type="button">Create anyway</button><button id="review-person" type="button">Review</button></section>
      <button id="save-person" type="submit">Save person</button>
      <button id="save-add-another" type="submit">Save and add another</button>
      <p id="people-create-status"></p>
    </form>
    <section id="created-person" tabindex="-1" hidden>
      <h1 id="created-person-name" tabindex="-1"></h1>
      <p id="created-person-partial" hidden></p>
      <span data-person-field="givenName"></span><span data-person-field="middleName"></span><span data-person-field="familyName"></span><span data-person-field="nickname"></span>
    </section>`;
  return document.querySelector<HTMLFormElement>("form")!;
}

function set(form: HTMLFormElement, name: string, value: string): void {
  (form.elements.namedItem(name) as HTMLInputElement).value = value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
  delete document.body.dataset.pageId;
});

describe("PEOPLE-001 person creation form", () => {
  it("creates through the generated client and opens the complete person workspace", async () => {
    const form = markup();
    set(form, "givenName", "Ada");
    set(form, "familyName", "Lovelace");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        next: `/app/people/${personId}`,
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: personId,
          isPartial: false,
        },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    const navigate = vi.fn();
    await mountPeopleCreate(navigate);
    document.querySelector<HTMLButtonElement>("#save-person")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/app/people/${personId}`)
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/people");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaceId,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    expect(location.pathname).toBe("/");
    expect(document.body.dataset.pageId).toBe("people.create");
  });

  it("keeps duplicate guidance non-blocking through explicit create-anyway", async () => {
    const form = markup();
    set(form, "givenName", "Ada");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        code: "possible_duplicate",
        detail: "Ada already exists in this workspace.",
        status: 409,
      }, 409))
      .mockResolvedValueOnce(response({
        next: `/app/people/${personId}`,
        person: { givenName: "Ada", id: personId, isPartial: false },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleCreate();
    document.querySelector<HTMLButtonElement>("#save-person")!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector("#duplicate-warning")?.hasAttribute("hidden"),
      )
        .toBe(false)
    );
    expect(document.querySelector("#duplicate-detail")?.textContent).toMatch(
      /already exists/i,
    );
    document.querySelector<HTMLButtonElement>("#create-anyway")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)))
      .toMatchObject({ duplicateOverride: true });
  });

  it("saves a partial person and resets for save-and-add-another", async () => {
    const form = markup();
    set(form, "familyName", "Unknown-first-name");
    (form.elements.namedItem("isPartial") as HTMLInputElement).checked = true;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        next: `/app/people/${personId}`,
        person: {
          familyName: "Unknown-first-name",
          givenName: "",
          id: personId,
          isPartial: true,
        },
        status: "created",
      }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleCreate();
    document.querySelector<HTMLButtonElement>("#save-add-another")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(document.querySelector("#people-create-status")?.textContent)
        .toMatch(/add another person/i)
    );
    expect(location.pathname).toBe("/");
    expect(document.body.dataset.pageId).toBe("people.create");
    expect((form.elements.namedItem("familyName") as HTMLInputElement).value)
      .toBe("");
    expect(document.activeElement).toBe(form.elements.namedItem("givenName"));
  });

  it("validates explicit unknown values before sending and handles unavailable sessions", async () => {
    const form = markup();
    set(form, "nickname", "The Countess");
    const fetchMock = vi.fn().mockResolvedValueOnce(response(session));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleCreate();
    document.querySelector<HTMLButtonElement>("#save-person")!.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('[data-field-error="isPartial"]')?.textContent,
    )
      .toMatch(/mark this person as partial/i);

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({ code: "session_invalid", status: 401 }, 401),
      ),
    );
    await mountPeopleCreate();
    expect(document.querySelector("#people-create-status")?.textContent)
      .toMatch(
        /could not be confirmed/i,
      );

    document.body.innerHTML = "<main></main>";
    await expect(mountPeopleCreate()).resolves.toBeUndefined();
  });
});
