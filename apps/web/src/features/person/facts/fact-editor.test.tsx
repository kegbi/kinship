// @vitest-environment happy-dom
import { act, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { SECTION_HIDDEN_EVENT } from "../sections.ts";
import type { SectionMount } from "../section-mounts.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import { requestWorkspaceChange } from "../../../lib/workspace-context.ts";
import { mountAddresses } from "./addresses.tsx";
import { mountContactMethods } from "./contact-methods.tsx";
import {
  block,
  fact,
  factRead,
  mountFacts,
  mountFactsLater,
  nextRevision,
  personId,
  problem,
  railBlock,
  response,
  revision,
  sectionOf,
  shell,
  stubFetch,
  tagsBlock,
  unmountFacts,
  workspaceId,
} from "./facts.test-helper.ts";
import { mountFirstMeeting } from "./first-meeting.tsx";
import { mountFoodPreferences } from "./food.tsx";
import { mountPets } from "./pets.tsx";
import { mountTags } from "./tags.tsx";
import { mountWork } from "./work.tsx";

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

const MOUNTS: Readonly<Record<string, SectionMount>> = {
  addresses: mountAddresses,
  "contact-methods": mountContactMethods,
  "first-meeting": mountFirstMeeting,
  "food-preferences": mountFoodPreferences,
  pets: mountPets,
  tags: mountTags,
  work: mountWork,
};

const RAIL = [
  "contact-methods",
  "addresses",
  "first-meeting",
  "work",
  "food-preferences",
  "pets",
] as const;

/** Draws and mounts `sections`, each over its own block. */
async function mountAll(
  sections: readonly string[],
  options: Parameters<typeof mountFacts>[1] = {},
): Promise<void> {
  shell(
    ...sections.map((section) =>
      section === "tags" ? tagsBlock() : railBlock(section)
    ),
  );
  for (const section of sections) await mountFacts(MOUNTS[section]!, options);
}

const within_ = (section: string) => within(block(section));
const stateOf = (section: string) =>
  block(section).querySelector<HTMLElement>("[data-profile-fact-state]")!;
const formOf = (section: string) => block(section).querySelector("form")!;
const retryOf = (section: string) =>
  within_(section).queryByRole("button", { name: "Retry" });
const unloadBlocked = () =>
  !globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true }));
function guard(confirm: (message: string) => boolean = () => false) {
  mountUnsavedChangesGuard({ confirmMessage: "Discard?", root: document.body });
  const decision = vi.fn(confirm);
  vi.stubGlobal("confirm", decision);
  return decision;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => resolve = settle);
  return { promise, resolve };
}

const food = (text = "Saved tea preference") =>
  fact("food-preferences", { foodPreferences: text });
const mochi = fact("pets", { name: "Mochi", notes: "Enjoys the garden" });

