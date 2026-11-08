// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../testing/a11y.ts";
import {
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import { ids, workspaceSession } from "../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../testing/render.tsx";
import { JOURNAL_ISLAND, mountJournal } from "./journal.tsx";

const SESSION = "GET /api/v1/session";
const LIST = "GET /api/v1/journal";
const ITEM = "GET /api/v1/journal/items/:itemId";
const CREATE = "POST /api/v1/journal/posts";
const UPDATE = "PUT /api/v1/journal/posts/:postId";
const RATE = "PUT /api/v1/journal/day-ratings";
const LINK = "POST /api/v1/journal/activities";
const REMOVE = "DELETE /api/v1/journal/items/:itemId";

const item = {
  id: "00000000-0000-4000-8000-000000000010",
  occurredAt: "2026-08-23T10:00:00.000Z",
  post: {
    body: "Entry",
    id: "00000000-0000-4000-8000-000000000010",
    title: "Today",
    updatedAt: "2026-08-23T10:00:00.000Z",
  },
  type: "post",
};
const later = {
  ...item,
  id: "00000000-0000-4000-8000-000000000011",
  post: {
    ...item.post,
    id: "00000000-0000-4000-8000-000000000011",
    title: "Yesterday",
  },
};
const storedPost = {
  body: "Entry",
  createdAt: item.occurredAt,
  id: item.id,
  occurredAt: item.occurredAt,
  title: "Today",
  updatedAt: item.occurredAt,
};

function timeline(
  items: readonly object[],
  extra: Record<string, unknown> = {},
) {
  return jsonResponse({ activities: [], items, status: "ready", ...extra });
}

type Answer = ApiAnswer;

function routes(extra: Record<string, Answer | readonly Answer[]>) {
  return stubApi(
    {
      [SESSION]: jsonResponse(workspaceSession()),
      ...extra,
    } as Parameters<typeof stubApi>[0],
  );
}

/** The timeline as `pages/app/journal/index.astro` draws it. */
function timelineShell(): void {
  drawShell(`
    <main>
      <header class="page-heading"><div><h1>Journal</h1></div><button data-journal-add type="button" disabled>Add item</button></header>
      <div class="contents" data-journal-surface="timeline">
        <p data-journal-state role="status">Loading journal…</p>
      </div>
    </main>`);
}

/** One item's page as `pages/internal/journal-item-shell.astro` draws it. */
function itemShell(): void {
  drawShell(`
    <main data-journal-detail>
      <header class="page-heading"><div><h1>Journal item</h1></div></header>
      <div class="contents" data-journal-surface="item">
        <p data-journal-state role="status">Loading journal item…</p>
      </div>
    </main>`);
}

const mount = () => mountSettled(() => mountJournal());
const status = () => element("[data-journal-state]");
const list = () => element("[data-journal-list]");
const form = () => element<HTMLFormElement>("[data-journal-form]");
const formState = () => element("[data-journal-form-state]");
const add = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Add item" });
const entry = (title: string) =>
  within(list()).getByRole("link", { name: title }).closest("li")!;

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

function fill(label: string, value: string): void {
  act(() => {
    fireEvent.change(within(form()).getByLabelText(label), {
      target: { value },
    });
  });
}

function save(): void {
  act(() => {
    fireEvent.submit(form());
  });
}

const workspaceHeaders = (api: ReturnType<typeof stubApi>) =>
  api.requests().filter((request) =>
    request.url.pathname.startsWith("/api/v1/journal")
  ).map((request) => request.headers.get("X-Workspace-Id"));

afterEach(() => {
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("JOURNAL-001 journal island", () => {
  it.each(["timeline", "detail"])(
    "links every activity participant on the %s",
    async (surface) => {
      const participants = [{ id: ids.person, name: "Ada Lovelace" }, {
        id: "00000000-0000-4000-8000-000000000099",
        name: "Grace Hopper",
      }];
      const activity = {
        activity: { id: item.id, participants, summary: "Shared a walk" },
        id: item.id,
        occurredAt: item.occurredAt,
        type: "activity",
      };
      if (surface === "detail") {
        itemShell();
        history.replaceState({}, "", `/app/journal/${item.id}`);
        routes({ [ITEM]: jsonResponse({ item: activity, status: "ready" }) });
      } else {
        timelineShell();
        routes({ [LIST]: timeline([activity]) });
      }
      await mount();
      const walk = entry("Shared a walk");
      for (const person of participants) {
        expect(
          within(walk).getByRole("link", { name: person.name }).getAttribute(
            "href",
          ),
        )
          .toBe(`/app/people/${person.id}`);
      }
      expect(walk.textContent).toContain("With: Ada Lovelace, Grace Hopper");
      expect(walk.textContent).not.toContain(
        "Activity linked to this timeline.",
      );
    },
  );

  it("does nothing when the journal surface is absent", async () => {
    drawShell("<p>Other page</p>");
    await mount();
    expect(document.body.textContent).toBe("Other page");
    expect(JOURNAL_ISLAND).toBe("journal-surface");
  });

  it("APR-009 journal data uses the same selected membership as its display preferences", async () => {
    timelineShell();
    const api = routes({
      [LIST]: [timeline([item]), timeline([])],
      [REMOVE]: jsonResponse({ status: "deleted" }),
    });
    await mount();
    click(within(entry("Today")).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(status().textContent).toBe("No journal items yet.")
    );
    expect(api.calls()).toContain(`DELETE /api/v1/journal/items/${item.id}`);
    expect(new Set(workspaceHeaders(api))).toEqual(new Set([ids.workspace]));
  });

  it("GAP-023 appends the next journal page and retires the control", async () => {
    timelineShell();
    const api = routes({
      [LIST]: [
        timeline([item], { nextCursor: "journal-cursor" }),
        timeline([later]),
      ],
    });
    await mount();
    const more = screen.getByRole("button", {
      name: "Load more journal items",
    });
    expect(more.hidden).toBe(false);
    click(more);
    await waitFor(() => expect(list().textContent).toContain("Yesterday"));
    expect(api.calls().at(-1)).toBe(
      "GET /api/v1/journal?cursor=journal-cursor",
    );
    expect(list().textContent).toContain("Today");
    expect(more.hidden).toBe(true);
    expect(status().textContent).toBe("2 journal items.");
  });

  it("creates, authoritatively refreshes, edits, and removes a journal post", async () => {
    timelineShell();
    const edited = { ...item, post: { ...item.post, body: "Edited" } };
    const created = deferred<Response>();
    const api = routes({
      [CREATE]: created.promise,
      [LIST]: [
        timeline([]),
        timeline([item]),
        timeline([edited]),
        timeline([]),
      ],
      [REMOVE]: jsonResponse({ status: "deleted" }),
      [UPDATE]: jsonResponse({
        post: { ...storedPost, body: "Edited" },
        status: "updated",
      }),
    });
    await mount();
    expect(add().disabled).toBe(false);
    expect(document.querySelectorAll("[data-journal-add]")).toHaveLength(1);
    click(add());
    expect(form().hidden).toBe(false);
    expect(document.activeElement).toBe(
      within(form()).getByLabelText("Item type"),
    );
    fill("Entry", "Entry");
    fill("When", "2026-08-23T10:00");
    fill("Title (optional)", "Today");
    save();
    expect(formState().textContent).toBe("Saving…");
    expect(add().disabled).toBe(true);
    expect(
      within(form()).getByRole<HTMLButtonElement>("button", {
        name: "Save item",
      }).disabled,
    ).toBe(true);
    save();
    await act(async () => {
      created.resolve(
        jsonResponse({ post: storedPost, status: "created" }, 201),
      );
      await created.promise;
    });
    await waitFor(() => expect(list().textContent).toContain("Today"));
    await waitFor(() => expect(add().disabled).toBe(false));
    expect(form().hidden).toBe(true);
    click(within(entry("Today")).getByRole("button", { name: "Edit" }));
    expect(form().hidden).toBe(false);
    expect(
      within(form()).getByLabelText<HTMLSelectElement>("Item type").disabled,
    )
      .toBe(true);
    expect(document.activeElement).toBe(within(form()).getByLabelText("Entry"));
    fill("Entry", "Edited");
    save();
    await waitFor(() => expect(list().textContent).toContain("Edited"));
    click(within(entry("Today")).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(status().textContent).toBe("No journal items yet.")
    );
    expect(
      api.calls().filter((call) =>
        !call.includes("session") && !call.includes("preferences")
      ),
    )
      .toEqual([
        "GET /api/v1/journal",
        "POST /api/v1/journal/posts",
        "GET /api/v1/journal",
        `PUT /api/v1/journal/posts/${item.id}`,
        "GET /api/v1/journal",
        `DELETE /api/v1/journal/items/${item.id}`,
        "GET /api/v1/journal",
      ]);
    expect(api.bodies().filter(Boolean)).toEqual([
      {
        body: "Entry",
        occurredAt: new Date(2026, 7, 23, 10, 0).toISOString(),
        title: "Today",
      },
      { body: "Edited", occurredAt: item.occurredAt, title: "Today" },
    ]);
    expect(new Set(workspaceHeaders(api))).toEqual(new Set([ids.workspace]));
  });

  it("switches to a day rating and sends the canonical calendar date", async () => {
    timelineShell();
    const api = routes({
      [LIST]: [timeline([]), timeline([])],
      [RATE]: jsonResponse({ rating: { id: item.id }, status: "created" }, 201),
    });
    await mount();
    click(add());
    const rating = within(form()).getByLabelText<HTMLInputElement>("Date");
    expect(rating.closest("label")?.hidden).toBe(true);
    act(() => {
      fireEvent.change(within(form()).getByLabelText("Item type"), {
        target: { value: "day-rating" },
      });
    });
    expect(rating.closest("label")?.hidden).toBe(false);
    expect(within(form()).getByLabelText("Entry").closest("label")?.hidden)
      .toBe(true);
    fill("Date", "2026-08-23");
    fill("Comment (optional)", "  ");
    save();
    await waitFor(() => expect(form().hidden).toBe(true));
    const sent = api.requests().find((request) => request.method === "PUT")!;
    expect(sent.body).toEqual({ ratedOn: "2026-08-23", rating: 5 });
    expect(sent.headers.get("X-Workspace-Id")).toBe(ids.workspace);
  });

  it("renders every timeline item type and exposes retry and mutation failures", async () => {
    timelineShell();
    const activity = {
      activity: { id: item.id, participants: [], summary: "Shared a walk" },
      id: "00000000-0000-4000-8000-000000000011",
      occurredAt: item.occurredAt,
      type: "activity",
    };
    const rating = {
      dayRating: {
        comment: "Good day",
        id: "00000000-0000-4000-8000-000000000012",
        ratedOn: "2026-08-23",
        rating: 5,
      },
      id: "00000000-0000-4000-8000-000000000012",
      occurredAt: item.occurredAt,
      type: "day-rating",
    };
    const untitled = {
      ...item,
      id: "00000000-0000-4000-8000-000000000013",
      post: { ...item.post, title: undefined },
    };
    const problem = { code: "journal_unavailable", detail: "Try again later." };
    routes({
      [LIST]: [
        problemResponse(503, problem),
        timeline([activity, rating, untitled]),
      ],
      [REMOVE]: problemResponse(503, problem),
    });
    await mount();
    expect(status().textContent).toBe("Try again later.");
    expect(add().disabled).toBe(true);
    const retry = screen.getByRole("button", { name: "Retry journal" });
    click(retry);
    await waitFor(() => expect(list().textContent).toContain("Shared a walk"));
    expect(retry.hidden).toBe(true);
    expect(list().textContent).toContain("Day rating: 5/5");
    expect(list().textContent).toContain("Journal post");
    expect(entry("Shared a walk").textContent).toContain(
      "Activity linked to this timeline.",
    );
    expect(
      list().querySelector('[data-journal-item-type="day-rating"] time')
        ?.getAttribute("datetime"),
    )
      .toBe("2026-08-23");
    expect(
      within(entry("Shared a walk")).queryByRole("button", { name: "Edit" }),
    )
      .toBeNull();
    const remove = within(entry("Shared a walk")).getByRole<HTMLButtonElement>(
      "button",
      { name: "Remove" },
    );
    click(remove);
    await waitFor(() => expect(status().textContent).toBe("Try again later."));
    expect(remove.disabled).toBe(false);
    expect(list().textContent).toContain("Shared a walk");
    await expectNoAxeViolations(document.body);
  });

  it("links an activity and supports canceling a fresh form", async () => {
    timelineShell();
    const api = routes({
      [LINK]: [
        problemResponse(409, { detail: "Already linked." }),
        jsonResponse({ id: item.id, status: "created" }, 201),
      ],
      [LIST]: [
        timeline([], {
          activities: [{
            happenedAt: "2026-08-22T12:00:00.000Z",
            id: item.id,
            summary: "Shared a walk",
          }],
        }),
        timeline([]),
      ],
    });
    await mount();
    click(add());
    click(screen.getByRole("button", { name: "Cancel" }));
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(add());
    click(add());
    act(() => {
      fireEvent.change(within(form()).getByLabelText("Item type"), {
        target: { value: "activity" },
      });
    });
    const choice = within(form()).getByLabelText<HTMLSelectElement>("Activity");
    const choices = choice.querySelectorAll("option:not([disabled])");
    expect(choices).toHaveLength(1);
    expect(choices[0]?.textContent).toBe(
      "Shared a walk · Aug 22, 2026, 12:00 PM",
    );
    expect(choices[0]?.textContent).not.toContain(item.id);
    save();
    expect(formState().textContent).toBe("Choose an activity to link.");
    fill("Activity", item.id);
    save();
    await waitFor(() =>
      expect(formState().textContent).toBe("Already linked.")
    );
    expect(form().hidden).toBe(false);
    save();
    await waitFor(() => expect(form().hidden).toBe(true));
    expect(api.bodies().filter(Boolean)).toEqual([
      { activityId: item.id },
      { activityId: item.id },
    ]);
  });

  it("names when no activity can be linked", async () => {
    timelineShell();
    routes({ [LIST]: timeline([]) });
    await mount();
    click(add());
    act(() => {
      fireEvent.change(within(form()).getByLabelText("Item type"), {
        target: { value: "activity" },
      });
    });
    expect(within(form()).getByLabelText("Activity").textContent).toBe(
      "No unlinked activities available",
    );
  });

  it("preserves an instant during a text-only edit in Europe/Belgrade and handles a cleared time", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Europe/Belgrade";
    try {
      timelineShell();
      const api = routes({
        [LIST]: [timeline([item]), timeline([item])],
        [UPDATE]: jsonResponse({
          post: { ...storedPost, body: "Edited" },
          status: "updated",
        }),
      });
      await mount();
      click(within(entry("Today")).getByRole("button", { name: "Edit" }));
      expect(within(form()).getByLabelText<HTMLInputElement>("When").value)
        .toBe("2026-08-23T12:00");
      fill("Entry", "Edited");
      save();
      await waitFor(() => expect(form().hidden).toBe(true));
      expect(api.bodies().filter(Boolean)).toEqual([
        { body: "Edited", occurredAt: item.occurredAt, title: "Today" },
      ]);
      click(within(entry("Today")).getByRole("button", { name: "Edit" }));
      fill("When", "");
      save();
      expect(formState().textContent).toBe("Choose a valid date and time.");
      expect(api.bodies().filter(Boolean)).toHaveLength(1);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("refuses a save while a removal is in flight, holding one busy flag over every write control", async () => {
    timelineShell();
    const removal = deferred<Response>();
    const api = routes({
      [LIST]: [timeline([item]), timeline([])],
      [REMOVE]: removal.promise,
    });
    await mount();
    // The form keeps the POST method contract now that it renders in TSX.
    click(add());
    expect(form().method).toBe("post");
    fill("Entry", "Racing save");
    click(within(entry("Today")).getByRole("button", { name: "Remove" }));
    const saveButton = within(form()).getByRole<HTMLButtonElement>("button", {
      name: "Save item",
    });
    const cancel = within(form()).getByRole<HTMLButtonElement>("button", {
      name: "Cancel",
    });
    expect([saveButton.disabled, cancel.disabled, add().disabled]).toEqual([
      true,
      true,
      true,
    ]);
    save();
    expect(api.calls().some((call) => call.startsWith("POST "))).toBe(false);
    await act(async () => {
      removal.resolve(jsonResponse({ status: "deleted" }));
      await removal.promise;
    });
    await waitFor(() =>
      expect(status().textContent).toBe("No journal items yet.")
    );
    expect(saveButton.disabled).toBe(false);
    expect(api.calls().some((call) => call.startsWith("POST "))).toBe(false);
  });

  it("says so when a save cannot reach the journal", async () => {
    timelineShell();
    routes({ [CREATE]: unreachable, [LIST]: timeline([]) });
    await mount();
    click(add());
    fill("Entry", "Offline");
    save();
    await waitFor(() =>
      expect(formState().textContent).toBe(
        "The journal could not be reached. Try again.",
      )
    );
    expect(add().disabled).toBe(false);
  });

  it("loads the canonical detail item from the route and removes it", async () => {
    itemShell();
    history.replaceState({}, "", `/app/journal/${item.id}`);
    const api = routes({
      [ITEM]: [
        jsonResponse({ item, status: "ready" }),
        problemResponse(404, {
          detail: "This item does not exist in the active workspace.",
        }),
      ],
      [REMOVE]: jsonResponse({ status: "deleted" }),
    });
    await mount();
    expect(api.calls()).toContain(`GET /api/v1/journal/items/${item.id}`);
    expect(list().textContent).toContain("Entry");
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add item" })).toBeNull();
    expect(document.querySelector("[data-journal-form]")).toBeNull();
    expect(document.querySelector("[data-load-more]")).toBeNull();
    click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(status().textContent).toBe(
        "This item does not exist in the active workspace.",
      )
    );
    expect(screen.getByRole("button", { name: "Retry item" }).hidden).toBe(
      false,
    );
    expect(new Set(workspaceHeaders(api))).toEqual(new Set([ids.workspace]));
  });

  it("says Loading journal item… while the item page reads", async () => {
    itemShell();
    history.replaceState({}, "", `/app/journal/${item.id}`);
    const pending = deferred<Response>();
    routes({ [ITEM]: pending.promise });
    const mounted = mountPending(() => mountJournal());
    expect(status().textContent).toBe("Loading journal item…");
    await act(async () => {
      pending.resolve(jsonResponse({ item, status: "ready" }));
      await mounted;
    });
    expect(status().textContent).toBe("1 journal item.");
  });

  it("APR-009 journal waits for selected membership before reading or saving and supports retry", async () => {
    timelineShell();
    const api = stubApi({
      [SESSION]: [problemResponse(503), jsonResponse(workspaceSession())],
      [LIST]: timeline([]),
    });
    await mount();
    expect(api.calls().some((call) => call.includes("/journal"))).toBe(false);
    expect(status().textContent).toBe(
      "Your journal session could not be confirmed.",
    );
    expect(add().disabled).toBe(true);
    save();
    expect(api.calls().some((call) => call.includes("/journal"))).toBe(false);
    click(screen.getByRole("button", { name: "Retry journal" }));
    await waitFor(() =>
      expect(status().textContent).toBe("No journal items yet.")
    );
    expect(add().disabled).toBe(false);
  });
});
