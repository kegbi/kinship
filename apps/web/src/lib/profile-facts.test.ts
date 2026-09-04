// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountProfileFacts } from "./profile-facts.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const workspaceId = "00000000-0000-4000-8000-000000000003";
const typeId = "00000000-0000-4000-8000-000000000200";
const revision = "2026-08-16T12:00:00.000000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function markup(): void {
  document.body.innerHTML = `
    <ul id="app-toasts"></ul>
    <section data-profile-section="contact-methods" data-profile-fact-section="contact-methods" data-section-state="loading">
      <span data-profile-fact-badge>Loading</span>
      <span data-profile-rail-count hidden></span>
      <p data-profile-fact-state tabindex="-1"></p>
      <ul data-profile-fact-list></ul>
      <button data-profile-fact-add data-profile-fact-add-icon aria-label="Add contact methods" hidden><span aria-hidden="true">+</span></button>
      <form data-profile-fact-form hidden></form>
    </section>`;
}

function allMarkup(): void {
  document.body.innerHTML = `
    <ul id="person-profile-tags"></ul>
    <span data-person-vital-value="work">Not recorded</span>
    <span data-person-vital-value="first-meeting">Not recorded</span>
    ${
    [
      "contact-methods",
      "addresses",
      "first-meeting",
      "work",
      "food-preferences",
      "pets",
    ].map((section) => `
      <section data-profile-section="${section}" data-profile-fact-section="${section}" data-section-state="loading">
        <span data-profile-fact-badge>Loading</span><span data-profile-rail-count hidden></span><p data-profile-fact-state tabindex="-1"></p>
        <ul data-profile-fact-list></ul><button data-profile-fact-add data-profile-fact-add-icon aria-label="Add ${section}" hidden><span aria-hidden="true">+</span></button>
        <form data-profile-fact-form hidden></form>
      </section>`).join("")
  }
    <div data-profile-fact-section="tags" data-section-state="loading">
      <p data-profile-fact-state tabindex="-1"></p><button data-profile-fact-add hidden>Edit tags</button>
      <form data-profile-fact-form hidden></form>
    </div>`;
}

type ClampedProfileFactSection = "first-meeting" | "food-preferences";

