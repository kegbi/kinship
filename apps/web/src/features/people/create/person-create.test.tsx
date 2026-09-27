// @vitest-environment happy-dom

import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import { adoptMount, drawShell, element } from "../../../testing/render.tsx";
import { mountPeopleCreate } from "./person-create.tsx";

const { person: personId, workspace: workspaceId } = ids;
const SESSION = "GET /api/v1/session";
const CREATE = "POST /api/v1/people";
const ENTRY = "POST /api/v1/application-entry";
const session = jsonResponse(workspaceSession());

const created = (person: Record<string, unknown> = {}) =>
  jsonResponse({
    next: `/app/people/${personId}`,
    person: { givenName: "Ada", id: personId, isPartial: false, ...person },
    status: "created",
  }, 201);

/** The page's form as `pages/app/people/new.astro` draws it. */
function markup(): void {
  history.replaceState({}, "", "/");
  document.body.dataset.pageId = "people.create";
  drawShell(`
    <main>
      <header id="people-create-heading"><h1>Add a person</h1></header>
      <div class="contents" data-people-create>
        <form method="post" id="people-create-form" novalidate>
          <p id="people-form-errors" role="alert" tabindex="-1" hidden></p>
          <label>Given name <input name="givenName" /></label>
          <label>Middle name <input name="middleName" /></label>
          <label>Family name <input name="familyName" /></label>
          <label>Nickname <input name="nickname" /></label>
          <input id="person-is-partial" name="isPartial" type="checkbox" />
          <label for="person-is-partial">Some identity details are unknown</label>
          <button id="save-person" type="submit" disabled>Save person</button>
          <button id="save-add-another" type="submit" disabled>Save and add another</button>
          <p id="people-create-status" role="status"></p>
        </form>
      </div>
    </main>`);
}

/** Mounts the island, and waits until the workspace read has answered. */
async function mount(navigate = vi.fn()): Promise<typeof navigate> {
  await act(async () => {
    adoptMount(mountPeopleCreate(document, navigate));
    await Promise.resolve();
  });
  return navigate;
}

const form = () => within(element("#people-create-form"));
const field = (label: string) =>
  form().getByLabelText<HTMLInputElement>(label, { exact: false });
const button = (name: string) => form().getByRole("button", { name });
const statusLine = () => element("#people-create-status").textContent;
/** The `index`th create request's body. */
const body = (api: ReturnType<typeof stubApi>, index: number) =>
  api.bodies()[index];