describe("GAP-029 fact editor", () => {
  it("keeps the rail heading, draws its add control there, and marks the island ready", async () => {
    stubFetch(() => factRead([]));
    await mountAll(["pets"]);
    const root = block("pets");
    const heading = root.querySelector("header")!;
    expect(root.firstElementChild).toBe(heading);
    expect(heading.querySelector("[data-rail-count-slot]")).not.toBeNull();
    expect(heading.querySelectorAll("[data-profile-fact-add]")).toHaveLength(1);
    const add = within(heading).getByRole("button", { name: "Add pets" });
    expect(add.className).toContain("profile-rail-add");
    expect(add.hasAttribute("data-profile-fact-add-icon")).toBe(true);
    expect(add.textContent).toBe("+");
    expect(root.dataset.island).toBe("person-fact-pets");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(stateOf("pets").textContent).toBe("No pets saved.");
    expect(stateOf("pets").dataset.railSummary).toBe("true");
    expect(within_("pets").getByRole("list", { name: "Saved pets" }))
      .toBeTruthy();
    expect(
      root.querySelector("[data-profile-fact-pagination]")?.getAttribute(
        "aria-label",
      ),
    ).toBe("pets fact pages");
  });

  it("is inert when the shell has no block for its section", async () => {
    const fetch = stubFetch(() => factRead([]));
    shell();
    await mountFacts(mountPets);
    expect(fetch.mock).not.toHaveBeenCalled();
  });

  it("APR-003 retries a failed Pets read locally without replacing a neighboring draft", async () => {
    const confirm = guard();
    let petReads = 0;
    const retry = deferred<Response>();
    const fetch = stubFetch((url) => {
      const section = sectionOf(url);
      if (section === "pets") {
        petReads++;
        if (petReads === 1) throw new Error("Network failure");
        if (petReads === 2) return retry.promise;
        return factRead([mochi]);
      }
      return factRead(section === "food-preferences" ? [food()] : []);
    });
    await mountAll(["food-preferences", "pets"]);
    expect(block("pets").dataset.sectionState).toBe("error");
    expect(stateOf("pets").textContent).toBe(
      "This profile section is temporarily unavailable. Try again.",
    );
    expect(summary.railEmpty("pets")).toBe(false);
    const user = userEvent.setup();
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Edit food preferences",
      }),
    );
    const draft = within_("food-preferences").getByLabelText(
      "Food, allergy, and dietary preferences",
    );
    await waitFor(() => expect(document.activeElement).toBe(draft));
    await user.clear(draft);
    await user.type(draft, "Keep this food draft");
    const savedFood = block("food-preferences").querySelector(
      "[data-profile-fact-list] li",
    );
    const otherReads = () =>
      fetch.calls().filter((call) => !call.includes("/facts/pets")).length;
    const initialOtherReads = otherReads();
    const retryButton = retryOf("pets")!;
    await user.click(retryButton);
    await user.click(retryButton);
    expect(petReads).toBe(2);
    // The retry stays in place, unavailable, while it runs.
    expect(retryOf("pets")).toBe(retryButton);
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect(block("pets").dataset.sectionState).toBe("loading");
    await act(async () => {
      retry.resolve(problem(503));
      await retry.promise;
    });
    await waitFor(() =>
      expect(block("pets").dataset.sectionState).toBe("error")
    );
    await waitFor(() => expect(document.activeElement).toBe(retryButton));
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(block("pets").textContent).not.toContain("Private failure details");
    await user.click(retryButton);
    await waitFor(() =>
      expect(block("pets").dataset.sectionState).toBe("ready")
    );
    expect(block("pets").textContent).toContain("Mochi");
    expect(block("pets").textContent).toContain("Enjoys the garden");
    expect(retryOf("pets")).toBeNull();
    expect(document.activeElement).toBe(stateOf("pets"));
    expect(formOf("food-preferences").hidden).toBe(false);
    expect((draft as HTMLTextAreaElement).value).toBe("Keep this food draft");
    expect(
      block("food-preferences").querySelector("[data-profile-fact-list] li"),
    ).toBe(savedFood);
    expect(otherReads()).toBe(initialOtherReads);
    expect(confirm).not.toHaveBeenCalled();
    expect(unloadBlocked()).toBe(true);
    await user.click(
      within_("food-preferences").getByRole("button", { name: "Cancel" }),
    );
    await user.click(
      within_("pets").getByRole("button", { name: "Edit Mochi" }),
    );
    await waitFor(() =>
      expect(
        (within_("pets").getByLabelText("Pet name") as HTMLInputElement).value,
      ).toBe("Mochi")
    );
  });

  it.each([...RAIL, "tags"])(
    "APR-003 recovers an empty %s block",
    async (section) => {
      let reads = 0;
      stubFetch(() => {
        reads++;
        if (reads === 1) throw new Error("Offline");
        return factRead([]);
      });
      await mountAll([section]);
      await userEvent.setup().click(retryOf(section)!);
      await waitFor(() =>
        expect(block(section).dataset.sectionState).toBe("ready")
      );
      expect(block(section).hidden).toBe(false);
      expect(stateOf(section).textContent).toBe(
        `No ${section.replaceAll("-", " ")} saved.`,
      );
      expect(retryOf(section)).toBeNull();
      expect(
        block(section).querySelector<HTMLButtonElement>(
          "[data-profile-fact-add]",
        )!.hidden,
      ).toBe(false);
    },
  );

  it.each(["archived", "hidden", 401, 403] as const)(
    "APR-003 stops retrying when recovery resolves to %s",
    async (outcome) => {
      let reads = 0;
      const hiddenEvents: unknown[] = [];
      document.addEventListener(SECTION_HIDDEN_EVENT, (event) => {
        hiddenEvents.push((event as CustomEvent).detail);
      });
      const fetch = stubFetch(() => {
        reads++;
        if (reads === 1) throw new Error("Offline");
        return typeof outcome === "number"
          ? problem(outcome)
          : factRead([], { status: outcome });
      });
      await mountAll(["contact-methods"]);
      await userEvent.setup().click(retryOf("contact-methods")!);
      const root = block("contact-methods");
      await waitFor(() =>
        expect(root.dataset.sectionState).toBe(
          typeof outcome === "number"
            ? "forbidden"
            : outcome === "archived"
            ? "read-only"
            : "hidden",
        )
      );
      expect(retryOf("contact-methods")).toBeNull();
      expect(
        root.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!
          .hidden,
      ).toBe(true);
      expect(formOf("contact-methods").hidden).toBe(true);
      expect(root.querySelectorAll("[data-profile-fact-list] button"))
        .toHaveLength(0);
      expect(root.hidden).toBe(outcome === "hidden");
      expect(root.textContent).not.toContain("Private failure details");
      expect(fetch.mock).toHaveBeenCalledTimes(2);
      if (typeof outcome === "number") {
        expect(stateOf("contact-methods").textContent).toBe(
          "Your active workspace no longer permits this action.",
        );
      }
      expect(hiddenEvents).toEqual(
        outcome === "hidden" ? [{ sectionId: "contact-methods" }] : [],
      );
    },
  );

  it("APR-003 guards a local draft before retry and clears stale controls on denial", async () => {
    const confirm = guard();
    const record = food("Saved preference");
    let reads = 0;
    stubFetch((_url, init) => {
      if (init?.method === "PUT") {
        return response({ personUpdatedAt: revision, record, status: "saved" });
      }
      reads++;
      if (reads === 2) throw new Error("Offline");
      if (reads > 2) return problem(403);
      return factRead([record]);
    });
    await mountAll(["food-preferences"]);
    const root = block("food-preferences");
    const user = userEvent.setup();
    const add = within_("food-preferences").getByRole("button", {
      name: "Edit food preferences",
    });
    await user.click(add);
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Save profile fact",
      }),
    );
    await waitFor(() => expect(root.dataset.sectionState).toBe("error"));
    await user.click(add);
    const draft = within_("food-preferences").getByLabelText(
      "Food, allergy, and dietary preferences",
    );
    await waitFor(() => expect(document.activeElement).toBe(draft));
    await user.clear(draft);
    await user.type(draft, "Unsaved local changes");
    const retry = retryOf("food-preferences")!;
    await user.click(retry);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      "Discard unsaved changes in this section and retry loading it?",
    );
    expect(reads).toBe(2);
    expect(formOf("food-preferences").hidden).toBe(false);
    expect((draft as HTMLTextAreaElement).value).toBe("Unsaved local changes");
    expect(document.activeElement).toBe(draft);
    confirm.mockReturnValue(true);
    await user.click(retry);
    await waitFor(() => expect(root.dataset.sectionState).toBe("forbidden"));
    expect(root.textContent).not.toContain("Saved preference");
    expect(retryOf("food-preferences")).toBeNull();
    expect(add.hidden).toBe(true);
    expect(formOf("food-preferences").hidden).toBe(true);
    expect(formOf("food-preferences").querySelector("textarea")).toBeNull();
    expect(root.querySelector("[data-profile-fact-list]")!.childElementCount)
      .toBe(0);
    expect(document.activeElement).toBe(stateOf("food-preferences"));
  });

  it.each(
    [
      ["add", "success"],
      ["edit", "success"],
      ["add", "failure"],
      ["edit", "failure"],
    ] as const,
  )(
    "APR-003 locks %s during post-save Retry and unlocks after %s",
    async (action, outcome) => {
      const confirm = guard();
      const record = food("Saved preference");
      const updated = food("Updated preference");
      let reads = 0;
      const pending = deferred<Response>();
      stubFetch((url, init) => {
        if (init?.method === "PUT") {
          return response({
            personUpdatedAt: revision,
            record: updated,
            status: "saved",
          });
        }
        if (sectionOf(url) === "food-preferences") {
          reads++;
          if (reads === 2) throw new Error("Refresh failed");
          if (reads === 3) return pending.promise;
          return factRead([reads > 3 ? updated : record]);
        }
        return factRead([]);
      });
      await mountAll(["food-preferences", "pets"]);
      const root = block("food-preferences");
      const user = userEvent.setup();
      const add = within_("food-preferences").getByRole<HTMLButtonElement>(
        "button",
        {
          name: "Edit food preferences",
        },
      );
      await user.click(add);
      const field = within_("food-preferences").getByLabelText(
        "Food, allergy, and dietary preferences",
      );
      await user.clear(field);
      await user.type(field, "Updated preference");
      await user.click(
        within_("food-preferences").getByRole("button", {
          name: "Save profile fact",
        }),
      );
      await waitFor(() => expect(root.dataset.sectionState).toBe("error"));
      const edit = () =>
        within_("food-preferences").getByRole("button", {
          name: /^Edit Saved preference/,
        });
      const opener = action === "add" ? add : edit();
      const retry = retryOf("food-preferences") as HTMLButtonElement;
      await user.click(retry);
      expect(root.dataset.sectionState).toBe("loading");
      expect((opener as HTMLButtonElement).disabled).toBe(true);
      expect(retry.disabled).toBe(true);
      await user.click(opener);
      expect(formOf("food-preferences").hidden).toBe(true);
      await user.click(
        within_("pets").getByRole("button", { name: "Add pets" }),
      );
      const neighbor = formOf("pets");
      await waitFor(() => expect(neighbor.hidden).toBe(false));
      const draft = within_("pets").getByLabelText("Pet notes");
      await user.type(draft, "Draft made while the other section retries");
      await act(async () => {
        pending.resolve(
          outcome === "success" ? factRead([updated]) : problem(503),
        );
        await pending.promise;
      });
      await waitFor(() =>
        expect(root.dataset.sectionState).toBe(
          outcome === "success" ? "ready" : "error",
        )
      );
      expect(formOf("food-preferences").hidden).toBe(true);
      expect(neighbor.hidden).toBe(false);
      expect((draft as HTMLTextAreaElement).value).toBe(
        "Draft made while the other section retries",
      );
      expect(confirm).not.toHaveBeenCalled();
      expect(add.disabled).toBe(false);
      if (outcome === "failure") expect(retry.disabled).toBe(false);
      await user.click(within_("pets").getByRole("button", { name: "Cancel" }));
      const restored = action === "add"
        ? add
        : within_("food-preferences").getByRole("button", {
          name: /^Edit (Saved|Updated) preference/,
        });
      expect((restored as HTMLButtonElement).disabled).toBe(false);
      await user.click(restored);
      const reopened = within_("food-preferences").getByLabelText(
        "Food, allergy, and dietary preferences",
      ) as HTMLTextAreaElement;
      await waitFor(() =>
        expect(reopened.value).toBe(
          outcome === "success" ? "Updated preference" : "Saved preference",
        )
      );
      await user.type(reopened, " and more");
      expect(unloadBlocked()).toBe(true);
    },
  );

  it.each(
    [
      ["food-preferences", "pets", "clean"],
      ["food-preferences", "pets", "declined"],
      ["food-preferences", "pets", "accepted"],
      ["pets", "food-preferences", "clean"],
      ["pets", "food-preferences", "declined"],
      ["pets", "food-preferences", "accepted"],
      ["food-preferences", "food-preferences", "declined"],
      ["food-preferences", "food-preferences", "accepted"],
    ] as const,
  )("APR-002 guards %s to %s when %s", async (from, to, decision) => {
    const confirm = guard(() => decision === "accepted");
    stubFetch(() => factRead([]));
    await mountAll(["food-preferences", "pets"]);
    const user = userEvent.setup();
    const addOf = (section: string) =>
      block(section).querySelector<HTMLButtonElement>(
        "[data-profile-fact-add]",
      )!;
    await user.click(addOf(from));
    const form = formOf(from);
    await waitFor(() => expect(form.hidden).toBe(false));
    const field = form.querySelector("textarea")!;
    await user.click(field);
    if (decision !== "clean") await user.type(field, "Keep this draft");
    await user.click(addOf(to));
    const targetForm = formOf(to);
    if (decision === "declined") {
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledWith(
        "You have unsaved changes in this editor. Discard them and open another editor?",
      );
      expect(form.hidden).toBe(false);
      expect(field.value).toBe("Keep this draft");
      expect(document.activeElement).toBe(field);
      if (from !== to) expect(targetForm.hidden).toBe(true);
    } else {
      await waitFor(() => expect(targetForm.hidden).toBe(false));
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
      if (from !== to) {
        expect(form.hidden).toBe(true);
        expect(form.querySelector("textarea")).toBeNull();
      } else {
        expect(form.querySelector("textarea")!.value).toBe("");
      }
      await waitFor(() =>
        expect(document.activeElement).toBe(
          targetForm.querySelector("input, select, textarea"),
        )
      );
    }
    const active = decision === "declined" ? form : targetForm;
    await user.click(within(active).getByRole("button", { name: "Cancel" }));
    expect(active.hidden).toBe(true);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        addOf(decision === "declined" ? from : to),
      )
    );
    expect(stateOf(decision === "declined" ? from : to).textContent).toBe(
      "Edit cancelled. No changes were saved.",
    );
    expect(unloadBlocked()).toBe(false);
  });

  it.each(["clean", "declined", "accepted"] as const)(
    "APR-002 guards replacing a saved pet with another record when %s",
    async (decision) => {
      const confirm = guard(() => decision === "accepted");
      const records = ["First", "Second"].map((name, index) =>
        fact("pets", { name }, `00000000-0000-4000-8000-00000000010${index}`)
      );
      const fetch = stubFetch((url, init) => {
        if (init?.method === "PUT") {
          return response({
            personUpdatedAt: nextRevision,
            record: records[1],
            status: "saved",
          });
        }
        return factRead(sectionOf(url) === "pets" ? records : []);
      });
      await mountAll(["pets"]);
      const user = userEvent.setup();
      await user.click(
        within_("pets").getByRole("button", { name: "Edit First" }),
      );
      const name = () =>
        within_("pets").getByLabelText("Pet name") as HTMLInputElement;
      await waitFor(() => expect(name().value).toBe("First"));
      const notes = within_("pets").getByLabelText("Pet notes");
      await user.click(notes);
      if (decision !== "clean") await user.type(notes, "First pet draft");
      await user.click(
        within_("pets").getByRole("button", { name: "Edit Second" }),
      );
      if (decision === "declined") {
        expect(name().value).toBe("First");
        expect((notes as HTMLTextAreaElement).value).toBe("First pet draft");
        expect(document.activeElement).toBe(notes);
      } else {
        await waitFor(() => expect(name().value).toBe("Second"));
        expect(
          (within_("pets").getByLabelText("Pet notes") as HTMLTextAreaElement)
            .value,
        ).toBe("");
        await waitFor(() => expect(document.activeElement).toBe(name()));
        await user.click(
          within_("pets").getByRole("button", { name: "Save profile fact" }),
        );
        await waitFor(() =>
          expect(fetch.calls()).toContain(
            `PUT /api/v1/people/${personId}/facts/pets/${records[1]!.id}`,
          )
        );
        expect(fetch.bodies()[0]).toMatchObject({
          expectedPersonUpdatedAt: revision,
          expectedUpdatedAt: revision,
          id: records[1]!.id,
          name: "Second",
          section: "pets",
        });
      }
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
    },
  );

  it("APR-002 serializes option preparation and unlocks after its failure", async () => {
    const confirm = guard(() => true);
    const options = deferred<Response>();
    stubFetch((url) =>
      url.searchParams.has("includeOptions") ? options.promise : factRead([])
    );
    await mountAll(["food-preferences", "pets"]);
    const user = userEvent.setup();
    await user.click(within_("pets").getByRole("button", { name: "Add pets" }));
    expect(formOf("pets").inert).toBe(true);
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Add food preferences",
      }),
    );
    expect(formOf("food-preferences").hidden).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    await act(async () => {
      options.resolve(problem(503));
      await options.promise;
    });
    await waitFor(() => expect(formOf("pets").inert).toBe(false));
    expect(formOf("pets").hidden).toBe(true);
    expect(stateOf("pets").textContent).toBe(
      "Profile options are temporarily unavailable. No changes were saved.",
    );
    expect(
      within_("pets").getByRole<HTMLButtonElement>("button", {
        name: "Add pets",
      }).disabled,
    ).toBe(false);
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Add food preferences",
      }),
    );
    await waitFor(() => expect(formOf("food-preferences").hidden).toBe(false));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        formOf("food-preferences").querySelector("textarea"),
      )
    );
  });

  it.each(
    ["transport", "validation", "forbidden", "conflict", "server"] as const,
  )(
    "APR-001 protects a pending and %s-failed draft until a successful retry",
    async (failure) => {
      shell(railBlock("food-preferences"));
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      let writes = 0;
      let saved = false;
      const first = deferred<void>();
      const record = food("Vegetarian");
      stubFetch(async (_url, init) => {
        if (init?.method === "POST" || init?.method === "PUT") {
          writes++;
          if (writes === 1) {
            await first.promise;
            if (failure === "transport") throw new Error("Offline");
            return problem(
              {
                conflict: 409,
                forbidden: 403,
                server: 503,
                validation: 400,
              }[failure],
              "Save rejected.",
            );
          }
          saved = true;
          return response({
            personUpdatedAt: revision,
            record,
            status: "saved",
          });
        }
        return factRead(saved ? [record] : []);
      });
      await mountFacts(mountFoodPreferences);
      const user = userEvent.setup();
      await user.click(
        within_("food-preferences").getByRole("button", {
          name: "Add food preferences",
        }),
      );
      const form = formOf("food-preferences");
      const field = within(form).getByLabelText(
        "Food, allergy, and dietary preferences",
      ) as HTMLTextAreaElement;
      await user.type(field, "Vegetarian");
      await user.click(
        within(form).getByRole("button", { name: "Save profile fact" }),
      );
      await waitFor(() => expect(form.inert).toBe(true));
      expect(unloadBlocked()).toBe(true);
      await act(async () => {
        first.resolve();
        await first.promise;
      });
      await waitFor(() => expect(form.inert).toBe(false));
      expect(form.hidden).toBe(false);
      const notice = form.querySelector<HTMLElement>(
        "[data-profile-fact-form-state]",
      )!;
      await waitFor(() =>
        expect(notice.textContent).toBe(
          failure === "transport"
            ? "Save is temporarily unavailable."
            : "Save rejected.",
        )
      );
      expect(document.activeElement).toBe(notice);
      expect(unloadBlocked()).toBe(true);
      vi.stubGlobal("confirm", vi.fn(() => false));
      expect(requestWorkspaceChange(workspaceId, "another-workspace").allowed)
        .toBe(false);
      expect(field.value).toBe("Vegetarian");
      await user.click(
        within(form).getByRole("button", { name: "Save profile fact" }),
      );
      await waitFor(() => expect(form.hidden).toBe(true));
      expect(writes).toBe(2);
      expect(unloadBlocked()).toBe(false);
    },
  );

  it("closes an open editor without stealing focus when another opens", async () => {
    guard(() => true);
    stubFetch(() => factRead([]));
    await mountAll(["food-preferences", "addresses"]);
    const user = userEvent.setup();
    const foodAdd = within_("food-preferences").getByRole("button", {
      name: "Add food preferences",
    });
    await user.click(foodAdd);
    await user.type(
      within_("food-preferences").getByLabelText(
        "Food, allergy, and dietary preferences",
      ),
      "Unsaved draft",
    );
    const reset = vi.fn();
    formOf("food-preferences").addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(foodAdd, "focus");
    await user.click(
      within_("addresses").getByRole("button", { name: "Add addresses" }),
    );
    await waitFor(() => expect(formOf("addresses").hidden).toBe(false));
    expect(formOf("food-preferences").hidden).toBe(true);
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within_("addresses").getByLabelText("Address name"),
      )
    );
  });

  it("propagates tag and food revisions to every mounted consumer", async () => {
    let current = revision;
    const revisions: string[] = [];
    document.addEventListener("person-revision-changed", (event) => {
      revisions.push(
        (event as CustomEvent<{ personUpdatedAt: string }>).detail
          .personUpdatedAt,
      );
    });
    const fetch = stubFetch((url, init) => {
      if (url.pathname.endsWith("/tag-options")) {
        return response({ options: [], status: "ready" });
      }
      const section = sectionOf(url)!;
      const value = section === "tags"
        ? { tagIds: [] }
        : { foodPreferences: "Coffee" };
      if (init?.method === "POST" || init?.method === "PUT") {
        current = current === revision
          ? nextRevision
          : "2026-08-16T12:00:00.000002Z";
        return response({
          personUpdatedAt: current,
          record: { ...fact(section, value), updatedAt: current },
          status: "saved",
        });
      }
      return response({
        options: [],
        personUpdatedAt: current,
        records: [{ ...fact(section, value), updatedAt: current }],
        status: "ready",
      });
    });
    await mountAll(["tags", "food-preferences"]);
    const user = userEvent.setup();
    await user.click(
      within_("tags").getByRole("button", { name: "Edit tags" }),
    );
    await waitFor(() => expect(formOf("tags").hidden).toBe(false));
    await user.click(
      within_("tags").getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(revisions).toEqual([nextRevision]));
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Edit food preferences",
      }),
    );
    const field = within_("food-preferences").getByLabelText(
      "Food, allergy, and dietary preferences",
    );
    await user.clear(field);
    await user.type(field, "Tea");
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Save profile fact",
      }),
    );
    await waitFor(() => expect(revisions).toHaveLength(2));
    const [tags, foodSave] = fetch.bodies();
    expect(tags?.expectedPersonUpdatedAt).toBe(revision);
    expect(foodSave?.expectedPersonUpdatedAt).toBe(nextRevision);
    expect(foodSave?.expectedUpdatedAt).toBe(nextRevision);
  });

  it("does not let an older delayed section response regress the shared revision", async () => {
    const contact = deferred<Response>();
    let tagSaved = false;
    const tagRevisions: unknown[] = [];
    stubFetch((url, init) => {
      if (url.pathname.endsWith("/tag-options")) {
        return response({ options: [], status: "ready" });
      }
      const section = sectionOf(url);
      if (section === "contact-methods") return contact.promise;
      if (init?.method === "POST" || init?.method === "PUT") {
        tagRevisions.push(
          JSON.parse(String(init.body)).expectedPersonUpdatedAt,
        );
        tagSaved = true;
        return response({
          personUpdatedAt: nextRevision,
          record: { ...fact("tags", { tagIds: [] }), updatedAt: nextRevision },
          status: "saved",
        });
      }
      const at = tagSaved ? nextRevision : revision;
      return response({
        options: [],
        personUpdatedAt: at,
        records: [{ ...fact("tags", { tagIds: [] }), updatedAt: at }],
        status: "ready",
      });
    });
    shell(railBlock("contact-methods"), tagsBlock());
    const pendingContacts = mountFactsLater(mountContactMethods);
    await mountFacts(mountTags);
    const user = userEvent.setup();
    const saveTags = async () => {
      await user.click(
        within_("tags").getByRole("button", { name: "Edit tags" }),
      );
      await waitFor(() => expect(formOf("tags").hidden).toBe(false));
      await user.click(
        within_("tags").getByRole("button", { name: "Save profile fact" }),
      );
    };
    await saveTags();
    await waitFor(() =>
      expect(stateOf("tags").textContent).toBe(
        "No tags saved. Profile fact saved.",
      )
    );
    await act(async () => {
      contact.resolve(factRead([]));
      await pendingContacts;
    });
    await saveTags();
    await waitFor(() => expect(tagRevisions).toEqual([revision, nextRevision]));
  });

  it("maps unavailable and forbidden reads, and a read-only section", async () => {
    stubFetch(() => problem(503, "Private"));
    await mountAll(["contact-methods"]);
    expect(block("contact-methods").dataset.sectionState).toBe("error");
    unmountFacts();
    stubFetch(() => problem(403, "Private"));
    await mountAll(["contact-methods"]);
    expect(block("contact-methods").dataset.sectionState).toBe("forbidden");
    expect(document.body.textContent).not.toContain("Private");
    unmountFacts();
    stubFetch(() =>
      factRead([
        fact("contact-methods", {
          isPrimary: false,
          labelIds: [],
          typeId: personId,
          value: "ada@example.test",
        }),
      ], { status: "archived" })
    );
    await mountAll(["contact-methods"], { archived: true });
    const root = block("contact-methods");
    expect(root.dataset.sectionState).toBe("read-only");
    expect(
      root.querySelector<HTMLButtonElement>("[data-profile-fact-add]")!.hidden,
    )
      .toBe(true);
    expect(root.textContent).toContain("ada@example.test");
    expect(within(root).queryByRole("button", { name: /Edit|Delete/ }))
      .toBeNull();
  });

  it("hides a module turned off since the page loaded, and one already off without asking", async () => {
    stubFetch(() => factRead([], { status: "hidden" }));
    await mountAll(["pets"]);
    expect(block("pets").hidden).toBe(true);
    expect(block("pets").dataset.sectionState).toBe("hidden");
    expect(block("pets").querySelector("[data-profile-fact-list]")?.children)
      .toHaveLength(0);
    unmountFacts();
    const fetch = stubFetch(() => factRead([]));
    await mountAll(["pets"], { hidden: ["pets"] });
    expect(block("pets").hidden).toBe(true);
    expect(block("pets").dataset.sectionState).toBe("hidden");
    expect(fetch.mock).not.toHaveBeenCalled();
  });

  it("reads again, read-only, when the person is archived", async () => {
    let archived = false;
    stubFetch(() =>
      factRead([food("Tea")], { status: archived ? "archived" : "ready" })
    );
    await mountAll(["food-preferences"]);
    const user = userEvent.setup();
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Edit food preferences",
      }),
    );
    await waitFor(() => expect(formOf("food-preferences").hidden).toBe(false));
    archived = true;
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId },
        }),
      );
    });
    await waitFor(() =>
      expect(block("food-preferences").dataset.sectionState).toBe("read-only")
    );
    expect(formOf("food-preferences").hidden).toBe(true);
    expect(
      within_("food-preferences").queryByRole("button", {
        name: /Edit|Clear|Add/,
      }),
    ).toBeNull();
    expect(block("food-preferences").textContent).toContain("Tea");
  });

  it("APR-006 labels bounded pages as previews and keeps a known total while paging", async () => {
    stubFetch((url) =>
      factRead([
        fact("pets", {
          name: url.searchParams.has("cursor") ? "Byron" : "Mochi",
        }),
      ], url.searchParams.has("cursor") ? {} : { nextCursor: "next-page" })
    );
    await mountAll(["pets"], {
      sectionCounts: [{ count: 2, id: "pets", status: "ready" }],
    });
    expect(summary.railCount("pets")).toBe("2");
    expect(stateOf("pets").textContent).toBe("Showing 1 of 2 saved.");
    const user = userEvent.setup();
    await user.click(
      within_("pets").getByRole("button", { name: "Next pets" }),
    );
    await waitFor(() => expect(block("pets").textContent).toContain("Byron"));
    expect(within_("pets").queryByRole("button", { name: "Next pets" }))
      .toBeNull();
    expect(summary.railCount("pets")).toBe("2");
    expect(stateOf("pets").textContent).toBe("Showing 1 of 2 saved.");
    await user.click(
      within_("pets").getByRole("button", { name: "Previous pets" }),
    );
    await waitFor(() => expect(block("pets").textContent).toContain("Mochi"));
    expect(within_("pets").queryByRole("button", { name: "Previous pets" }))
      .toBeNull();
  });

  it("says when a further page cannot load and keeps the page it shows", async () => {
    stubFetch((url) =>
      url.searchParams.has("cursor")
        ? problem(503)
        : factRead([mochi], { nextCursor: "next-page" })
    );
    await mountAll(["pets"]);
    expect(stateOf("pets").textContent).toBe("Showing 1 on this page.");
    expect(summary.railCount("pets")).toBe("1 on this page");
    await userEvent.setup().click(
      within_("pets").getByRole("button", { name: "Next pets" }),
    );
    await waitFor(() =>
      expect(stateOf("pets").textContent).toBe(
        "That profile fact page is temporarily unavailable.",
      )
    );
    expect(block("pets").textContent).toContain("Mochi");
  });

  it("says why a delete failed and keeps the record", async () => {
    stubFetch((_url, init) =>
      init?.method === "DELETE"
        ? problem(409, "The pet changed. Reload it.")
        : factRead([mochi])
    );
    await mountAll(["pets"]);
    const user = userEvent.setup();
    await user.click(
      within_("pets").getByRole("button", { name: "Delete Mochi" }),
    );
    await user.click(
      within_("pets").getByRole("button", { name: "Confirm delete Mochi" }),
    );
    await waitFor(() =>
      expect(stateOf("pets").textContent).toBe("The pet changed. Reload it.")
    );
    expect(block("pets").textContent).toContain("Mochi");
  });

  it("APR-004 closes a phone's sheet before a saved fact focuses the status line", async () => {
    guard(() => false);
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: () => undefined,
      matches: true,
      removeEventListener: () => undefined,
    }));
    const dialogs = HTMLDialogElement.prototype as unknown as Record<
      string,
      unknown
    >;
    dialogs.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    // As a browser does: while a modal sheet is open, nothing outside it can
    // take focus.
    const focus = HTMLElement.prototype.focus;
    const modalFocus = vi.spyOn(HTMLElement.prototype, "focus")
      .mockImplementation(function (this: HTMLElement, options) {
        const sheet = document.querySelector("dialog[open]");
        if (sheet && !sheet.contains(this)) return;
        focus.call(this, options);
      });
    let saved = false;
    stubFetch((_url, init) => {
      if (init?.method === "POST") {
        saved = true;
        return response({
          personUpdatedAt: nextRevision,
          record: food("Tea"),
          status: "saved",
        });
      }
      return factRead(saved ? [food("Tea")] : []);
    });
    try {
      await mountAll(["food-preferences"]);
      const user = userEvent.setup();
      await user.click(
        within_("food-preferences").getByRole("button", {
          name: "Add food preferences",
        }),
      );
      await waitFor(() =>
        expect(document.querySelector("dialog.profile-rail-dialog"))
          .not.toBeNull()
      );
      const form = formOf("food-preferences");
      await user.type(
        within(form).getByLabelText("Food, allergy, and dietary preferences"),
        "Tea",
      );
      // WebKit does not focus a button it clicks: the field keeps focus.
      await act(() => {
        within(form).getByRole("button", { name: "Save profile fact" })
          .click();
        return Promise.resolve();
      });
      await waitFor(() =>
        expect(stateOf("food-preferences").textContent).toBe(
          "Profile fact saved.",
        )
      );
      expect(document.querySelector("dialog.profile-rail-dialog")).toBeNull();
      await waitFor(() =>
        expect(document.activeElement).toBe(stateOf("food-preferences"))
      );
    } finally {
      modalFocus.mockRestore();
    }
  });

  it("presents the editor as a modal sheet on a phone and keeps its draft", async () => {
    guard(() => false);
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: () => undefined,
      matches: true,
      removeEventListener: () => undefined,
    }));
    const dialogs = HTMLDialogElement.prototype as unknown as Record<
      string,
      unknown
    >;
    dialogs.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    stubFetch(() => factRead([]));
    await mountAll(["food-preferences"]);
    const user = userEvent.setup();
    await user.click(
      within_("food-preferences").getByRole("button", {
        name: "Add food preferences",
      }),
    );
    const sheet = await waitFor(() => {
      const dialog = document.querySelector("dialog.profile-rail-dialog");
      expect(dialog).not.toBeNull();
      return dialog!;
    });
    const form = formOf("food-preferences");
    expect(sheet.contains(form)).toBe(true);
    expect(sheet.getAttribute("aria-labelledby")).toBe(
      "profile-section-food-preferences-editor-heading",
    );
    const field = within(form).getByLabelText(
      "Food, allergy, and dietary preferences",
    );
    await user.type(field, "Keep this draft");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.querySelector("dialog.profile-rail-dialog")).toBeNull()
    );
    expect(block("food-preferences").lastElementChild).toBe(form);
    expect(form.hidden).toBe(true);
  });
});
