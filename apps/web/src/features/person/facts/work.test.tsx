// @vitest-environment happy-dom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import {
  block,
  fact,
  factRead,
  mountFacts,
  nextRevision,
  railBlock,
  response,
  shell,
  stubFetch,
  unmountFacts,
} from "./facts.test-helper.ts";
import { mountWork } from "./work.tsx";

const organizationId = "00000000-0000-4000-8000-000000000777";
const organization = {
  id: organizationId,
  kind: "organization",
  name: "Analytical Engines",
};

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

const section = () => within(block("work"));

describe("GAP-029 work island", () => {
  it("chooses an existing organization or names a new one, never both", async () => {
    shell(railBlock("work"));
    const fetch = stubFetch((url, init) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return response({
          personUpdatedAt: nextRevision,
          record: fact("work", {
            ...body,
            organizationName: "Analytical Engines",
          }),
          status: "saved",
        });
      }
      return factRead([], {
        options: url.searchParams.get("optionSearch") === "Analytical"
          ? [organization]
          : [],
      });
    });
    await mountFacts(mountWork);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add work" }));
    const existing = section().getByLabelText<HTMLSelectElement>(
      "Existing organization",
    );
    expect(
      within(existing).queryByRole("option", { name: "Analytical Engines" }),
    ).toBeNull();
    await user.type(
      section().getByLabelText("Search organizations"),
      "Analytical",
    );
    await user.click(
      section().getByRole("button", { name: "Search organizations" }),
    );
    await waitFor(() =>
      expect(
        within(existing).getByRole("option", { name: "Analytical Engines" }),
      ).toBeTruthy()
    );
    await user.selectOptions(existing, organizationId);
    const created = section().getByLabelText<HTMLInputElement>(
      "New organization",
    );
    await user.type(created, "Difference Engines");
    expect(existing.value).toBe("");
    await user.selectOptions(existing, organizationId);
    expect(created.value).toBe("");
    await user.type(section().getByLabelText("Role or title"), "Mathematician");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(fetch.bodies()).toHaveLength(1));
    expect(fetch.bodies()[0]).toMatchObject({
      isCurrent: false,
      organizationId,
      section: "work",
      title: "Mathematician",
    });
    expect(fetch.bodies()[0]).not.toHaveProperty("organizationName");
    await waitFor(() =>
      expect(
        block("work").querySelector("[data-profile-fact-state]")
          ?.textContent,
      ).toBe("Profile fact saved.")
    );
  });

  it("puts an API refusal on the field it names and focuses it", async () => {
    shell(railBlock("work"));
    stubFetch((_url, init) =>
      init?.method === "POST"
        ? response({
          code: "validation_failed",
          detail: "Profile fact validation failed.",
          errors: { endOn: "End date must be on or after the start date." },
          status: 400,
          title: "Validation failed",
          type: "about:blank",
        }, 400)
        : factRead([])
    );
    await mountFacts(mountWork);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add work" }));
    await user.type(section().getByLabelText("Role or title"), "Engineer");
    fireEvent.input(section().getByLabelText("Start date"), {
      target: { value: "2026-01-01" },
    });
    const end = section().getByLabelText("End date");
    fireEvent.input(end, { target: { value: "2025-01-01" } });
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(end));
    expect(end.getAttribute("aria-invalid")).toBe("true");
    expect(block("work").textContent).toContain(
      "End date must be on or after the start date.",
    );
    expect(
      block("work").querySelector("[data-profile-fact-form-state]")
        ?.textContent,
    ).toBe("Profile fact validation failed.");
    expect(block("work").querySelector("form")!.hidden).toBe(false);
  });

  it("keeps the current role in view behind a history expander", async () => {
    shell(railBlock("work"));
    const roles = [
      fact("work", {
        isCurrent: true,
        organizationName: "Difference Engines",
        startOn: "2024-01-01",
        title: "Director",
      }, "00000000-0000-4000-8000-000000000412"),
      fact("work", {
        isCurrent: false,
        organizationName: "Analytical Engines",
        startOn: "2024-01-01",
        title: "Mathematician",
      }, "00000000-0000-4000-8000-000000000411"),
      fact("work", {
        endOn: "2026-08-01",
        isCurrent: false,
        organizationName: "Royal Society",
        startOn: "2025-01-01",
        title: "Fellow",
      }, "00000000-0000-4000-8000-000000000413"),
    ];
    stubFetch(() => factRead(roles));
    await mountFacts(mountWork);
    const items = [
      ...block("work").querySelectorAll<HTMLLIElement>(
        "[data-profile-fact-list] > li",
      ),
    ];
    expect(items.find((item) => !item.hidden)?.textContent).toContain(
      "Mathematician at Analytical Engines",
    );
    expect(items.filter((item) => item.hidden)).toHaveLength(2);
    const history = section().getByRole("button", {
      name: "Show history work roles",
    });
    expect(history.firstChild?.textContent).toBe("Show history");
    await userEvent.setup().click(history);
    expect(items.every((item) => !item.hidden)).toBe(true);
    expect(summary.vital("work")).toBe("Director at Difference Engines");
  });

  it("UXD-002B publishes the work vital and clears it when the role is deleted", async () => {
    shell(railBlock("work"));
    let present = true;
    stubFetch((_url, init) => {
      if (init?.method === "DELETE") {
        present = false;
        return response({
          factId: "deleted",
          personUpdatedAt: nextRevision,
          status: "deleted",
        });
      }
      return factRead(
        present
          ? [fact("work", {
            isCurrent: true,
            organizationName: "Analytical Engines",
            title: "Mathematician",
          })]
          : [],
      );
    });
    await mountFacts(mountWork);
    expect(summary.vital("work")).toBe("Mathematician at Analytical Engines");
    expect(summary.railCount("work")).toBe("1");
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", {
        name: "Delete Mathematician at Analytical Engines",
      }),
    );
    await user.click(
      section().getByRole("button", {
        name: "Confirm delete Mathematician at Analytical Engines",
      }),
    );
    await waitFor(() => expect(summary.vital("work")).toBe("Not recorded"));
    expect(summary.railCount("work")).toBe("0");
    expect(summary.railEmpty("work")).toBe(true);
  });

  it("edits a saved role with its organization chosen and dates filled", async () => {
    shell(railBlock("work"));
    const fetch = stubFetch((url) =>
      factRead([{
        ...fact("work", {
          endOn: "2021-01-01",
          isCurrent: true,
          organizationId,
          organizationName: "Analytical Engines",
          startOn: "2020-01-01",
          title: "Mathematician",
        }),
        selectedOptions: [organization],
      }], url.searchParams.has("includeOptions") ? {} : {})
    );
    await mountFacts(mountWork);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", {
        name: "Edit Mathematician at Analytical Engines",
      }),
    );
    const existing = section().getByLabelText<HTMLSelectElement>(
      "Existing organization",
    );
    await waitFor(() => expect(existing.value).toBe(organizationId));
    expect(
      within(existing).getByRole("option", { name: "Analytical Engines" }),
    ).toBeTruthy();
    expect(
      section().getByLabelText<HTMLInputElement>("New organization").value,
    ).toBe("");
    expect(section().getByLabelText<HTMLInputElement>("Start date").value)
      .toBe("2020-01-01");
    expect(section().getByLabelText<HTMLInputElement>("Current role").checked)
      .toBe(true);
    expect(fetch.calls()).toHaveLength(2);
  });
});
