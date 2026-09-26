// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { drawShell } from "../testing/render.tsx";
import { LOADING_LABEL, loadMoreControls, mountLoadMore } from "./load-more.ts";

const controlHtml =
  '<button data-load-more="files" hidden>Load more files</button>';

function markup(count = 1): void {
  drawShell(controlHtml.repeat(count));
}

function controls(): readonly HTMLButtonElement[] {
  return loadMoreControls("files");
}

describe("GAP-023 the load-more control", () => {
  it("stays hidden until a page answers with a cursor, and hides again after the last one", () => {
    markup();
    const control = mountLoadMore("files", () => Promise.resolve());
    expect(controls()[0]?.hidden).toBe(true);
    control.present("page-2");
    expect(controls()[0]?.hidden).toBe(false);
    expect(control.cursor).toBe("page-2");
    control.present(undefined);
    expect(controls()[0]?.hidden).toBe(true);
    expect(control.cursor).toBeUndefined();
  });

  it("passes the offered cursor to the loader and does nothing without one", async () => {
    markup();
    const load = vi.fn().mockResolvedValue(undefined);
    const control = mountLoadMore("files", load);
    controls()[0]!.click();
    expect(load).not.toHaveBeenCalled();
    control.present("page-2");
    controls()[0]!.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith("page-2"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("announces the load, refuses a second click while it runs, and restores the label", async () => {
    markup();
    let release!: () => void;
    const load = vi.fn().mockImplementation(() =>
      new Promise<void>((resolve) => release = resolve)
    );
    const control = mountLoadMore("files", load);
    control.present("page-2");
    const button = controls()[0]!;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe(LOADING_LABEL));
    // Disabling the button would drop a keyboard user's focus to the body,
    // so a load only marks it unavailable.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    button.click();
    expect(load).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(button.textContent).toBe("Load more files"));
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("restores the label even when the page fails", async () => {
    markup();
    const control = mountLoadMore(
      "files",
      () => Promise.reject(new Error("offline")),
    );
    control.present("page-2");
    const button = controls()[0]!;
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Load more files"));
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute("aria-disabled")).toBe(false);
  });

  it("keeps focus on the control across a load that offers another page", async () => {
    markup();
    let release!: () => void;
    const control = mountLoadMore(
      "files",
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            control.present("page-3");
            resolve();
          };
        }),
    );
    control.present("page-2");
    const button = controls()[0]!;
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe(LOADING_LABEL));
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    release();
    await vi.waitFor(() => expect(button.textContent).toBe("Load more files"));
    expect(button.hidden).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("moves focus to the list it extends when the last page hides it", async () => {
    drawShell(
      '<ul id="file-list"><li>One</li></ul><button data-load-more="files" aria-controls="file-list" hidden>Load more files</button>',
    );
    const control = mountLoadMore("files", () => {
      control.present(undefined);
      return Promise.resolve();
    });
    control.present("page-2");
    const button = controls()[0]!;
    button.focus();
    button.click();
    await vi.waitFor(() => expect(button.hidden).toBe(true));
    const list = document.getElementById("file-list")!;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves focus alone when the hidden control did not have it", () => {
    drawShell(
      '<ul id="file-list"></ul><button data-load-more="files" aria-controls="file-list" hidden>Load more files</button><input id="elsewhere">',
    );
    const control = mountLoadMore("files", () => Promise.resolve());
    control.present("page-2");
    const elsewhere = document.getElementById("elsewhere")!;
    elsewhere.focus();
    control.present(undefined);
    expect(document.activeElement).toBe(elsewhere);
    expect(document.getElementById("file-list")!.hasAttribute("tabindex"))
      .toBe(false);
  });

  it("drives every control rendered for one listing", async () => {
    markup(2);
    const load = vi.fn().mockResolvedValue(undefined);
    const control = mountLoadMore("files", load);
    control.present("page-2");
    expect(controls().map((button) => button.hidden)).toEqual([false, false]);
    controls()[1]!.click();
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith("page-2"));
    control.present(undefined);
    expect(controls().map((button) => button.hidden)).toEqual([true, true]);
  });

  it("mounts without a control and stays silent", () => {
    drawShell("");
    const load = vi.fn();
    const control = mountLoadMore("files", load);
    control.present("page-2");
    expect(control.cursor).toBe("page-2");
    expect(load).not.toHaveBeenCalled();
  });

  it("stops listening once the surface's signal aborts", async () => {
    markup();
    const abort = new AbortController();
    const load = vi.fn().mockResolvedValue(undefined);
    const control = mountLoadMore("files", load, { signal: abort.signal });
    control.present("page-2");
    abort.abort();
    controls()[0]!.click();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });
});