describe("PEOPLE-001 person creation form", () => {
  it("prefills only the given and family names from the create URL", async () => {
    markup();
    history.replaceState(
      {},
      "",
      "/app/people/new?givenName=Marie&familyName=Dupont&nickname=Ignored",
    );
    // A typed field wins over the address; an empty one does not.
    element<HTMLInputElement>('[name="familyName"]').value = "";
    stubApi({ [SESSION]: session });

    await mount();

    expect(field("Given name").value).toBe("Marie");
    expect(field("Family name").value).toBe("Dupont");
    expect(field("Middle name").value).toBe("");
    expect(field("Nickname").value).toBe("");
    expect(field("Some identity details are unknown").checked).toBe(false);
    expect(element("[data-people-create]").dataset.island).toBe(
      "people-create",
    );
    expect(button("Save person")).toHaveProperty("disabled", false);
  });

  it("keeps what was typed into the static form, and where", async () => {
    markup();
    element("#people-create-form").insertAdjacentHTML(
      "beforeend",
      '<input name="retired" value="Dropped">',
    );
    const given = element<HTMLInputElement>('[name="givenName"]');
    given.value = "Grace";
    element<HTMLInputElement>('[name="isPartial"]').checked = true;
    given.focus();
    stubApi({ [SESSION]: session });
    await mount();
    expect(field("Given name")).not.toBe(given);
    expect(field("Given name").value).toBe("Grace");
    expect(field("Some identity details are unknown").checked).toBe(true);
    expect(document.activeElement).toBe(field("Given name"));
  });

  it("creates through the generated client and opens the complete person workspace", async () => {
    markup();
    const api = stubApi({
      [CREATE]: created({ familyName: "Lovelace" }),
      [SESSION]: session,
    });
    const navigate = vi.spyOn(location, "assign").mockImplementation(() =>
      undefined
    );
    await act(async () => {
      adoptMount(mountPeopleCreate());
      await Promise.resolve();
    });
    const user = userEvent.setup();
    await user.type(field("Given name"), "Ada");
    await user.type(field("Family name"), "Lovelace");
    await user.click(button("Save person"));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/app/people/${personId}`)
    );
    const [, request] = api.requests();
    expect(request?.url.pathname).toBe("/api/v1/people");
    expect(request?.headers.get("X-Workspace-Id")).toBe(workspaceId);
    expect(body(api, 0)).toEqual({
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: false,
    });
    expect(location.pathname).toBe("/");
    expect(document.body.dataset.pageId).toBe("people.create");
    await expectNoAxeViolations(element("main"));
  });

  it("keeps a person saved before the page loaded off the URL and creates them once loaded", async () => {
    markup();
    const held = deferred<Response>();
    const api = stubApi({ [CREATE]: created(), [SESSION]: held.promise });
    const navigate = await mount();
    const user = userEvent.setup();
    await user.type(field("Given name"), "Ada");
    let early: Event | undefined;
    document.addEventListener("submit", (event) => early = event, {
      once: true,
    });
    await user.click(button("Save and add another"));
    expect(early?.defaultPrevented).toBe(true);
    expect(location.search).toBe("");
    expect(statusLine()).toBe("Saving person…");
    expect(button("Save person")).toHaveProperty("disabled", true);
    // A second submission while the first is pending is not sent again.
    fireEvent.submit(element("#people-create-form"));
    await act(async () => {
      held.resolve(session);
      await held.promise;
    });
    await waitFor(() =>
      expect(statusLine()).toBe("Ada created. Add another person.")
    );
    expect(body(api, 0)).toEqual({ givenName: "Ada", isPartial: false });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps duplicate guidance non-blocking through explicit create-anyway", async () => {
    markup();
    const api = stubApi({
      [CREATE]: [
        ...[1, 2].map(() =>
          problemResponse(409, {
            code: "possible_duplicate",
            detail: "Ada already exists in this workspace.",
          })
        ),
        created(),
      ],
      [SESSION]: session,
    });
    await mount();
    const user = userEvent.setup();
    await user.type(field("Given name"), "Ada");
    await user.click(button("Save person"));
    const warning = element("#duplicate-warning");
    await waitFor(() => expect(warning.hidden).toBe(false));
    expect(document.activeElement).toBe(warning);
    expect(element("#duplicate-detail").textContent).toMatch(/already exists/i);
    expect(statusLine()).toBe("Ada already exists in this workspace.");
    await user.click(button("Review the names"));
    expect(warning.hidden).toBe(true);
    expect(document.activeElement).toBe(field("Given name"));
    await user.click(button("Save person"));
    await waitFor(() => expect(warning.hidden).toBe(false));
    await user.click(button("Create anyway"));
    await waitFor(() => expect(api.bodies()).toHaveLength(3));
    expect(body(api, 1)).not.toHaveProperty("duplicateOverride");
    expect(body(api, 2)).toMatchObject({ duplicateOverride: true });
  });

  it("saves a partial person and resets for save-and-add-another", async () => {
    markup();
    const api = stubApi({
      [CREATE]: created({
        familyName: "Unknown-first-name",
        givenName: "",
        isPartial: true,
      }),
      [SESSION]: session,
    });
    await mount();
    const user = userEvent.setup();
    await user.type(field("Family name"), "Unknown-first-name");
    await user.click(field("Some identity details are unknown"));
    await user.click(button("Save and add another"));
    await waitFor(() => expect(statusLine()).toMatch(/add another person/i));
    expect(statusLine()).toBe(
      "Unknown-first-name created. Add another person.",
    );
    expect(body(api, 0)).toEqual({
      familyName: "Unknown-first-name",
      givenName: "",
      isPartial: true,
    });
    expect(location.pathname).toBe("/");
    expect(field("Family name").value).toBe("");
    expect(field("Some identity details are unknown").checked).toBe(false);
    expect(document.activeElement).toBe(field("Given name"));
  });

  it("names a created person by nickname, or as unnamed", async () => {
    markup();
    stubApi({
      [CREATE]: [
        created({ givenName: "", isPartial: true, nickname: "Countess" }),
        created({ givenName: "", isPartial: true }),
      ],
      [SESSION]: session,
    });
    await mount();
    const user = userEvent.setup();
    await user.type(field("Nickname"), "Countess");
    await user.click(field("Some identity details are unknown"));
    await user.click(button("Save and add another"));
    await waitFor(() =>
      expect(statusLine()).toBe("Countess created. Add another person.")
    );
    await user.type(field("Nickname"), "Countess");
    await user.type(field("Middle name"), "Mid");
    await user.click(field("Some identity details are unknown"));
    await user.click(button("Save and add another"));
    await waitFor(() =>
      expect(statusLine()).toBe("Unnamed person created. Add another person.")
    );
  });

  it("validates explicit unknown values before sending", async () => {
    markup();
    const api = stubApi({ [SESSION]: session });
    await mount();
    const user = userEvent.setup();
    await user.click(button("Save person"));
    expect(element("#people-form-errors").hidden).toBe(false);
    expect(element("#people-form-errors").textContent).toBe(
      "Review the highlighted identity fields and try again.",
    );
    expect(field("Given name").getAttribute("aria-invalid")).toBe("true");
    expect(field("Given name").validationMessage).toBe(
      "Enter a given name, family name, or nickname.",
    );
    expect(document.activeElement).toBe(field("Given name"));
    await user.type(field("Given name"), "A");
    expect(field("Given name").hasAttribute("aria-invalid")).toBe(false);
    expect(element('[data-field-error="givenName"]').textContent).toBe("");
    await user.clear(field("Given name"));
    await user.type(field("Nickname"), "The Countess");
    await user.click(button("Save person"));
    expect(api.bodies()).toHaveLength(0);
    expect(element('[data-field-error="isPartial"]').textContent).toMatch(
      /mark this person as partial/i,
    );
    expect(document.activeElement).toBe(
      field("Some identity details are unknown"),
    );
    await user.type(field("Family name"), "x");
    expect(element('[data-field-error="isPartial"]').textContent).not.toBe("");
  });

  it("shows the server's field errors, and a failure without them", async () => {
    markup();
    stubApi({
      [CREATE]: [
        problemResponse(422, {
          detail: "The identity is invalid.",
          errors: { givenName: "Too long.", unknown: "Ignored." },
        }),
        problemResponse(422, { errors: { unknown: "Ignored." } }),
        () => Promise.reject(new Error("offline")),
      ],
      [SESSION]: session,
    });
    await mount();
    const user = userEvent.setup();
    await user.type(field("Given name"), "Ada");
    await user.click(button("Save person"));
    await waitFor(() =>
      expect(element('[data-field-error="givenName"]').textContent).toBe(
        "Too long.",
      )
    );
    expect(statusLine()).toBe("The identity is invalid.");
    expect(document.activeElement).toBe(field("Given name"));
    await user.click(button("Save person"));
    // Errors naming no field of this form leave the summary to say so.
    await waitFor(() =>
      expect(document.activeElement).toBe(element("#people-form-errors"))
    );
    expect(field("Given name").hasAttribute("aria-invalid")).toBe(false);
    fireEvent.submit(element("#people-create-form"));
    await waitFor(() =>
      expect(statusLine()).toBe("The person could not be created. Try again.")
    );
  });

  it("says when the workspace cannot be confirmed", async () => {
    markup();
    const api = stubApi({
      [ENTRY]: problemResponse(401),
      [SESSION]: problemResponse(401, { code: "session_invalid" }),
    });
    await mount();
    await waitFor(() =>
      expect(statusLine()).toMatch(/could not be confirmed/i)
    );
    const user = userEvent.setup();
    await user.type(field("Given name"), "Ada");
    await user.click(button("Save person"));
    await waitFor(() =>
      expect(statusLine()).toMatch(/could not be confirmed/i)
    );
    expect(
      api.requests().some((request) =>
        request.method === "POST" &&
        request.url.pathname === "/api/v1/people"
      ),
    ).toBe(false);
  });

  it("does nothing without the form region", () => {
    drawShell("<main></main>");
    const api = stubApi();
    adoptMount(mountPeopleCreate());
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
