// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountRailEditorPresentation,
  RAIL_DIALOG_TEMPLATE_ID,
} from "./rail-editor-presentation.ts";
import { requestRailEditorOpen } from "../../lib/rail-editors.ts";
import { requestFormDiscard } from "../../lib/unsaved-changes.ts";

// happy-dom changes a form's proxy identity on reparenting. Exercise the real
// guard plus native focus/modality in APR-004; isolate policy routing here.
vi.mock(
  "../../lib/unsaved-changes.ts",
  () => ({ requestFormDiscard: vi.fn(() => true) }),
);

/** The sheet template `person-profile-shell.astro` draws once per page. */
const RAIL_DIALOG_TEMPLATE =
  `<template id="${RAIL_DIALOG_TEMPLATE_ID}"><dialog class="profile-rail-dialog" aria-modal="true"><h2></h2></dialog></template>`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(requestFormDiscard).mockReset().mockReturnValue(true);
});

function setup(
  isMobile = true,
  withFeedback = false,
  template: boolean | string = true,
) {
  document.body.innerHTML = `${
    template === true ? RAIL_DIALOG_TEMPLATE : template || ""
  }<main><section id="pets" class="profile-rail-block" tabindex="-1">
    <header class="profile-section-heading"><h3>Pets</h3></header>
    <button class="profile-rail-add">Add pet</button><button id="edit">Edit pet</button>
    ${
    withFeedback
      ? '<p data-rail-editor-feedback tabindex="-1">Section feedback</p>'
      : ""
  }
    <form hidden><input name="name"><textarea name="notes"></textarea>
      <label hidden><input name="hidden"></label><button disabled>Unavailable</button>
      <p tabindex="-1">Status</p><button type="submit">Save</button><button type="button">Cancel</button>
    </form></section></main>`;
  const media = Object.assign(new EventTarget(), { matches: isMobile });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  // These tests cover ownership/lifecycle; real modality and geometry are
  // exercised by APR-004 in Chromium rather than simulated by happy-dom.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
    [new DOMRect(0, 0, 100, 30)] as unknown as DOMRectList,
  );
  const root = document.querySelector("main")!;
  const section = document.querySelector<HTMLElement>("section")!;
  const form = document.querySelector("form")!;
  const first = form.querySelector("input")!;
  const notes = form.querySelector("textarea")!;
  const edit = document.querySelector<HTMLButtonElement>("#edit")!;
  const add = document.querySelector<HTMLButtonElement>(".profile-rail-add")!;
  const cancel = form.querySelector<HTMLButtonElement>(
    'button[type="button"]',
  )!;
  const discard = vi.fn(() => {
    form.hidden = true;
    form.reset();
  });
  cleanups.push(mountRailEditorPresentation(form, discard));
  const open = async () => {
    edit.focus();
    expect(requestRailEditorOpen(form, false, edit)).toBe(true);
    form.hidden = false;
    first.focus();
    if (media.matches && template === true) {
      await vi.waitFor(() =>
        expect(section.querySelector("dialog")?.open).toBe(true)
      );
    }
  };
  const resize = async (matches: boolean) => {
    media.matches = matches;
    media.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(!!section.querySelector("dialog")).toBe(matches)
    );
  };
  return {
    add,
    cancel,
    discard,
    edit,
    first,
    form,
    notes,
    open,
    resize,
    root,
    section,
  };
}

