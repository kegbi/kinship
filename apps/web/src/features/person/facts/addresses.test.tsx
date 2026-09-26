// @vitest-environment happy-dom
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { stubApi } from "../../../testing/api.ts";
import { chooseOptions } from "../../../testing/render.tsx";
import { mountAddresses } from "./addresses.tsx";
import {
  anyRoute,
  block,
  fact,
  factRead,
  factSaved,
  mountFacts,
  railBlock,
  revision,
  shell,
} from "./facts.test-helper.ts";

const labelId = "00000000-0000-4000-8000-000000000210";

const section = () => within(block("addresses"));

describe("GAP-029 addresses island", () => {
  it("saves an address with a label and shows it over three lines", async () => {
    shell(railBlock("addresses"));
    let saved: object | undefined;
    const api = stubApi({
      "POST /api/v1/*": ({ body }) => {
        saved = fact("addresses", {
          ...body as object,
          expectedPersonUpdatedAt: undefined,
        });
        return factSaved(saved);
      },
      "GET /api/v1/*": ({ url }) =>
        factRead(saved ? [saved] : [], {
          options: url.searchParams.has("includeOptions") || saved
            ? [{ id: labelId, kind: "contact-label", name: "Home" }]
            : [],
        }),
    });
    await mountFacts(mountAddresses);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add addresses" }));
    for (
      const [label, maximum] of [
        ["Address name", 200],
        ["Street", 500],
        ["City", 200],
        ["Region", 200],
        ["Postal code", 50],
        ["Country", 200],
      ] as const
    ) {
      expect((section().getByLabelText(label) as HTMLInputElement).maxLength)
        .toBe(maximum);
    }
    await user.type(section().getByLabelText("Address name"), "Home");
    await user.type(
      section().getByLabelText("Street"),
      "1 Analytical Engine Way",
    );
    await user.type(section().getByLabelText("City"), "London");
    const labels = section().getByLabelText<HTMLSelectElement>(
      "Address labels",
    );
    await waitFor(() => expect(labels.options).toHaveLength(1));
    chooseOptions(labels, [labelId]);
    await user.click(section().getByLabelText("Primary address"));
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(
        [
          ...block("addresses").querySelectorAll(
            ".profile-address-summary > span",
          ),
        ].map((line) => line.textContent),
      ).toEqual(["Home", "1 Analytical Engine Way", "London"])
    );
    expect(api.bodies()[0]).toEqual({
      city: "London",
      displayName: "Home",
      expectedPersonUpdatedAt: revision,
      isPrimary: true,
      labelIds: [labelId],
      section: "addresses",
      street: "1 Analytical Engine Way",
    });
    const details = Object.fromEntries(
      [...block("addresses").querySelectorAll(".profile-fact-details > div")]
        .map((row) => [
          row.querySelector("dt")?.textContent,
          row.querySelector("dd")?.textContent,
        ]),
    );
    expect(details).toEqual({ Labels: "Home", Primary: "Yes" });
  });

  it("refuses an address with no detail on its name field", async () => {
    shell(railBlock("addresses"));
    const api = stubApi({ [anyRoute]: factRead([]) });
    await mountFacts(mountAddresses);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add addresses" }));
    const name = section().getByLabelText("Address name");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(
      block("addresses").querySelector("[data-profile-fact-field-error]")
        ?.textContent,
    ).toBe("Enter address details.");
    expect(api.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("edits a saved address from its values and saves it as that record", async () => {
    shell(railBlock("addresses"));
    const home = fact("addresses", {
      city: "London",
      country: "United Kingdom",
      displayName: "Home",
      isPrimary: true,
      labelIds: [labelId],
      postalCode: "SW1A 1AA",
      region: "Greater London",
      street: "1 Analytical Engine Way",
    }, "00000000-0000-4000-8000-000000000401");
    const api = stubApi({
      "PUT /api/v1/*": factSaved(home),
      "GET /api/v1/*": factRead([{
        ...home,
        selectedOptions: [{ id: labelId, kind: "contact-label", name: "Home" }],
      }]),
    });
    await mountFacts(mountAddresses);
    const user = userEvent.setup();
    await user.click(
      section().getByRole("button", {
        name: "Edit Home, 1 Analytical Engine Way, London, United Kingdom",
      }),
    );
    const city = section().getByLabelText<HTMLInputElement>("City");
    await waitFor(() => expect(city.value).toBe("London"));
    expect(section().getByLabelText<HTMLInputElement>("Postal code").value)
      .toBe("SW1A 1AA");
    expect(
      [
        ...section().getByLabelText<HTMLSelectElement>("Address labels")
          .selectedOptions,
      ].map((option) => option.value),
    ).toEqual([labelId]);
    expect(
      section().getByLabelText<HTMLInputElement>("Primary address").checked,
    )
      .toBe(true);
    await user.clear(city);
    await user.type(city, "Cambridge");
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(api.bodies()).toHaveLength(1));
    expect(api.bodies()[0]).toEqual({
      city: "Cambridge",
      country: "United Kingdom",
      displayName: "Home",
      expectedPersonUpdatedAt: revision,
      expectedUpdatedAt: revision,
      id: home.id,
      isPrimary: true,
      labelIds: [labelId],
      postalCode: "SW1A 1AA",
      region: "Greater London",
      section: "addresses",
      street: "1 Analytical Engine Way",
    });
  });

  it("keeps the first address in view and collapses the rest", async () => {
    shell(railBlock("addresses"));
    stubApi({
      [anyRoute]: factRead([
        fact("addresses", {
          city: "London",
          displayName: "Home",
          isPrimary: true,
          labelIds: [],
        }, "00000000-0000-4000-8000-000000000401"),
        fact("addresses", {
          city: "Paris",
          displayName: "Office",
          isPrimary: false,
          labelIds: [],
        }, "00000000-0000-4000-8000-000000000402"),
      ]),
    });
    await mountFacts(mountAddresses);
    const items = block("addresses").querySelectorAll<HTMLLIElement>(
      "[data-profile-fact-list] > li",
    );
    expect(items[0]!.hidden).toBe(false);
    expect(items[1]!.hidden).toBe(true);
    const expander = section().getByRole("button", {
      name: "+ 1 more addresses",
    });
    expect(expander.hasAttribute("aria-label")).toBe(false);
    await userEvent.setup().click(expander);
    expect(items[1]!.hidden).toBe(false);
  });
});
