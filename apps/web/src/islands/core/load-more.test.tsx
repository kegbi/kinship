// @vitest-environment happy-dom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadMore } from "./load-more.tsx";

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

/** A list that grows by the pages `answers` hands out, one per click. */
function Paged(
  props: {
    readonly answers: Array<() => Promise<string | undefined>>;
    readonly first?: string;
    readonly onLoad?: (cursor: string) => void;
  },
) {
  const [cursor, setCursor] = useState<string | undefined>(
    props.first ?? "c1",
  );
  return (
    <>
      <ul id="rows" aria-label="Rows" />
      <LoadMore
        controls="rows"
        cursor={cursor}
        label="Load more rows"
        list="rows"
        onLoad={async (next) => {
          props.onLoad?.(next);
          setCursor(await props.answers.shift()!());
        }}
      />
    </>
  );
}

const control = () =>
  document.querySelector<HTMLButtonElement>('[data-load-more="rows"]')!;

describe("GAP-026 LoadMore", () => {
  it("stays hidden without a cursor and names the list it extends", () => {
    render(
      <LoadMore
        controls="rows"
        cursor={undefined}
        label="Load more rows"
        list="rows"
        onLoad={() => Promise.resolve()}
      />,
    );
    expect(control().hidden).toBe(true);
    expect(control().getAttribute("aria-controls")).toBe("rows");
    expect(control().className).toBe("button-secondary load-more");
  });

  it("passes the offered cursor, announces the load, and refuses a second click", async () => {
    const page = deferred();
    const onLoad = vi.fn();
    render(
      <Paged
        answers={[() => page.promise.then(() => "c2")]}
        onLoad={onLoad}
      />,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Load more rows" });
    await user.click(button);
    expect(onLoad).toHaveBeenCalledWith("c1");
    expect(button.textContent).toBe("Loading…");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(button);
    await user.click(button);
    expect(onLoad).toHaveBeenCalledTimes(1);
    await act(async () => {
      page.resolve();
      await page.promise;
    });
    expect(button.textContent).toBe("Load more rows");
    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.hidden).toBe(false);
  });

  it("restores the label when the page fails", async () => {
    const page = deferred();
    render(<Paged answers={[() => page.promise.then(() => "c2")]} />);
    const user = userEvent.setup();
    await user.click(control());
    await act(async () => {
      page.reject(new Error("offline"));
      await page.promise.catch(() => undefined);
    });
    expect(control().textContent).toBe("Load more rows");
    expect(control().hidden).toBe(false);
  });

  it("hands focus to the list when the last page hides the control", async () => {
    render(<Paged answers={[() => Promise.resolve(undefined)]} />);
    const user = userEvent.setup();
    await user.click(control());
    await vi.waitFor(() => expect(control().hidden).toBe(true));
    const list = document.querySelector<HTMLElement>("#rows")!;
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("tabindex")).toBe("-1");
  });

  it("keeps a list's own tabindex, and focus when the list is missing", () => {
    const hide = (controls: string) => {
      const props = {
        controls,
        label: `Load more ${controls}`,
        list: controls,
        onLoad: () => Promise.resolve(),
      };
      const view = render(<LoadMore {...props} cursor="x" />);
      const button = screen.getByRole("button", { name: props.label });
      button.focus();
      view.rerender(<LoadMore {...props} cursor={undefined} />);
      return button;
    };
    const list = document.createElement("ul");
    list.id = "kept";
    list.tabIndex = 0;
    document.body.append(list);
    hide("kept");
    expect(document.activeElement).toBe(list);
    expect(list.getAttribute("tabindex")).toBe("0");
    list.remove();
    const orphan = hide("absent");
    expect(orphan.hidden).toBe(true);
    expect(document.activeElement).toBe(orphan);
  });

  it("leaves focus alone when the control hides without it", async () => {
    render(<Paged answers={[() => Promise.resolve(undefined)]} />);
    const outside = document.createElement("button");
    document.body.append(outside);
    control().click();
    outside.focus();
    await vi.waitFor(() => expect(control().hidden).toBe(true));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