describe("mobile rail editor presentation", () => {
  it("keeps shared section feedback inside the mobile dialog and restores its desktop position", async () => {
    const { form, open, resize, section } = setup(false, true);
    const feedback = section.querySelector<HTMLElement>(
      "[data-rail-editor-feedback]",
    )!;
    await open();
    expect(feedback.nextElementSibling).toBe(form);
    await resize(true);
    expect(section.querySelector("dialog")!.contains(feedback)).toBe(true);
    feedback.textContent = "Save failed";
    feedback.focus();
    await resize(false);
    expect(feedback.parentElement).toBe(section);
    expect(feedback.nextElementSibling).toBe(form);
    expect(feedback.textContent).toBe("Save failed");
    expect(document.activeElement).toBe(feedback);
    await resize(true);
    form.hidden = true;
    await vi.waitFor(() => expect(section.querySelector("dialog")).toBeNull());
    expect(feedback.parentElement).toBe(section);
    expect(feedback.nextElementSibling).toBe(form);
  });

  it("keeps the original form in the guard root and preserves the draft across viewport changes", async () => {
    const { first, form, notes, open, resize, root, section } = setup(false);
    await open();
    notes.focus();
    notes.value = "Draft";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    await resize(true);
    const dialog = section.querySelector("dialog")!;
    expect(dialog.getAttribute("aria-labelledby")).toBe("pets-editor-heading");
    expect(dialog.querySelector("h2")?.textContent).toBe("Pets");
    expect(dialog.contains(form)).toBe(true);
    expect(root.contains(form)).toBe(true);
    await resize(false);
    expect(form.parentElement).toBe(section);
    expect(notes.value).toBe("Draft");
    first.focus();
    await resize(true);
    expect(notes.value).toBe("Draft");
  });

  it.each(["clean", "declined", "accepted", "pending"])(
    "routes %s Escape through the existing discard policy",
    async (decision) => {
      const { discard, edit, form, notes, open, section } = setup();
      await open();
      if (decision !== "clean") {
        notes.focus();
        notes.value = "Draft";
        notes.dispatchEvent(new Event("input", { bubbles: true }));
      }
      form.inert = decision === "pending";
      vi.mocked(requestFormDiscard).mockClear().mockReturnValue(
        decision === "clean" || decision === "accepted",
      );
      const dialog = section.querySelector("dialog")!;
      expect(dialog.dispatchEvent(new Event("cancel", { cancelable: true })))
        .toBe(false);
      if (decision === "declined" || decision === "pending") {
        expect(discard).not.toHaveBeenCalled();
        expect(dialog.open).toBe(true);
        expect(notes.value).toBe("Draft");
      } else {
        expect(discard).toHaveBeenCalledOnce();
        expect(form.hidden).toBe(true);
        expect(section.querySelector("dialog")).toBeNull();
        expect(document.activeElement).toBe(edit);
        expect(notes.value).toBe("");
      }
      expect(requestFormDiscard).toHaveBeenCalledExactlyOnceWith(
        [form],
        "You have unsaved changes in this editor. Discard them and close the editor?",
      );
    },
  );

  it("loops both keyboard boundaries while ignoring hidden, disabled and status controls", async () => {
    const { cancel, first, form, notes, open, section } = setup();
    await open();
    const dialog = section.querySelector("dialog")!;
    const tab = (shiftKey = false) =>
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey,
          cancelable: true,
        }),
      );
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(cancel);
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(first);
    notes.focus();
    expect(tab()).toBe(true);
    form.querySelector("p")!.focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }),
      ),
    ).toBe(true);
    form.inert = true;
    expect(tab()).toBe(false);
  });

  it.each(["disabled", "detached"])(
    "uses the section's stable Add control when the opener is %s",
    async (state) => {
      const { add, edit, form, open } = setup();
      await open();
      if (state === "disabled") edit.disabled = true;
      else edit.remove();
      form.hidden = true;
      await vi.waitFor(() => expect(document.activeElement).toBe(add));
    },
  );

  it("removes its listeners and modal on disposal without discarding the draft", async () => {
    const { form, notes, open, resize, section } = setup();
    await open();
    notes.value = "Keep";
    cleanups.pop()!();
    expect(form.parentElement).toBe(section);
    expect(section.querySelector("dialog")).toBeNull();
    expect(notes.value).toBe("Keep");
    await resize(false);
    form.hidden = true;
    form.hidden = false;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(section.querySelector("dialog")).toBeNull();
  });

  it("clones the shell's sheet rather than creating one", async () => {
    const create = vi.spyOn(document, "createElement");
    const { form, open, section } = setup();
    await open();
    const dialog = section.querySelector("dialog")!;
    expect(dialog.classList.contains("profile-rail-dialog")).toBe(true);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(form)).toBe(true);
    expect(create).not.toHaveBeenCalled();
    // The template itself stays untouched for the next sheet.
    const template = document.querySelector<HTMLTemplateElement>(
      `#${RAIL_DIALOG_TEMPLATE_ID}`,
    )!;
    expect(template.content.querySelector("dialog")?.children).toHaveLength(1);
  });

  it("keeps the editor inline on a page without the sheet template", async () => {
    const { form, open, section } = setup(true, false, false);
    await open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(section.querySelector("dialog")).toBeNull();
    expect(form.parentElement).toBe(section);
    expect(form.hidden).toBe(false);
  });

  it.each([
    ["without a heading", '<dialog class="profile-rail-dialog"></dialog>'],
    ["that is not a dialog", "<div><h2></h2></div>"],
  ])(
    "keeps the editor inline when the shell's template is %s",
    async (_, content) => {
      const { form, open, section } = setup(
        true,
        false,
        `<template id="${RAIL_DIALOG_TEMPLATE_ID}">${content}</template>`,
      );
      await open();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(section.querySelector("dialog")).toBeNull();
      expect(form.parentElement).toBe(section);
    },
  );

  it("leaves a form outside any rail block alone", () => {
    document.body.innerHTML = "<main><form hidden></form></main>";
    const form = document.querySelector("form")!;
    const dispose = mountRailEditorPresentation(form, vi.fn());
    form.hidden = false;
    expect(document.querySelector("dialog")).toBeNull();
    expect(() => dispose()).not.toThrow();
  });
});