async function renderMeasuredSummary(
  section: ClampedProfileFactSection,
  overflows: boolean,
): Promise<{ description: HTMLParagraphElement; text: string }> {
  document.body.innerHTML = `
    <section data-profile-fact-section="${section}"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></section>`;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback) => frames.push(callback),
  );
  const value = section === "food-preferences"
    ? {
      foodPreferences:
        "Tea; no shellfish; vegetarian meals preferred when sharing dinner",
    }
    : {
      notes: "Introduced while discussing mathematics and analytical engines",
      placeText: "London salon",
    };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(response({
      options: [],
      personUpdatedAt: revision,
      records: [{
        id: personId,
        section,
        updatedAt: revision,
        value,
      }],
      status: "ready",
    })),
  );

  await mountProfileFacts(personId, workspaceId, false, revision);
  const description = document.querySelector<HTMLParagraphElement>(
    "[data-profile-fact-list] p",
  )!;
  const text = description.textContent ?? "";
  Object.defineProperties(description, {
    clientHeight: { configurable: true, value: 32 },
    scrollHeight: { configurable: true, value: overflows ? 64 : 32 },
  });
  for (const frame of frames) frame(0);
  return { description, text };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("PEOPLE-006 profile-fact sections", () => {
  it("PRF-001 exposes saved work, pet, contact, address, and introducer details in their blocks", async () => {
    allMarkup();
    const labelId = "00000000-0000-4000-8000-000000000299";
    const records = [
      {
        section: "work",
        value: {
          title: "Mathematician",
          organizationName: "Analytical Engines",
          startOn: "1833-06-05",
          endOn: "1852-11-27",
          isCurrent: false,
          description: "Translated and expanded the engine notes.",
        },
      },
      {
        section: "pets",
        value: { name: "Byron", notes: "A shy cat; let him approach first." },
      },
      {
        section: "contact-methods",
        value: {
          typeId,
          value: "ada@example.test",
          labelIds: [labelId],
          isPrimary: true,
          notes: "Best for arranging a visit.",
        },
      },
      {
        section: "addresses",
        value: { city: "London", labelIds: [labelId], isPrimary: false },
      },
      {
        section: "first-meeting",
        value: {
          introducedByPersonId: typeId,
          placeText: "London salon",
          notes: "Discussed the difference engine.",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request) => {
        const section = /\/facts\/([^?]+)/.exec(String(resource))?.[1];
        return response({
          options: [{ id: typeId, kind: "contact-type", name: "Email" }, {
            id: labelId,
            kind: "contact-label",
            name: "Personal",
          }],
          records: records.filter((record) => record.section === section).map((
            record,
          ) => ({ ...record, id: personId, updatedAt: revision })),
          personUpdatedAt: revision,
          status: "ready",
        });
      }),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    const details = (section: string) =>
      Object.fromEntries(
        [...document.querySelectorAll(
          `[data-profile-fact-section="${section}"] .profile-fact-details > div`,
        )].map((
          row,
        ) => [
          row.querySelector("dt")?.textContent,
          row.querySelector("dd")?.textContent,
        ]),
      );
    expect(details("work")).toEqual({
      Started: "Jun 5, 1833",
      Ended: "Nov 27, 1852",
      "Current role": "No",
      Details: "Translated and expanded the engine notes.",
    });
    expect(details("pets")).toEqual({
      Notes: "A shy cat; let him approach first.",
    });
    expect(details("contact-methods")).toEqual({
      Labels: "Personal",
      Primary: "Yes",
      Notes: "Best for arranging a visit.",
    });
    expect(details("addresses")).toEqual({ Labels: "Personal", Primary: "No" });
    const introducer = document.querySelector<HTMLAnchorElement>(
      '[data-profile-fact-section="first-meeting"] .profile-fact-details a',
    );
    expect(introducer?.getAttribute("href")).toBe(`/app/people/${typeId}`);
    expect(details("first-meeting")).toEqual({
      "Introduced by": "View person",
    });
  });

  it("PRF-001 separates contact labels and values from compact local actions", async () => {
    markup();
    const value = "ada.lovelace.correspondence@analytical-engines.example.test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        options: [{ id: typeId, kind: "contact-type", name: "Personal email" }],
        personUpdatedAt: revision,
        records: [{
          id: personId,
          section: "contact-methods",
          updatedAt: revision,
          value: { isPrimary: true, labelIds: [], typeId, value },
        }],
        status: "ready",
      })),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    const item = document.querySelector("[data-profile-fact-list] > li")!;
    expect(item.querySelector(".profile-fact-label")?.textContent).toBe(
      "Personal email: ",
    );
    expect(item.querySelector(".profile-fact-value")?.textContent).toBe(value);
    const actions = item.querySelector(".profile-fact-actions")!;
    expect(actions).not.toBeNull();
    const edit = actions.querySelector<HTMLButtonElement>(".button-secondary")!;
    const remove = actions.querySelector<HTMLButtonElement>(".button-danger")!;
    expect(edit.firstChild?.textContent).toBe("Edit");
    expect(edit.querySelector(".sr-only")?.textContent).toBe(
      ` Personal email: ${value}`,
    );
    expect(remove.firstChild?.textContent).toBe("Delete");
    remove.click();
    expect(remove.firstChild?.textContent).toBe("Confirm delete");
    expect(remove.querySelector(".sr-only")?.textContent).toBe(
      ` Personal email: ${value}`,
    );
  });

  it("expands an overflowing food-preferences summary in place", async () => {
    const { description, text } = await renderMeasuredSummary(
      "food-preferences",
      true,
    );
    const control = document.querySelector<HTMLButtonElement>(
      "button.profile-rail-summary-control",
    )!;

    expect(control.firstChild?.textContent).toBe("More");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    control.click();
    expect(description.textContent).toBe(text);
    expect(description.dataset.expanded).toBe("true");
    expect(control.firstChild?.textContent).toBe("Less");
    expect(control.getAttribute("aria-expanded")).toBe("true");
  });

  it("does not render a control for a food-preferences summary without overflow", async () => {
    await renderMeasuredSummary("food-preferences", false);

    expect(
      document.querySelector("button.profile-rail-summary-control"),
    ).toBeNull();
  });

  it("keeps the visible food-preferences label in the accessible name", async () => {
    await renderMeasuredSummary("food-preferences", true);
    const control = document.querySelector<HTMLButtonElement>(
      "button.profile-rail-summary-control",
    )!;

    expect(control.hasAttribute("aria-label")).toBe(false);
    expect(control.firstChild?.textContent).toBe("More");
    expect(control.textContent).toContain(control.firstChild?.textContent);
    expect(control.querySelector(".sr-only")?.textContent).toBe(
      " food preferences",
    );
  });

  it("uses a distinct suffix for an overflowing first-meeting summary", async () => {
    await renderMeasuredSummary("first-meeting", true);
    const control = document.querySelector<HTMLButtonElement>(
      "button.profile-rail-summary-control",
    )!;

    expect(control.firstChild?.textContent).toBe("More");
    expect(control.querySelector(".sr-only")?.textContent).toBe(
      " first meeting",
    );
    expect(control.textContent).toBe("More first meeting");
  });

  it("renders primary contact links and copy controls while expanding every other record", async () => {
    markup();
    const primaryId = "00000000-0000-4000-8000-000000000301";
    const phoneId = "00000000-0000-4000-8000-000000000302";
    const secondaryId = "00000000-0000-4000-8000-000000000306";
    const phoneTypeId = "00000000-0000-4000-8000-000000000201";
    const records = [
      {
        id: primaryId,
        section: "contact-methods",
        updatedAt: revision,
        value: {
          isPrimary: true,
          labelIds: [],
          typeId,
          value: "ada@example.test",
        },
      },
      {
        id: phoneId,
        section: "contact-methods",
        updatedAt: revision,
        value: {
          isPrimary: true,
          labelIds: [],
          typeId: phoneTypeId,
          value: "+44 20 7946 0958",
        },
      },
      {
        id: secondaryId,
        section: "contact-methods",
        updatedAt: revision,
        value: {
          isPrimary: false,
          labelIds: [],
          typeId,
          value: "other@example.test",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        options: [
          { id: typeId, kind: "contact-type", name: "Email" },
          { id: phoneTypeId, kind: "contact-type", name: "Phone" },
        ],
        personUpdatedAt: revision,
        records,
        status: "ready",
      })),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await mountProfileFacts(personId, workspaceId, false, revision, [{
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
    }]);

    const primary = document.querySelector<HTMLAnchorElement>(
      `[data-profile-fact-list] a[href="mailto:ada@example.test"]`,
    );
    expect(primary?.textContent).toBe("ada@example.test");
    const copy = document.querySelector<HTMLButtonElement>(
      '[aria-label="Copy ada@example.test"]',
    )!;
    copy.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toContain(
        "Copied ada@example.test",
      )
    );
    expect(writeText).toHaveBeenCalledWith("ada@example.test");
    document.querySelector<HTMLButtonElement>(".app-toast-dismiss")?.click();

    const phone = [...document.querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    )].find((item) => item.textContent?.includes("+44 20 7946 0958"))!;
    expect(phone.hidden).toBe(false);
    expect(phone.querySelector("a")).toBeNull();
    expect(
      phone.querySelector('[aria-label="Copy +44 20 7946 0958"]'),
    ).not.toBeNull();

    const secondary = [...document.querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    )].find((item) => item.textContent?.includes("other@example.test"))!;
    expect(secondary.hidden).toBe(true);
    const edit = [...secondary.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.startsWith("Edit"))!;
    expect(edit).not.toBeUndefined();
    const expander = document.querySelector<HTMLButtonElement>(
      "[data-profile-fact-expander]",
    )!;
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.firstChild?.textContent).toBe("+ 1 more");
    expect(expander.querySelector(".sr-only")?.textContent).toBe(
      " contact methods",
    );
    expect(expander.textContent).toBe("+ 1 more contact methods");
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expander.click();
    expect(secondary.hidden).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.firstChild?.textContent).toBe("Show fewer");
    expect(expander.textContent).toBe("Show fewer contact methods");
  });

  it("keeps the current contact rendering when no summary was supplied", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        options: [{ id: typeId, kind: "contact-type", name: "Email" }],
        personUpdatedAt: revision,
        records: [
          {
            id: "00000000-0000-4000-8000-000000000303",
            section: "contact-methods",
            updatedAt: revision,
            value: {
              isPrimary: true,
              labelIds: [],
              typeId,
              value: "ada@example.test",
            },
          },
          {
            id: "00000000-0000-4000-8000-000000000304",
            section: "contact-methods",
            updatedAt: revision,
            value: {
              isPrimary: false,
              labelIds: [],
              typeId,
              value: "other@example.test",
            },
          },
        ],
        status: "ready",
      })),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    expect(
      [...document.querySelectorAll<HTMLLIElement>(
        "[data-profile-fact-list] > li",
      )].every((item) => !item.hidden),
    ).toBe(true);
    expect(document.querySelector("[data-profile-fact-list] a")).toBeNull();
    expect(document.querySelector('[aria-label^="Copy "]')).toBeNull();
    expect(document.querySelector('[aria-label*="more contact methods"]'))
      .toBeNull();
  });

  it("renders the first address over three lines and expands the rest", async () => {
    allMarkup();
    const addressRecords = [
      {
        id: "00000000-0000-4000-8000-000000000401",
        section: "addresses",
        updatedAt: revision,
        value: {
          city: "London",
          country: "United Kingdom",
          displayName: "Home",
          isPrimary: true,
          labelIds: [],
          postalCode: "SW1A 1AA",
          region: "Greater London",
          street: "1 Analytical Engine Way",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000402",
        section: "addresses",
        updatedAt: revision,
        value: {
          city: "Paris",
          country: "France",
          displayName: "Office",
          isPrimary: false,
          labelIds: [],
          street: "2 Rue de Calcul",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request) => {
        const section = /\/facts\/([^?]+)/.exec(String(resource))?.[1];
        return response({
          options: [],
          personUpdatedAt: revision,
          records: section === "addresses" ? addressRecords : [],
          status: "ready",
        });
      }),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    const root = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="addresses"]',
    )!;
    const items = root.querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    );
    expect(
      [...items[0]!.querySelectorAll(".profile-address-summary > span")].map(
        (line) => line.textContent,
      ),
    ).toEqual([
      "Home",
      "1 Analytical Engine Way",
      "London, Greater London, SW1A 1AA, United Kingdom",
    ]);
    expect(items[0]!.hidden).toBe(false);
    expect(items[1]!.hidden).toBe(true);
    const expander = root.querySelector<HTMLButtonElement>(
      "[data-profile-fact-expander]",
    )!;
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.firstChild?.textContent).toBe("+ 1 more");
    expect(expander.textContent).toContain(expander.firstChild?.textContent);
  });

  it("shows the deterministic current work role behind a history expander", async () => {
    allMarkup();
    const workRecords = [
      {
        id: "00000000-0000-4000-8000-000000000412",
        section: "work",
        updatedAt: revision,
        value: {
          isCurrent: true,
          organizationName: "Difference Engines",
          startOn: "2024-01-01",
          title: "Director",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000411",
        section: "work",
        updatedAt: revision,
        value: {
          isCurrent: false,
          organizationName: "Analytical Engines",
          startOn: "2024-01-01",
          title: "Mathematician",
        },
      },
      {
        id: "00000000-0000-4000-8000-000000000413",
        section: "work",
        updatedAt: revision,
        value: {
          endOn: "2026-08-01",
          isCurrent: false,
          organizationName: "Royal Society",
          startOn: "2025-01-01",
          title: "Fellow",
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request) => {
        const section = /\/facts\/([^?]+)/.exec(String(resource))?.[1];
        return response({
          options: [],
          personUpdatedAt: revision,
          records: section === "work" ? workRecords : [],
          status: "ready",
        });
      }),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    let root = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="work"]',
    )!;
    let items = [...root.querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    )];
    expect(items.find((item) => !item.hidden)?.textContent).toContain(
      "Mathematician at Analytical Engines",
    );
    expect(items.filter((item) => item.hidden)).toHaveLength(2);
    const expander = root.querySelector<HTMLButtonElement>(
      "[data-profile-fact-expander]",
    )!;
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.firstChild?.textContent).toBe("Show history");
    expect(expander.textContent).toContain(expander.firstChild?.textContent);

    allMarkup();
    const endedRecords = workRecords.map((record, index) => ({
      ...record,
      id: `00000000-0000-4000-8000-00000000042${2 - index}`,
      value: {
        ...record.value,
        endOn: index === 0
          ? "2026-08-30"
          : index === 1
          ? "2026-08-29"
          : "2025-01-01",
      },
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request) => {
        const section = /\/facts\/([^?]+)/.exec(String(resource))?.[1];
        return response({
          options: [],
          personUpdatedAt: revision,
          records: section === "work" ? endedRecords : [],
          status: "ready",
        });
      }),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    root = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="work"]',
    )!;
    items = [...root.querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    )];
    expect(items.find((item) => !item.hidden)?.textContent).toContain(
      "Director at Difference Engines",
    );
  });

  it("renders every contact unchanged when the primary summary is empty", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        options: [{ id: typeId, kind: "contact-type", name: "Email" }],
        personUpdatedAt: revision,
        records: [
          {
            id: "00000000-0000-4000-8000-000000000307",
            section: "contact-methods",
            updatedAt: revision,
            value: {
              isPrimary: false,
              labelIds: [],
              typeId,
              value: "ada@example.test",
            },
          },
          {
            id: "00000000-0000-4000-8000-000000000308",
            section: "contact-methods",
            updatedAt: revision,
            value: {
              isPrimary: false,
              labelIds: [],
              typeId,
              value: "other@example.test",
            },
          },
        ],
        status: "ready",
      })),
    );

    await mountProfileFacts(personId, workspaceId, false, revision, []);

    expect(
      [...document.querySelectorAll<HTMLLIElement>(
        "[data-profile-fact-list] > li",
      )].every((item) => !item.hidden),
    ).toBe(true);
    expect(document.querySelector("[data-profile-fact-list] a")).toBeNull();
    expect(document.querySelector('[aria-label^="Copy "]')).toBeNull();
    expect(document.querySelector("[data-profile-fact-expander]")).toBeNull();
  });

  it("reports a rejected contact copy through the toast region", async () => {
    markup();
    const primaryId = "00000000-0000-4000-8000-000000000305";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        options: [{ id: typeId, kind: "contact-type", name: "Email" }],
        personUpdatedAt: revision,
        records: [{
          id: primaryId,
          section: "contact-methods",
          updatedAt: revision,
          value: {
            isPrimary: true,
            labelIds: [],
            typeId,
            value: "ada@example.test",
          },
        }],
        status: "ready",
      })),
    );
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    await mountProfileFacts(personId, workspaceId, false, revision, [{
      href: "mailto:ada@example.test",
      id: primaryId,
      kind: "email",
      label: "Email",
      value: "ada@example.test",
    }]);
    document.querySelector<HTMLButtonElement>(
      '[aria-label="Copy ada@example.test"]',
    )!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toContain(
        "Copy failed. Select the value and copy it manually.",
      )
    );
    expect(
      document.querySelector("#app-toasts > li")?.getAttribute("data-tone"),
    ).toBe("error");
    document.querySelector<HTMLButtonElement>(".app-toast-dismiss")?.click();
  });

  it("UXD-002B publishes rail state, icon labels, and live hero facts", async () => {
    allMarkup();
    let workPresent = true;
    const workRecord = {
      id: "00000000-0000-4000-8000-000000000701",
      section: "work",
      updatedAt: revision,
      value: {
        organizationName: "Analytical Engines",
        title: "Mathematician",
      },
    };
    const firstMeetingRecord = {
      id: "00000000-0000-4000-8000-000000000702",
      section: "first-meeting",
      updatedAt: revision,
      value: { placeText: "Royal Society" },
    };
    const foodRecord = {
      id: "00000000-0000-4000-8000-000000000703",
      section: "food-preferences",
      updatedAt: revision,
      value: { foodPreferences: "Tea" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request, init?: RequestInit) => {
        const section = /\/facts\/([^?]+)/.exec(String(resource))?.[1];
        if (init?.method === "DELETE") {
          workPresent = false;
          return response({
            factId: workRecord.id,
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            status: "deleted",
          });
        }
        const records = section === "work" && workPresent
          ? [workRecord]
          : section === "first-meeting"
          ? [firstMeetingRecord]
          : section === "food-preferences"
          ? [foodRecord]
          : [];
        return response({
          options: [],
          personUpdatedAt: revision,
          records,
          status: "ready",
        });
      }),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);

    const contact = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="contact-methods"]',
    )!;
    expect(contact.dataset.railEmpty).toBe("true");
    expect(contact.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("0");
    expect(contact.querySelector("[data-profile-fact-state]")?.textContent)
      .toBe("No contact methods saved.");
    const contactAdd = contact.querySelector<HTMLButtonElement>(
      "[data-profile-fact-add]",
    )!;
    expect(contactAdd.textContent).toBe("+");
    expect(contactAdd.getAttribute("aria-label")).toBe("Add contact methods");
    const firstMeetingAdd = document.querySelector<HTMLButtonElement>(
      '[data-profile-fact-section="first-meeting"] [data-profile-fact-add]',
    )!;
    expect(firstMeetingAdd.textContent).toBe("+");
    expect(firstMeetingAdd.getAttribute("aria-label")).toBe(
      "Edit first meeting",
    );
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-profile-fact-section="food-preferences"] [data-profile-fact-add]',
      )?.getAttribute("aria-label"),
    ).toBe("Edit food preferences");
    expect(
      document.querySelector('[data-person-vital-value="work"]')?.textContent,
    ).toBe("Mathematician at Analytical Engines");
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("Royal Society");

    const work = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="work"]',
    )!;
    const remove = [...work.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.startsWith("Delete"))!;
    remove.click();
    remove.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-vital-value="work"]')
          ?.textContent,
      ).toBe("Not recorded")
    );
    expect(work.querySelector("[data-profile-rail-count]")?.textContent).toBe(
      "0",
    );
    expect(work.dataset.railEmpty).toBe("true");
  });

  it("closes an open profile-fact editor without stealing focus when another opens", async () => {
    allMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        response({
          options: [],
          personUpdatedAt: revision,
          records: [],
          status: "ready",
        })
      ),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);

    const food = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="food-preferences"]',
    )!;
    const foodAdd = food.querySelector<HTMLButtonElement>(
      "[data-profile-fact-add]",
    )!;
    const foodForm = food.querySelector<HTMLFormElement>(
      "[data-profile-fact-form]",
    )!;
    foodAdd.click();
    await vi.waitFor(() => expect(foodForm.hidden).toBe(false));
    const foodDraft = foodForm.elements.namedItem(
      "foodPreferences",
    ) as HTMLTextAreaElement;
    foodDraft.value = "Unsaved draft";
    const reset = vi.fn();
    foodForm.addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(foodAdd, "focus");

    const addresses = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="addresses"]',
    )!;
    const addressForm = addresses.querySelector<HTMLFormElement>(
      "[data-profile-fact-form]",
    )!;
    addresses.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() => expect(addressForm.hidden).toBe(false));

    expect(foodForm.hidden).toBe(true);
    expect(foodDraft.value).toBe("");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      addressForm.querySelector("input, select, textarea"),
    );
  });

  it("selects an existing workspace organization from the local work editor", async () => {
    document.body.innerHTML = `
      <section data-profile-fact-section="work">
        <p data-profile-fact-state></p><ul data-profile-fact-list></ul>
        <button data-profile-fact-add>Add work</button>
        <form data-profile-fact-form></form>
      </section>`;
    const organizationId = "00000000-0000-4000-8000-000000000777";
    const savedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        void resource;
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          savedBodies.push(body);
          return response({
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            record: {
              id: "00000000-0000-4000-8000-000000000778",
              section: "work",
              updatedAt: "2026-08-16T12:00:00.000001Z",
              value: body,
            },
            status: "saved",
          });
        }
        return response({
          options: [{
            id: organizationId,
            kind: "organization",
            name: "Analytical Engines",
          }],
          personUpdatedAt: revision,
          records: [],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileFacts(personId, workspaceId, false, revision);
    const organization = document.querySelector<HTMLSelectElement>(
      '[name="organizationId"]',
    );
    expect(organization).not.toBeNull();
    organization!.value = organizationId;
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() => {
      expect(organization?.options).toHaveLength(2);
      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false);
    });
    const newOrganization = document.querySelector<HTMLInputElement>(
      '[name="organizationName"]',
    )!;
    organization!.value = organizationId;
    newOrganization.value = "Difference Engines";
    newOrganization.dispatchEvent(new Event("input"));
    expect(organization!.value).toBe("");
    newOrganization.value = "Difference Engines";
    organization!.value = organizationId;
    organization!.dispatchEvent(new Event("change"));
    expect(newOrganization.value).toBe("");
    (document.querySelector('[name="title"]') as HTMLInputElement).value =
      "Mathematician";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();

    await vi.waitFor(() => expect(savedBodies).toHaveLength(1));
    expect(savedBodies[0]).toMatchObject({
      organizationId,
      section: "work",
      title: "Mathematician",
    });
    expect(savedBodies[0]).not.toHaveProperty("organizationName");
  });

  it("propagates tag and food revisions to every mounted consumer", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>
      <section data-profile-fact-section="food-preferences"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></section>`;
    let current = revision;
    const bodies: Record<string, unknown>[] = [];
    const revisions: string[] = [];
    document.addEventListener("person-revision-changed", (event) => {
      revisions.push(
        (event as CustomEvent<{ personUpdatedAt: string }>).detail
          .personUpdatedAt,
      );
    });
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.includes("/tag-options")) {
          return response({ options: [], status: "ready" });
        }
        const section = url.includes("/facts/tags")
          ? "tags"
          : "food-preferences";
        if (["POST", "PUT"].includes(init?.method ?? "")) {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          bodies.push(body);
          current = current.endsWith("000000Z")
            ? "2026-08-16T12:00:00.000001Z"
            : "2026-08-16T12:00:00.000002Z";
          return response({
            personUpdatedAt: current,
            record: {
              id: personId,
              section,
              updatedAt: current,
              value: section === "tags"
                ? { tagIds: [] }
                : { foodPreferences: "Tea" },
            },
            status: "saved",
          });
        }
        return response({
          options: [],
          personUpdatedAt: current,
          records: [{
            id: personId,
            section,
            updatedAt: current,
            value: section === "tags"
              ? { tagIds: [] }
              : { foodPreferences: "Coffee" },
          }],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);

    document.querySelector<HTMLButtonElement>(
      '[data-profile-fact-section="tags"] [data-profile-fact-add]',
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-profile-fact-section="tags"] button[type="submit"]',
        )?.disabled,
      ).toBe(false)
    );
    document.querySelector<HTMLFormElement>(
      '[data-profile-fact-section="tags"] form',
    )!.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(revisions).toHaveLength(1));

    document.querySelector<HTMLButtonElement>(
      '[data-profile-fact-section="food-preferences"] [data-profile-fact-add]',
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLFormElement>(
          '[data-profile-fact-section="food-preferences"] form',
        )?.hidden,
      ).toBe(false)
    );
    const food = document.querySelector<HTMLTextAreaElement>(
      '[name="foodPreferences"]',
    )!;
    food.value = "Tea";
    food.form!.dispatchEvent(
      new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );
    await vi.waitFor(() => expect(revisions).toHaveLength(2));

    expect(bodies[0]?.expectedPersonUpdatedAt).toBe(revision);
    expect(bodies[1]?.expectedPersonUpdatedAt).toBe(
      "2026-08-16T12:00:00.000001Z",
    );
    expect(bodies[1]?.expectedUpdatedAt).toBe(
      "2026-08-16T12:00:00.000001Z",
    );
  });

  it("does not let an older delayed section response regress the shared revision", async () => {
    document.body.innerHTML = `
      <section data-profile-fact-section="contact-methods"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></section>
      <ul id="person-profile-tags"></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    const nextRevision = "2026-08-16T12:00:00.000001Z";
    let releaseContact!: (value: Response) => void;
    const delayedContact = new Promise<Response>((resolve) => {
      releaseContact = resolve;
    });
    let tagSaved = false;
    const tagExpectedRevisions: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        const section = url.pathname.match(/\/facts\/([^/]+)/)?.[1];
        if (url.pathname.endsWith("/tag-options")) {
          return response({ options: [], status: "ready" });
        }
        if (section === "contact-methods") return delayedContact;
        if (["POST", "PUT"].includes(init?.method ?? "")) {
          const body = JSON.parse(String(init?.body)) as {
            expectedPersonUpdatedAt: string;
          };
          tagExpectedRevisions.push(body.expectedPersonUpdatedAt);
          tagSaved = true;
          return response({
            personUpdatedAt: nextRevision,
            record: {
              id: personId,
              section,
              updatedAt: nextRevision,
              value: { section: "tags", tagIds: [] },
            },
            status: "saved",
          });
        }
        return response({
          options: [],
          personUpdatedAt: tagSaved ? nextRevision : revision,
          records: [{
            id: personId,
            section,
            updatedAt: tagSaved ? nextRevision : revision,
            value: { section: "tags", tagIds: [] },
          }],
          status: "ready",
        });
      }),
    );

    const mounting = mountProfileFacts(
      personId,
      workspaceId,
      false,
      revision,
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-profile-fact-section="tags"]')
          ?.getAttribute("data-section-state"),
      ).toBe("ready")
    );
    document.querySelector<HTMLButtonElement>(
      '[data-profile-fact-section="tags"] [data-profile-fact-add]',
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>(
          '[data-profile-fact-section="tags"] button[type="submit"]',
        )?.disabled,
      ).toBe(false)
    );
    document.querySelector<HTMLFormElement>(
      '[data-profile-fact-section="tags"] form',
    )!.requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          '[data-profile-fact-section="tags"] [data-profile-fact-state]',
        )?.textContent,
      ).toBe("Profile fact saved.")
    );

    releaseContact(response({
      options: [],
      personUpdatedAt: revision,
      records: [],
      status: "ready",
    }));
    await mounting;
    document.querySelector<HTMLButtonElement>(
      '[data-profile-fact-section="tags"] [data-profile-fact-add]',
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLFormElement>(
          '[data-profile-fact-section="tags"] form',
        )?.hidden,
      ).toBe(false)
    );
    document.querySelector<HTMLFormElement>(
      '[data-profile-fact-section="tags"] form',
    )!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(tagExpectedRevisions).toEqual([revision, nextRevision])
    );
  });

  it("preserves more than one tag page and fails closed when option lookup fails", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    const ids = Array.from(
      { length: 75 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    let failOptions = false;
    let tagOptionCalls = 0;
    let writes = 0;
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (url.pathname.endsWith("/tag-options")) {
          tagOptionCalls++;
          if (failOptions) {
            return response({
              code: "tag_options_unavailable",
              detail: "Unavailable",
              status: 503,
              title: "Unavailable",
              type: "about:blank",
            }, 503);
          }
          const page = ids.slice(0, 20).map((id, index) => ({
            id,
            name: `Tag ${index + 1}`,
          }));
          return response({
            nextCursor: "next-tags",
            options: page,
            status: "ready",
          });
        }
        if (["POST", "PUT"].includes(init?.method ?? "")) writes++;
        return response({
          options: ids.map((id, index) => ({ id, name: `Tag ${index + 1}` })),
          personUpdatedAt: revision,
          records: [{
            id: personId,
            section: "tags",
            updatedAt: revision,
            value: { tagIds: ids },
          }],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    const assigned = document.querySelector<HTMLSelectElement>(
      '[name="tagIds"]',
    )!;
    await vi.waitFor(() =>
      expect(Array.from(assigned.selectedOptions)).toHaveLength(75)
    );
    expect(Array.from(assigned.options)).toHaveLength(75);
    expect(tagOptionCalls).toBe(1);

    failOptions = true;
    document.querySelector<HTMLButtonElement>("[data-tag-search]")!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(true)
    );
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(writes).toBe(0);
  });

  it("refreshes the visible tag preview from the production-shaped section response", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"><li>No tags saved</li></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    const tagId = "00000000-0000-4000-8000-000000000499";
    let saved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (resource: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(resource), "http://localhost");
          if (url.pathname.endsWith("/tag-options")) {
            return response({
              options: [{ id: tagId, name: "Friend" }],
              status: "ready",
            });
          }
          if (["POST", "PUT"].includes(init?.method ?? "")) {
            saved = true;
            return response({
              personUpdatedAt: "2026-08-16T12:00:00.000001Z",
              record: {
                id: personId,
                section: "tags",
                updatedAt: "2026-08-16T12:00:00.000001Z",
                value: { section: "tags", tagIds: [tagId] },
              },
              status: "saved",
            });
          }
          return response({
            options: saved ? [{ id: tagId, name: "Friend" }] : [],
            personUpdatedAt: saved ? "2026-08-16T12:00:00.000001Z" : revision,
            records: [{
              id: personId,
              section: "tags",
              updatedAt: revision,
              value: { section: "tags", tagIds: saved ? [tagId] : [] },
            }],
            status: "ready",
          });
        },
      ),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    const assigned = document.querySelector<HTMLSelectElement>(
      '[name="tagIds"]',
    )!;
    await vi.waitFor(() => expect(assigned.options.length).toBe(1));
    assigned.options[0]!.selected = true;
    assigned.form!.requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-tags")?.textContent)
        .toContain("Friend")
    );
  });

  it("purges ready tag DOM while hidden and reloads retained tags when restored", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    const tagId = "00000000-0000-4000-8000-000000000499";
    let status: "hidden" | "ready" = "ready";
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request) => {
        const url = new URL(String(resource), "http://localhost");
        if (url.pathname.endsWith("/tag-options")) {
          return response({
            options: [{ id: tagId, name: "Confidential friend" }],
            status: "ready",
          });
        }
        return response({
          options: status === "ready"
            ? [{ id: tagId, name: "Confidential friend" }]
            : [],
          personUpdatedAt: revision,
          records: status === "ready"
            ? [{
              id: personId,
              section: "tags",
              updatedAt: revision,
              value: { section: "tags", tagIds: [tagId] },
            }]
            : [],
          status,
        });
      }),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Confidential friend")
    );

    status = "hidden";
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    );
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>("[data-profile-fact-section]")
          ?.dataset.sectionState,
      ).toBe("hidden")
    );
    expect(document.body.textContent).not.toContain("Confidential friend");
    expect(document.body.innerHTML).not.toContain(tagId);

    status = "ready";
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-tags")?.textContent)
        .toContain("Confidential friend")
    );
  });

  it("clears food preferences and renders an honest empty section", async () => {
    document.body.innerHTML = `
      <section data-profile-fact-section="food-preferences"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></section>`;
    let present = true;
    let deletes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_resource: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deletes++;
          present = false;
          return response({
            factId: personId,
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            status: "deleted",
          });
        }
        return response({
          options: [],
          personUpdatedAt: present ? revision : "2026-08-16T12:00:00.000001Z",
          records: present
            ? [{
              id: personId,
              section: "food-preferences",
              updatedAt: revision,
              value: {
                foodPreferences: "Tea",
                section: "food-preferences",
              },
            }]
            : [],
          status: "ready",
        });
      }),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    const clear = document.querySelector<HTMLButtonElement>(
      "[data-profile-fact-list] button:last-child",
    )!;
    expect(clear.textContent).toBe("Clear food preferences");
    expect(clear.classList.contains("button-danger")).toBe(true);
    clear.click();
    clear.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-profile-fact-state]")?.textContent)
        .toBe("Profile fact deleted.")
    );
    expect(deletes).toBe(1);
    expect(document.body.textContent).not.toContain("1 saved.");
    expect(document.body.textContent).not.toContain("Tea");
  });

  it("keeps tag selections durable across independent searches and continuation", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      <div data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    const currentId = "00000000-0000-4000-8000-000000000401";
    const alphaId = "00000000-0000-4000-8000-000000000402";
    const betaId = "00000000-0000-4000-8000-000000000403";
    let savedIds: readonly string[] = [];
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (url.pathname.endsWith("/tag-options")) {
          const search = url.searchParams.get("search");
          const selected = url.searchParams.get("selected");
          const cursor = url.searchParams.get("cursor");
          return response({
            ...(selected
              ? { selected: { id: selected, name: "Current" } }
              : {}),
            ...(search === "alpha" && cursor
              ? { options: [{ id: alphaId, name: "Alpha" }] }
              : search === "alpha"
              ? {
                nextCursor: "alpha-next",
                options: [{ id: alphaId, name: "Alpha" }],
              }
              : search === "beta"
              ? { options: [{ id: betaId, name: "Beta" }] }
              : { options: [{ id: currentId, name: "Current" }] }),
            status: "ready",
          });
        }
        if (["POST", "PUT"].includes(init?.method ?? "")) {
          savedIds = (JSON.parse(String(init?.body)) as { tagIds: string[] })
            .tagIds;
          return response({
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            record: {
              id: personId,
              section: "tags",
              updatedAt: "2026-08-16T12:00:00.000001Z",
              value: { tagIds: savedIds },
            },
            status: "saved",
          });
        }
        return response({
          options: [{ id: currentId, name: "Current" }],
          personUpdatedAt: revision,
          records: [{
            id: personId,
            section: "tags",
            updatedAt: revision,
            value: { tagIds: [currentId] },
          }],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    const control = document.querySelector<HTMLSelectElement>(
      '[name="tagIds"]',
    )!;
    const search = document.querySelector<HTMLInputElement>(
      '[name="tagSearch"]',
    )!;
    await vi.waitFor(() =>
      expect([...control.selectedOptions].map((option) => option.value))
        .toContain(currentId)
    );

    search.value = "alpha";
    document.querySelector<HTMLButtonElement>("[data-tag-search]")!.click();
    await vi.waitFor(() =>
      expect([...control.options].some((option) => option.value === alphaId))
        .toBe(true)
    );
    [...control.options].find((option) => option.value === alphaId)!.selected =
      true;
    document.querySelector<HTMLButtonElement>("[data-tag-more]")!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>("[data-tag-more]")?.hidden,
      )
        .toBe(true)
    );
    search.value = "beta";
    document.querySelector<HTMLButtonElement>("[data-tag-search]")!.click();
    await vi.waitFor(() =>
      expect([...control.options].some((option) => option.value === betaId))
        .toBe(true)
    );
    [...control.options].find((option) => option.value === betaId)!.selected =
      true;
    control.form!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    await vi.waitFor(() =>
      expect(savedIds).toEqual([currentId, alphaId, betaId])
    );
  });

  it("fails closed when an existing introducer outside the first page cannot hydrate", async () => {
    document.body.innerHTML = `
      <section data-profile-fact-section="first-meeting"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add></button><form data-profile-fact-form></form></section>`;
    const introducerId = "00000000-0000-4000-8000-000000000450";
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (resource: string | URL | Request, init?: RequestInit) => {
          const url = new URL(String(resource), "http://localhost");
          if (url.pathname === "/api/v1/people") {
            if (url.searchParams.get("selectedPersonId") === introducerId) {
              return response({ status: 503, title: "Unavailable" }, 503);
            }
            return response({ people: [], status: "ready" });
          }
          if (["POST", "PUT"].includes(init?.method ?? "")) writes++;
          return response({
            options: [],
            personUpdatedAt: revision,
            records: [{
              id: personId,
              section: "first-meeting",
              updatedAt: revision,
              value: { introducedByPersonId: introducerId, notes: "Story" },
            }],
            status: "ready",
          });
        },
      ),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-profile-fact-state]")?.textContent)
        .toContain("could not be verified")
    );
    document.querySelector<HTMLFormElement>("form")!.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    expect(writes).toBe(0);
    expect(document.querySelector("[data-profile-fact-state]")?.textContent)
      .toContain("could not be verified");
  });

  it("saves and refreshes only the affected section", async () => {
    markup();
    const empty = {
      options: [],
      personUpdatedAt: revision,
      records: [],
      status: "ready",
    };
    const record = {
      id: "00000000-0000-4000-8000-000000000300",
      section: "contact-methods",
      updatedAt: "2026-08-16T12:00:00.000Z",
      value: {
        isPrimary: true,
        labelIds: [],
        typeId,
        value: "ada@example.test",
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(empty))
      .mockResolvedValueOnce(response({
        ...empty,
        options: [{ id: typeId, kind: "contact-type", name: "Email" }],
      }))
      .mockResolvedValueOnce(response({
        personUpdatedAt: "2026-08-16T12:00:00.000001Z",
        record,
        status: "saved",
      }))
      .mockResolvedValueOnce(response({
        ...empty,
        options: [{ id: typeId, kind: "contact-type", name: "Email" }],
        records: [record],
      }))
      .mockResolvedValueOnce(response({
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
      }));
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileFacts(personId, workspaceId, false, revision);
    (document.querySelector("[data-profile-fact-add]") as HTMLButtonElement)
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false)
    );
    (document.querySelector('[name="typeId"]') as HTMLSelectElement).value =
      typeId;
    (document.querySelector('[name="value"]') as HTMLInputElement).value =
      "ada@example.test";
    (document.querySelector('[name="isPrimary"]') as HTMLInputElement).checked =
      true;
    (document.querySelector("[data-profile-fact-form]") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `/api/v1/people/${personId}/facts/contact-methods`,
      `/api/v1/people/${personId}/facts/contact-methods?includeOptions=true`,
      `/api/v1/people/${personId}/facts/contact-methods`,
      `/api/v1/people/${personId}/facts/contact-methods`,
      `/api/v1/people/${personId}?include=summary`,
    ]);
    expect(
      document.querySelector<HTMLAnchorElement>(
        '[data-profile-fact-list] a[href="mailto:ada@example.test"]',
      )?.textContent,
    ).toBe("ada@example.test");
    expect(document.querySelector("[data-profile-fact-state]")?.textContent)
      .toBe("Profile fact saved.");
  });

  it("loads one bounded vocabulary page only when the editor opens", async () => {
    markup();
    const firstOptions = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      kind: "contact-type",
      name: `Type ${String(index + 1).padStart(2, "0")}`,
    }));
    const fetchMock = vi.fn(
      (resource: string | URL | Request) => {
        const url = new URL(String(resource), "http://localhost");
        return response({
          options: !url.searchParams.has("includeOptions")
            ? []
            : url.searchParams.has("optionCursor")
            ? [{
              id: typeId,
              kind: "contact-type",
              name: "Selected continuation type",
            }]
            : firstOptions,
          personUpdatedAt: revision,
          records: [],
          ...(url.searchParams.has("optionCursor")
            ? {}
            : { nextOptionsCursor: "next-options" }),
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "includeOptions=true",
    );
    const moreOptions = document.querySelector<HTMLButtonElement>(
      "[data-profile-option-more]",
    )!;
    await vi.waitFor(() => expect(moreOptions.hidden).toBe(false));
    moreOptions.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain(
      "optionCursor=next-options",
    );
    await vi.waitFor(() =>
      expect(
        [...document.querySelectorAll<HTMLOptionElement>(
          '[name="typeId"] option',
        )]
          .map((option) => option.textContent),
      ).toContain("Selected continuation type")
    );
  });

  it("keeps a bounded fact-page DOM with explicit next and previous navigation", async () => {
    markup();
    const continuationTypeId = "00000000-0000-4000-8000-000000000299";
    const records = Array.from({ length: 51 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
      section: "contact-methods",
      updatedAt: revision,
      value: {
        isPrimary: false,
        labelIds: [],
        typeId: index === 50 ? continuationTypeId : typeId,
        value: `person-${index}@example.test`,
      },
      referencesResolved: true,
      selectedOptions: [{
        id: index === 50 ? continuationTypeId : typeId,
        kind: "contact-type",
        name: index === 50 ? "Continuation type" : "Email",
      }],
    }));
    const savedBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (init?.method === "PUT") {
          savedBodies.push(JSON.parse(String(init.body)));
          return response({
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            record: records[50],
            status: "saved",
          });
        }
        return response({
          options: url.searchParams.has("cursor")
            ? records[50]!.selectedOptions
            : [{ id: typeId, kind: "contact-type", name: "Email" }],
          personUpdatedAt: revision,
          records: url.searchParams.has("includeOptions")
            ? records.slice(0, 50)
            : url.searchParams.has("cursor")
            ? records.slice(50)
            : records.slice(0, 50),
          ...(url.searchParams.has("cursor")
            ? {}
            : { nextCursor: "next-facts" }),
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-profile-fact-list] li"))
      .toHaveLength(50);
    expect(document.querySelector("[data-profile-fact-pagination]")?.tagName)
      .toBe("NAV");
    const more = document.querySelector<HTMLButtonElement>(
      "[data-profile-fact-more]",
    )!;
    expect(more.classList.contains("button-secondary")).toBe(true);
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-profile-fact-list] li"))
        .toHaveLength(1)
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const previous = document.querySelector<HTMLButtonElement>(
      "[data-profile-fact-previous]",
    )!;
    expect(previous.classList.contains("button-secondary")).toBe(true);
    expect(previous.hidden).toBe(false);
    previous.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-profile-fact-list] li"))
        .toHaveLength(50)
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-more]")!
      .click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-profile-fact-list] li"))
        .toHaveLength(1)
    );
    const continuationEdit = [...document.querySelectorAll<HTMLButtonElement>(
      "[data-profile-fact-list] button",
    )].find((button) => button.textContent?.includes("person-50@example.test"));
    expect(continuationEdit?.classList.contains("button-secondary")).toBe(
      true,
    );
    continuationEdit?.click();
    await vi.waitFor(() =>
      expect(
        (document.querySelector('[name="typeId"]') as HTMLSelectElement).value,
      ).toBe(continuationTypeId)
    );
    (document.querySelector('[name="value"]') as HTMLInputElement).value =
      "updated@example.test";
    (document.querySelector("[data-profile-fact-form]") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    await vi.waitFor(() => expect(savedBodies).toHaveLength(1));
    expect(savedBodies[0]?.typeId).toBe(continuationTypeId);
  });

  it("fails an unresolved vocabulary-backed record editor closed", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValue(response({
      options: [],
      personUpdatedAt: revision,
      records: [{
        id: personId,
        referencesResolved: false,
        section: "contact-methods",
        selectedOptions: [],
        updatedAt: revision,
        value: {
          isPrimary: false,
          labelIds: ["00000000-0000-4000-8000-000000000298"],
          typeId: "00000000-0000-4000-8000-000000000299",
          value: "unresolved@example.test",
        },
      }],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>(
      "[data-profile-fact-list] button",
    )!.click();

    await vi.waitFor(() =>
      expect(document.querySelector("[data-profile-fact-state]")?.textContent)
        .toContain("could not be verified")
    );
    expect(
      document.querySelector<HTMLFormElement>("[data-profile-fact-form]")
        ?.hidden,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces exact browser field and selection boundaries before saving", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      ${
      [
        "contact-methods",
        "addresses",
        "first-meeting",
        "work",
        "food-preferences",
        "pets",
      ].map((section) => `
        <section data-profile-fact-section="${section}"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add>Add</button><form data-profile-fact-form></form></section>
      `).join("")
    }
      <section data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add>Add</button><form data-profile-fact-form></form></section>`;
    const labels = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8100-${String(index + 1).padStart(12, "0")}`,
      kind: "contact-label",
      name: `Label ${index + 1}`,
    }));
    const tags = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-4000-8200-${String(index + 1).padStart(12, "0")}`,
      name: `Tag ${index + 1}`,
    }));
    let writes = 0;
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (url.pathname.endsWith("/tag-options")) {
          return response({ options: tags, status: "ready" });
        }
        const section = url.pathname.split("/").at(-1)!;
        if (["POST", "PUT"].includes(init?.method ?? "")) {
          writes++;
          const value = JSON.parse(String(init?.body));
          return response({
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            record: {
              id: personId,
              section,
              updatedAt: "2026-08-16T12:00:00.000001Z",
              value,
            },
            status: "saved",
          });
        }
        return response({
          options: section === "contact-methods"
            ? [{ id: typeId, kind: "contact-type", name: "Email" }, ...labels]
            : [],
          personUpdatedAt: revision,
          records: [],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);

    const sectionForm = (section: string) =>
      document.querySelector<HTMLFormElement>(
        `[data-profile-fact-section="${section}"] form`,
      )!;
    expect(
      (sectionForm("addresses").elements.namedItem(
        "postalCode",
      ) as HTMLInputElement)
        .maxLength,
    ).toBe(50);
    for (
      const [section, name, maximum] of [
        ["addresses", "displayName", 200],
        ["addresses", "street", 500],
        ["first-meeting", "placeText", 500],
        ["work", "title", 200],
        ["work", "organizationName", 200],
        ["pets", "name", 200],
        ["contact-methods", "value", 2_000],
      ] as const
    ) {
      expect(
        (sectionForm(section).elements.namedItem(name) as HTMLInputElement)
          .maxLength,
      ).toBe(maximum);
    }

    const contactRoot = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="contact-methods"]',
    )!;
    contactRoot.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    const contactForm = sectionForm("contact-methods");
    await vi.waitFor(() =>
      expect(
        contactForm.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      )
        .toBe(false)
    );
    (contactForm.elements.namedItem("typeId") as HTMLSelectElement).value =
      typeId;
    (contactForm.elements.namedItem("value") as HTMLInputElement).value = "x"
      .repeat(2_000);
    const labelSelect = contactForm.elements.namedItem(
      "labelIds",
    ) as HTMLSelectElement;
    [...labelSelect.options].slice(0, 20).forEach((option) =>
      option.selected = true
    );
    contactForm.requestSubmit();
    await vi.waitFor(() => expect(writes).toBe(1));
    await vi.waitFor(() =>
      expect(
        contactRoot.querySelector("[data-profile-fact-state]")?.textContent,
      ).toContain("saved")
    );

    contactRoot.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(
        contactForm.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      )
        .toBe(false)
    );
    (contactForm.elements.namedItem("typeId") as HTMLSelectElement).value =
      typeId;
    (contactForm.elements.namedItem("value") as HTMLInputElement).value = "x"
      .repeat(2_001);
    const overLimitLabels = contactForm.elements.namedItem(
      "labelIds",
    ) as HTMLSelectElement;
    [...overLimitLabels.options].forEach((option) => option.selected = true);
    expect(overLimitLabels.selectedOptions).toHaveLength(21);
    contactForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(writes).toBe(1);
    expect(contactForm.textContent).toContain("20 labels");
  });

  it("rejects whitespace-only food preferences before transport", async () => {
    document.body.innerHTML = `
      <section data-profile-fact-section="food-preferences"><p data-profile-fact-state></p><ul data-profile-fact-list></ul><button data-profile-fact-add>Add</button><form data-profile-fact-form></form></section>`;
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_resource, init?: RequestInit) => {
        if (["POST", "PUT"].includes(init?.method ?? "")) writes++;
        return response({
          options: [],
          personUpdatedAt: revision,
          records: [],
          status: "ready",
        });
      }),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    const foodForm = document.querySelector<HTMLFormElement>("form")!;
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(
        foodForm.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false)
    );
    (foodForm.elements.namedItem("foodPreferences") as HTMLTextAreaElement)
      .value = "   ";
    foodForm.requestSubmit();
    expect(writes).toBe(0);
    expect(foodForm.textContent).toContain("food preferences");
  });

  it("rejects more than 500 durable tag selections before transport", async () => {
    document.body.innerHTML = `
      <ul id="person-profile-tags"></ul>
      <section data-profile-fact-section="tags"><p data-profile-fact-state></p><button data-profile-fact-add>Add</button><form data-profile-fact-form></form></section>`;
    const tags = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-4000-8200-${String(index + 1).padStart(12, "0")}`,
      name: `Tag ${index + 1}`,
    }));
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (["POST", "PUT"].includes(init?.method ?? "")) writes++;
        return url.pathname.endsWith("/tag-options")
          ? response({ options: tags, status: "ready" })
          : response({
            options: [],
            personUpdatedAt: revision,
            records: [],
            status: "ready",
          });
      }),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    const tagsForm = document.querySelector<HTMLFormElement>("form")!;
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(
        (tagsForm.elements.namedItem("tagIds") as HTMLSelectElement).options,
      )
        .toHaveLength(501)
    );
    for (
      const option
        of (tagsForm.elements.namedItem("tagIds") as HTMLSelectElement)
          .options
    ) option.selected = true;
    tagsForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    expect(writes).toBe(0);
    expect(tagsForm.textContent).toContain("500 tags");
  });

  it("hides a disabled module without rendering retained data", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          options: [],
          personUpdatedAt: revision,
          records: [],
          status: "hidden",
        }),
      ),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(
      (document.querySelector("[data-profile-fact-section]") as HTMLElement)
        .hidden,
    ).toBe(true);
    expect(document.querySelector("[data-profile-fact-list]")?.children)
      .toHaveLength(0);
  });

  it("builds, saves, edits, and deletes every enabled fact shape", async () => {
    allMarkup();
    const options = {
      "contact-methods": [
        { id: typeId, kind: "contact-type", name: "Email" },
        {
          id: "00000000-0000-4000-8000-000000000210",
          kind: "contact-label",
          name: "Home",
        },
      ],
      addresses: [{
        id: "00000000-0000-4000-8000-000000000210",
        kind: "contact-label",
        name: "Home",
      }],
      pets: [{
        id: "00000000-0000-4000-8000-000000000220",
        kind: "pet-category",
        name: "Cat",
      }],
      tags: [{ id: "00000000-0000-4000-8000-000000000230", name: "Friend" }],
    } as const;
    const records = new Map<string, unknown[]>();
    const fetchMock = vi.fn(
      (resource: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(resource), "http://localhost");
        if (url.pathname.endsWith("/tag-options")) {
          return response({ options: options.tags, status: "ready" });
        }
        if (url.pathname === "/api/v1/people") {
          return response({ people: [], status: "ready" });
        }
        const section = url.pathname.match(/\/facts\/([^/]+)/)?.[1] ?? "";
        if (["POST", "PUT"].includes(init?.method ?? "")) {
          const body = JSON.parse(String(init?.body)) as Record<
            string,
            unknown
          >;
          const id = String(
            body.id ??
              (section === "tags" || section === "food-preferences" ||
                  section === "first-meeting"
                ? personId
                : `00000000-0000-4000-8000-0000000003${records.size}`),
          );
          delete body.id;
          delete body.expectedPersonUpdatedAt;
          delete body.expectedUpdatedAt;
          const record = {
            id,
            section,
            updatedAt: "2026-08-16T12:00:00.000Z",
            value: body,
          };
          records.set(section, [record]);
          return response({
            personUpdatedAt: "2026-08-16T12:00:00.000001Z",
            record,
            status: "saved",
          });
        }
        if (init?.method === "DELETE") {
          records.set(section, []);
          return response({
            factId: "deleted",
            personUpdatedAt: "2026-08-16T12:00:00.000002Z",
            status: "deleted",
          });
        }
        return response({
          options: url.searchParams.has("includeOptions") ||
              (records.get(section)?.length ?? 0) > 0
            ? options[section as keyof typeof options] ?? []
            : [],
          personUpdatedAt: "2026-08-16T12:00:00.000002Z",
          records: records.get(section) ?? [],
          status: "ready",
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);

    const values: Record<string, Record<string, string | boolean | string[]>> =
      {
        "contact-methods": {
          typeId,
          value: "ada@example.test",
          labelIds: ["00000000-0000-4000-8000-000000000210"],
          isPrimary: true,
          notes: "Preferred",
        },
        addresses: {
          displayName: "Home",
          street: "One Way",
          city: "London",
          region: "Region",
          postalCode: "123",
          country: "UK",
          labelIds: ["00000000-0000-4000-8000-000000000210"],
          isPrimary: true,
        },
        "first-meeting": { placeText: "Salon", notes: "Introduced there" },
        work: {
          title: "Mathematician",
          organizationName: "Engines",
          startOn: "2020-01-01",
          endOn: "2021-01-01",
          isCurrent: true,
          description: "Analysis",
        },
        "food-preferences": { foodPreferences: "Tea" },
        pets: {
          name: "Byron",
          categoryId: "00000000-0000-4000-8000-000000000220",
          notes: "Calm",
        },
        tags: { tagIds: ["00000000-0000-4000-8000-000000000230"] },
      };
    for (const section of Object.keys(values)) {
      const root = document.querySelector<HTMLElement>(
        `[data-profile-fact-section="${section}"]`,
      )!;
      root.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!.click();
      await vi.waitFor(() =>
        expect(
          root.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled,
        ).toBe(false)
      );
      for (const [name, value] of Object.entries(values[section]!)) {
        const control = root.querySelector<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
        >(`[name="${name}"]`)!;
        if (
          control instanceof HTMLInputElement && control.type === "checkbox"
        ) control.checked = value === true;
        else if (control instanceof HTMLSelectElement && Array.isArray(value)) {
          for (const option of control.options) {
            option.selected = value.includes(option.value);
          }
        } else control.value = String(value);
      }
      root.querySelector<HTMLFormElement>("form")!.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(root.querySelector("[data-profile-fact-state]")?.textContent)
          .toBe("Profile fact saved.")
      );
    }
    expect(document.querySelector("#person-profile-tags")?.textContent)
      .toContain("Friend");
    expect(document.body.textContent).toContain("Home, One Way, London, UK");
    expect(document.body.textContent).toContain("Mathematician at Engines");
    expect(document.body.textContent).toContain("Byron · Cat");

    const contactRoot = document.querySelector<HTMLElement>(
      '[data-profile-fact-section="contact-methods"]',
    )!;
    contactRoot.querySelector<HTMLButtonElement>(
      "[data-profile-fact-list] button",
    )!.click();
    await vi.waitFor(() =>
      expect(
        (contactRoot.querySelector('[name="notes"]') as HTMLTextAreaElement)
          .value,
      ).toBe("Preferred")
    );
    const cancel = contactRoot.querySelector<HTMLButtonElement>(
      '.form-actions button[type="button"]',
    )!;
    cancel.click();
    expect(contactRoot.querySelector("[data-profile-fact-state]")?.textContent)
      .toContain("cancelled");
    const remove = [
      ...contactRoot.querySelectorAll<HTMLButtonElement>(
        "[data-profile-fact-list] button",
      ),
    ].find((button) => button.textContent?.startsWith("Delete"))!;
    remove.click();
    expect(contactRoot.querySelector("[data-profile-fact-state]")?.textContent)
      .toContain("again");
    remove.click();
    await vi.waitFor(() =>
      expect(contactRoot.querySelector("[data-profile-fact-list]")?.children)
        .toHaveLength(0)
    );
  });

  it("maps unavailable and forbidden reads and lifecycle read-only state", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          code: "unavailable",
          detail: "Private",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }, 503),
      ),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(
      document.querySelector("[data-profile-fact-section]")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("error");

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          code: "forbidden",
          detail: "Private",
          status: 403,
          title: "Forbidden",
          type: "about:blank",
        }, 403),
      ),
    );
    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(
      document.querySelector("[data-profile-fact-section]")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("forbidden");
    expect(document.body.textContent).not.toContain("Private");

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          options: [],
          personUpdatedAt: revision,
          records: [],
          status: "archived",
        }),
      ),
    );
    await mountProfileFacts(personId, workspaceId, true, revision);
    expect(
      (document.querySelector("[data-profile-fact-add]") as HTMLButtonElement)
        .hidden,
    ).toBe(true);
    expect(document.querySelector("[data-profile-fact-badge]")?.textContent)
      .toBe("Read-only");
    expect(
      document.querySelector<HTMLElement>("[data-profile-fact-section]")
        ?.dataset.railEmpty,
    ).toBe("true");
  });

  it("rejects notes-only pets locally with an adjacent field error", async () => {
    document.body.innerHTML = `
      <div data-profile-fact-section="pets"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    let writes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_resource: string | URL | Request, init?: RequestInit) => {
        if (["POST", "PUT"].includes(init?.method ?? "")) writes++;
        return response({
          options: [],
          personUpdatedAt: revision,
          records: [],
          status: "ready",
        });
      }),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false)
    );
    document.querySelector<HTMLTextAreaElement>('[name="notes"]')!.value =
      "Notes without a pet identity";
    document.querySelector<HTMLFormElement>("form")!.requestSubmit();
    expect(writes).toBe(0);
    expect(
      document.querySelector("[data-profile-fact-field-error]")?.textContent,
    ).toBe("Enter a pet name or category.");
  });

  it("focuses the invalid work field after an API validation response", async () => {
    document.body.innerHTML = `
      <div data-profile-fact-section="work"><p data-profile-fact-state></p><button data-profile-fact-add></button><form data-profile-fact-form></form></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn((_resource: string | URL | Request, init?: RequestInit) =>
        ["POST", "PUT"].includes(init?.method ?? "")
          ? response({
            code: "validation_failed",
            detail: "Profile fact validation failed.",
            errors: {
              endOn: "End date must be on or after the start date.",
            },
            status: 400,
            title: "Validation failed",
            type: "about:blank",
          }, 400)
          : response({
            options: [],
            personUpdatedAt: revision,
            records: [],
            status: "ready",
          })
      ),
    );

    await mountProfileFacts(personId, workspaceId, false, revision);
    document.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled,
      ).toBe(false)
    );
    const form = document.querySelector<HTMLFormElement>("form")!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Engineer";
    (form.elements.namedItem("startOn") as HTMLInputElement).value =
      "2026-01-01";
    const endOn = form.elements.namedItem("endOn") as HTMLInputElement;
    endOn.value = "2025-01-01";
    form.requestSubmit();
    await vi.waitFor(() => expect(document.activeElement).toBe(endOn));
  });

  it("is inert when the profile shell has no fact sections", async () => {
    document.body.innerHTML = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountProfileFacts(personId, workspaceId, false, revision);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
