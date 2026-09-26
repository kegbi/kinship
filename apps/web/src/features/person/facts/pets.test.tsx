// @vitest-environment happy-dom
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { stubApi } from "../../../testing/api.ts";
import {
  anyRoute,
  block,
  fact,
  factRead,
  factSaved,
  mountFacts,
  personId,
  railBlock,
  revision,
  shell,
} from "./facts.test-helper.ts";
import { mountPets } from "./pets.tsx";

const catId = "00000000-0000-4000-8000-000000000220";

const section = () => within(block("pets"));

describe("GAP-029 pets island", () => {
  it("saves a pet with a category from the vocabulary page the editor loads", async () => {
    shell(railBlock("pets"));
    let saved: object | undefined;
    const api = stubApi({
      "POST /api/v1/*": () => {
        saved = fact("pets", {
          categoryId: catId,
          name: "Byron",
          notes: "A shy cat; let him approach first.",
        });
        return factSaved(saved);
      },
      "GET /api/v1/*": ({ url }) => {
        const options = url.searchParams.has("includeOptions") || saved
          ? [{ id: catId, kind: "pet-category", name: "Cat" }]
          : [];
        return factRead(saved ? [saved] : [], { options });
      },
    });
    await mountFacts(mountPets);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add pets" }));
    const name = section().getByLabelText("Pet name");
    await waitFor(() => expect(document.activeElement).toBe(name));
    await user.type(name, "Byron");
    await user.selectOptions(section().getByLabelText("Pet category"), catId);
    await user.type(
      section().getByLabelText("Pet notes"),
      "A shy cat; let him approach first.",
    );
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(block("pets").textContent).toContain("Byron · Cat")
    );
    expect(api.bodies()).toEqual([{
      categoryId: catId,
      expectedPersonUpdatedAt: revision,
      name: "Byron",
      notes: "A shy cat; let him approach first.",
      section: "pets",
    }]);
    expect(api.calls()).toEqual([
      `GET /api/v1/people/${personId}/facts/pets`,
      `GET /api/v1/people/${personId}/facts/pets?includeOptions=true`,
      `POST /api/v1/people/${personId}/facts/pets`,
      `GET /api/v1/people/${personId}/facts/pets`,
    ]);
    expect(
      section().getByRole("button", { name: "Edit Byron · Cat" }),
    ).toBeTruthy();
  });

  it("refuses notes without a pet on the name field, before transport", async () => {
    shell(railBlock("pets"));
    const api = stubApi({ [anyRoute]: factRead([]) });
    await mountFacts(mountPets);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Add pets" }));
    const name = section().getByLabelText("Pet name");
    await user.type(
      section().getByLabelText("Pet notes"),
      "Notes without a pet identity",
    );
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(
      block("pets").querySelector("[data-profile-fact-field-error]")
        ?.textContent,
    ).toBe("Enter a pet name or category.");
    expect(api.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });
});
