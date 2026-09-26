// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { mountContactMethods } from "./contact-methods.tsx";
import {
  block,
  fact,
  factRead,
  mountFacts,
  nextRevision,
  personId,
  railBlock,
  response,
  revision,
  shell,
  stubFetch,
  unmountFacts,
} from "./facts.test-helper.ts";

const typeId = "00000000-0000-4000-8000-000000000200";
const phoneTypeId = "00000000-0000-4000-8000-000000000201";
const labelId = "00000000-0000-4000-8000-000000000210";
const email = { id: typeId, kind: "contact-type", name: "Email" };

function contact(value: string, id: string, extra: object = {}) {
  return fact("contact-methods", {
    isPrimary: false,
    labelIds: [],
    typeId,
    value,
    ...extra,
  }, id);
}

let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  unmountFacts();
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const section = () => within(block("contact-methods"));
const stateLine = () =>
  block("contact-methods").querySelector("[data-profile-fact-state]")!;
const rows = () => [
  ...block("contact-methods").querySelectorAll<HTMLLIElement>(
    "[data-profile-fact-list] > li",
  ),
];

describe("GAP-029 contact methods island", () => {
  it("PRF-001 separates contact labels and values from compact local actions", async () => {
    shell(railBlock("contact-methods"));
    const value = "ada.lovelace.correspondence@analytical-engines.example.test";
    stubFetch(() =>
      factRead([contact(value, personId, { isPrimary: true })], {
        options: [{ id: typeId, kind: "contact-type", name: "Personal email" }],
      })
    );
    await mountFacts(mountContactMethods);
    const item = rows()[0]!;
    expect(item.querySelector(".profile-fact-label")?.textContent).toBe(
      "Personal email: ",
    );
    expect(item.querySelector(".profile-fact-value")?.textContent).toBe(value);
    const buttons = [
      ...item.querySelectorAll<HTMLButtonElement>(
        ".profile-fact-actions > button",
      ),
    ];
    expect(buttons.map((button) => button.firstChild?.textContent)).toEqual([
      "Edit",
      "Delete",
    ]);
    const [edit, remove] = buttons;
    expect(edit!.className).toContain("bg-card");
    expect(edit!.querySelector(".sr-only")?.textContent).toBe(
      ` Personal email: ${value}`,
    );
    expect(remove!.className).toBe(buttonVariants({
      className: "profile-rail-remove",
      variant: "destructive",
    }));
    await userEvent.setup().click(remove!);
    expect(remove!.firstChild?.textContent).toBe("Confirm delete");
    expect(remove!.querySelector(".sr-only")?.textContent).toBe(
      ` Personal email: ${value}`,
    );
    expect(document.activeElement).toBe(stateLine());
  });

  it("links and copies the primary methods and collapses every other one", async () => {
    shell(railBlock("contact-methods"));
    const primaryId = "00000000-0000-4000-8000-000000000301";
    const phoneId = "00000000-0000-4000-8000-000000000302";
    const secondaryId = "00000000-0000-4000-8000-000000000306";
    stubFetch(() =>
      factRead([
        contact("ada@example.test", primaryId, { isPrimary: true }),
        contact("+44 20 7946 0958", phoneId, {
          isPrimary: true,
          typeId: phoneTypeId,
        }),
        contact("other@example.test", secondaryId),
      ], {
        options: [email, {
          id: phoneTypeId,
          kind: "contact-type",
          name: "Phone",
        }],
      })
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mountFacts(mountContactMethods, {
      primaryContactMethods: [{
        href: "mailto:ada@example.test",
        id: primaryId,
        kind: "email",
        label: "Email",
        value: "ada@example.test",
      }, {
        id: phoneId,
        kind: "phone",
        label: "Phone",
        value: "+44 20 7946 0958",
      }],
    });
    expect(
      section().getByRole("link", { name: "ada@example.test" }).getAttribute(
        "href",
      ),
    ).toBe("mailto:ada@example.test");
    const copy = section().getByRole("button", {
      name: "Copy ada@example.test",
    });
    expect(copy.className).toContain("profile-contact-copy");
    // A click, not a user-event session, which would install its own
    // clipboard over the stub.
    act(() => copy.click());
    await waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toContain(
        "Copied ada@example.test",
      )
    );
    expect(writeText).toHaveBeenCalledWith("ada@example.test");
    const phone = rows().find((row) =>
      row.textContent?.includes("+44 20 7946 0958")
    )!;
    expect(phone.hidden).toBe(false);
    expect(phone.querySelector("a")).toBeNull();
    expect(
      within(phone).getByRole("button", { name: "Copy +44 20 7946 0958" }),
    ).toBeTruthy();
    const secondary = rows().find((row) =>
      row.textContent?.includes("other@example.test")
    )!;
    expect(secondary.hidden).toBe(true);
    const expander = section().getByRole("button", {
      name: "+ 1 more contact methods",
    });
    expect(expander.hasAttribute("aria-label")).toBe(false);
    // Below the page controls, where the vanilla rail drew it.
    expect(
      expander.previousElementSibling?.hasAttribute(
        "data-profile-fact-pagination",
      ),
    ).toBe(true);
    expect(expander.firstChild?.textContent).toBe("+ 1 more");
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    await userEvent.setup().click(expander);
    expect(secondary.hidden).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.textContent).toBe("Show fewer contact methods");
  });

  it("reports a rejected copy through the toast region", async () => {
    shell(railBlock("contact-methods"));
    const primaryId = "00000000-0000-4000-8000-000000000305";
    stubFetch(() =>
      factRead([contact("ada@example.test", primaryId, { isPrimary: true })], {
        options: [email],
      })
    );
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await mountFacts(mountContactMethods, {
      primaryContactMethods: [{
        href: "mailto:ada@example.test",
        id: primaryId,
        kind: "email",
        label: "Email",
        value: "ada@example.test",
      }],
    });
    act(() =>
      section().getByRole("button", { name: "Copy ada@example.test" }).click()
    );
    await waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toContain(
        "Copy failed. Select the value and copy it manually.",
      )
    );
    expect(
      document.querySelector("#app-toasts > li")?.getAttribute("data-tone"),
    ).toBe("error");
  });

  it.each([["no", undefined], ["an empty", []]] as const)(
    "shows every method as saved when the profile names %s primary summary",
    async (_name, primaryContactMethods) => {
      shell(railBlock("contact-methods"));
      stubFetch(() =>
        factRead([
          contact("ada@example.test", "00000000-0000-4000-8000-000000000307"),
          contact("other@example.test", "00000000-0000-4000-8000-000000000308"),
        ], { options: [email] })
      );
      await mountFacts(
        mountContactMethods,
        primaryContactMethods ? { primaryContactMethods } : {},
      );
      expect(rows().every((row) => !row.hidden)).toBe(true);
      expect(section().queryByRole("link")).toBeNull();
      expect(section().queryByRole("button", { name: /^Copy / })).toBeNull();
      expect(
        section().queryByRole("button", { name: /more contact methods/ }),
      ).toBeNull();
    },
  );

  it("saves and refreshes only its own section and the primary summary", async () => {
    shell(railBlock("contact-methods"));
    const record = contact(
      "ada@example.test",
      "00000000-0000-4000-8000-000000000300",
      { isPrimary: true, labelIds: [labelId] },
    );
    let saved = false;
    const fetch = stubFetch((url, init) => {
      if (url.pathname === `/api/v1/people/${personId}`) {
        return response({
          dueInformation: {},
          person: {},
          status: "ready",
          summary: {
            primaryContactMethods: [{
              href: "mailto:ada@example.test",
              id: record.id,
              kind: "email",
              label: "Email",
              value: "ada@example.test",
            }],
            relationshipCounts: [],
            sectionCounts: [],
          },
        });
      }
      if (init?.method === "POST") {
        saved = true;
        return response({
          personUpdatedAt: nextRevision,
          record,
          status: "saved",
        });
      }
      return factRead(saved ? [record] : [], {
        options: url.searchParams.has("includeOptions") || saved
          ? [email, { id: labelId, kind: "contact-label", name: "Home" }]
          : [],
      });
    });
    await mountFacts(mountContactMethods);
    expect(summary.railEmpty("contact-methods")).toBe(true);
    expect(summary.railCount("contact-methods")).toBe("0");
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add contact methods" }),
    );
    const type = section().getByLabelText("Contact type");
    await waitFor(() => expect(document.activeElement).toBe(type));
    expect(
      (section().getByLabelText("Contact value") as HTMLInputElement).maxLength,
    ).toBe(2000);
    await user.selectOptions(type, typeId);
    await user.type(
      section().getByLabelText("Contact value"),
      "ada@example.test",
    );
    await user.selectOptions(section().getByLabelText("Contact labels"), [
      labelId,
    ]);
    await user.click(section().getByLabelText("Primary for this contact type"));
    await user.type(section().getByLabelText("Contact notes"), "Preferred");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe("Profile fact saved.")
    );
    expect(fetch.bodies()).toEqual([{
      expectedPersonUpdatedAt: revision,
      isPrimary: true,
      labelIds: [labelId],
      notes: "Preferred",
      section: "contact-methods",
      typeId,
      value: "ada@example.test",
    }]);
    expect(fetch.calls()).toEqual([
      `GET /api/v1/people/${personId}/facts/contact-methods`,
      `GET /api/v1/people/${personId}/facts/contact-methods?includeOptions=true`,
      `POST /api/v1/people/${personId}/facts/contact-methods`,
      `GET /api/v1/people/${personId}/facts/contact-methods`,
      `GET /api/v1/people/${personId}?include=summary`,
    ]);
    await waitFor(() =>
      expect(
        section().getByRole("link", { name: "ada@example.test" }).getAttribute(
          "href",
        ),
      ).toBe("mailto:ada@example.test")
    );
    expect(summary.railCount("contact-methods")).toBe("1");
    expect(summary.railEmpty("contact-methods")).toBe(false);
  });

  it("names what a new method is missing, and refuses more than 20 labels", async () => {
    shell(railBlock("contact-methods"));
    const labels = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8100-${String(index + 1).padStart(12, "0")}`,
      kind: "contact-label",
      name: `Label ${index + 1}`,
    }));
    const fetch = stubFetch(() =>
      factRead([], { options: [email, ...labels] })
    );
    await mountFacts(mountContactMethods);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add contact methods" }),
    );
    const save = section().getByRole("button", { name: "Save profile fact" });
    await user.click(save);
    const errors = () =>
      [
        ...block("contact-methods").querySelectorAll(
          "[data-profile-fact-field-error]",
        ),
      ].map((error) => error.textContent);
    await waitFor(() =>
      expect(errors()).toEqual([
        "Choose a contact type.",
        "Enter a contact value.",
      ])
    );
    await user.selectOptions(section().getByLabelText(/^Contact type/), typeId);
    await user.type(section().getByLabelText(/^Contact value/), "x");
    // All at once, as a browser's own picker (and Playwright) chooses them.
    const choice = section().getByLabelText<HTMLSelectElement>(
      "Contact labels",
    );
    for (const option of choice.options) option.selected = true;
    fireEvent.change(choice);
    expect(choice.selectedOptions).toHaveLength(21);
    await user.click(save);
    await waitFor(() =>
      expect(errors()).toEqual(["Choose no more than 20 labels."])
    );
    expect(fetch.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("loads one bounded vocabulary page only when the editor opens", async () => {
    shell(railBlock("contact-methods"));
    const firstOptions = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      kind: "contact-type",
      name: `Type ${String(index + 1).padStart(2, "0")}`,
    }));
    const fetch = stubFetch((url) =>
      factRead([], {
        options: !url.searchParams.has("includeOptions")
          ? []
          : url.searchParams.has("optionCursor")
          ? [{
            id: typeId,
            kind: "contact-type",
            name: "Selected continuation type",
          }]
          : firstOptions,
        ...(url.searchParams.has("optionCursor")
          ? {}
          : { nextOptionsCursor: "next-options" }),
      })
    );
    await mountFacts(mountContactMethods);
    expect(fetch.mock).toHaveBeenCalledTimes(1);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add contact methods" }),
    );
    await waitFor(() => expect(fetch.mock).toHaveBeenCalledTimes(2));
    expect(fetch.calls()[1]).toContain("includeOptions=true");
    const more = await waitFor(() =>
      section().getByRole("button", { name: "Load more contact options" })
    );
    await user.click(more);
    await waitFor(() => expect(fetch.mock).toHaveBeenCalledTimes(3));
    expect(fetch.calls()[2]).toContain("optionCursor=next-options");
    await waitFor(() =>
      expect(
        within(section().getByLabelText("Contact type")).getByRole("option", {
          name: "Selected continuation type",
        }),
      ).toBeTruthy()
    );
    expect(
      section().queryByRole("button", { name: "Load more contact options" }),
    ).toBeNull();
    await user.type(
      section().getByLabelText("Search contact options"),
      "Type 0",
    );
    await user.click(
      section().getByRole("button", { name: "Search contact options" }),
    );
    await waitFor(() =>
      expect(fetch.calls()[3]).toBe(
        `GET /api/v1/people/${personId}/facts/contact-methods?includeOptions=true&optionSearch=Type+0`,
      )
    );
  });

  it("blocks saving while the vocabulary cannot be searched", async () => {
    shell(railBlock("contact-methods"));
    const fetch = stubFetch((url) =>
      url.searchParams.has("optionSearch")
        ? response({ status: 503, title: "Unavailable" }, 503)
        : factRead([], { options: [email] })
    );
    await mountFacts(mountContactMethods);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", { name: "Add contact methods" }),
    );
    await user.type(section().getByLabelText("Search contact options"), "e");
    await user.click(
      section().getByRole("button", { name: "Search contact options" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Profile options are temporarily unavailable. No changes were saved.",
      )
    );
    const save = section().getByRole<HTMLButtonElement>("button", {
      name: "Save profile fact",
    });
    expect(save.disabled).toBe(true);
    block("contact-methods").querySelector("form")!.requestSubmit();
    await waitFor(() =>
      expect(
        block("contact-methods").querySelector(
          "[data-profile-fact-form-state]",
        )?.textContent,
      ).toBe("Options are unavailable. No changes were saved.")
    );
    expect(fetch.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("APR-006 pages bounded facts and edits a record on a later page with its own options", async () => {
    shell(railBlock("contact-methods"));
    const continuationTypeId = "00000000-0000-4000-8000-000000000299";
    const records = Array.from({ length: 51 }, (_, index) =>
      contact(
        `person-${index}@example.test`,
        `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
        { typeId: index === 50 ? continuationTypeId : typeId },
      )).map((record, index) => ({
        ...record,
        referencesResolved: true,
        selectedOptions: [{
          id: index === 50 ? continuationTypeId : typeId,
          kind: "contact-type",
          name: index === 50 ? "Continuation type" : "Email",
        }],
      }));
    const fetch = stubFetch((url, init) => {
      if (init?.method === "PUT") {
        return response({
          personUpdatedAt: nextRevision,
          record: records[50],
          status: "saved",
        });
      }
      const later = url.searchParams.has("cursor");
      return factRead(later ? records.slice(50) : records.slice(0, 50), {
        options: [email],
        ...(later ? {} : { nextCursor: "next-facts" }),
      });
    });
    await mountFacts(mountContactMethods);
    expect(rows()).toHaveLength(50);
    expect(stateLine().textContent).toBe("Showing 50 on this page.");
    expect(summary.railCount("contact-methods")).toBe("50 on this page");
    const user = userEvent.setup();
    const next = section().getByRole("button", {
      name: "Next contact methods",
    });
    expect(next.className).toBe(buttonVariants({ variant: "outline" }));
    await user.click(next);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(stateLine().textContent).toBe("Showing 1 on this page.");
    expect(summary.railCount("contact-methods")).toBe("1 on this page");
    await user.click(
      section().getByRole("button", { name: "Previous contact methods" }),
    );
    await waitFor(() => expect(rows()).toHaveLength(50));
    await user.click(
      section().getByRole("button", { name: "Next contact methods" }),
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(
      section().getByRole("button", {
        name: "Edit Continuation type: person-50@example.test",
      }),
    );
    await waitFor(() =>
      expect(
        (section().getByLabelText("Contact type") as HTMLSelectElement).value,
      ).toBe(continuationTypeId)
    );
    const value = section().getByLabelText("Contact value");
    await user.clear(value);
    await user.type(value, "updated@example.test");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(fetch.bodies()[0]?.typeId).toBe(continuationTypeId)
    );
  });

  it("fails an unresolved vocabulary-backed record editor closed", async () => {
    shell(railBlock("contact-methods"));
    const fetch = stubFetch(() =>
      factRead([{
        ...contact("unresolved@example.test", personId, {
          labelIds: ["00000000-0000-4000-8000-000000000298"],
          typeId: "00000000-0000-4000-8000-000000000299",
        }),
        referencesResolved: false,
        selectedOptions: [],
      }])
    );
    await mountFacts(mountContactMethods);
    await userEvent.setup().click(
      section().getByRole("button", { name: /^Edit Contact:/ }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Current profile references could not be verified. No changes were saved.",
      )
    );
    expect(document.activeElement).toBe(stateLine());
    expect(block("contact-methods").querySelector("form")!.hidden).toBe(true);
    expect(fetch.mock).toHaveBeenCalledTimes(1);
  });
});
