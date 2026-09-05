import { resolveWorkspaceSession } from "./workspace-context.ts";
// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountJournal } from "./journal.ts";

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

it("APR-009 journal data uses the same selected membership as its display preferences", async () => {
  markup();
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(response({ status: "ready", items: [item] }))
  );
  vi.stubGlobal("fetch", fetch);
  await mountJournal();
  expect(fetch).toHaveBeenCalledWith("/api/v1/journal", {
    headers: expect.objectContaining({ "X-Workspace-Id": "journal-workspace" }),
  });
  document.querySelector<HTMLButtonElement>(
    "[data-journal-item-id] button:last-child",
  )!.click();
  await vi.waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/journal/items/${item.id}`,
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          "X-Workspace-Id": "journal-workspace",
        }),
      }),
    )
  );
});
function response(body: unknown, status = 200): Response {
  const normalized = body && typeof body === "object" && "items" in body &&
      !("activities" in body)
    ? { ...body, activities: [] }
    : body;
  return new Response(JSON.stringify(normalized), {
    headers: { "content-type": "application/json" },
    status,
  });
}
function markup(): void {
  document.body.innerHTML =
    `<p data-journal-state></p><button data-journal-retry hidden>Retry</button><button data-journal-add>Add item</button>
    <form data-journal-form hidden><select name="type"><option value="post">Post</option><option value="day-rating">Rating</option><option value="activity">Activity</option></select>
    <label data-journal-post><input name="occurredAt" type="datetime-local"></label><label data-journal-post><input name="title"></label><label data-journal-post><textarea name="body"></textarea></label>
    <label data-journal-rating hidden><input name="ratedOn" type="date"></label><label data-journal-rating hidden><select name="rating"><option value="5">5</option></select></label><label data-journal-rating hidden><textarea name="comment"></textarea></label>
    <label data-journal-activity hidden><select name="activityId"></select></label><p data-journal-form-state></p><button type="submit">Save</button><button data-journal-cancel type="button">Cancel</button></form><ol data-journal-list></ol>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("JOURNAL-001 browser behavior", () => {
  it("does nothing when the journal surface is absent", async () => {
    document.body.innerHTML = "<p>Other page</p>";
    await mountJournal();
    expect(document.body.textContent).toBe("Other page");
  });

  it("creates, authoritatively refreshes, edits, and removes a journal post", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({ post: item.post, status: "created" }, 201),
      )
      .mockResolvedValueOnce(response({ items: [item], status: "ready" }))
      .mockResolvedValueOnce(
        response({ post: { ...item.post, body: "Edited" }, status: "updated" }),
      )
      .mockResolvedValueOnce(
        response({
          items: [{ ...item, post: { ...item.post, body: "Edited" } }],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(response({ status: "deleted" }))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    document.querySelector<HTMLButtonElement>("[data-journal-add]")!.click();
    const form = document.querySelector<HTMLFormElement>(
      "[data-journal-form]",
    )!;
    (form.elements.namedItem("body") as HTMLTextAreaElement).value = "Entry";
    (form.elements.namedItem("occurredAt") as HTMLInputElement).value =
      "2026-08-23T10:00";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-journal-list]")?.textContent)
        .toContain("Today")
    );
    document.querySelectorAll<HTMLButtonElement>(
      "[data-journal-list] button",
    )[0]!.click();
    (form.elements.namedItem("body") as HTMLTextAreaElement).value = "Edited";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-journal-list]")?.textContent)
        .toContain("Edited")
    );
    document.querySelectorAll<HTMLButtonElement>(
      "[data-journal-list] button",
    )[1]!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-journal-state]")?.textContent).toBe(
        "No journal items yet.",
      )
    );
    expect(
      fetchMock.mock.calls.map((call) =>
        (call[1] as RequestInit | undefined)?.method
      ),
    ).toEqual([
      undefined,
      "POST",
      undefined,
      "PUT",
      undefined,
      "DELETE",
      undefined,
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers).toMatchObject({
        "X-Workspace-Id": "journal-workspace",
      });
    }
  });

  it("switches to a day rating and sends the canonical calendar date", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({ items: [], status: "ready" }),
    ).mockResolvedValueOnce(
      response({ rating: { id: item.id }, status: "created" }, 201),
    ).mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    document.querySelector<HTMLButtonElement>("[data-journal-add]")!.click();
    const form = document.querySelector<HTMLFormElement>(
      "[data-journal-form]",
    )!;
    const type = form.elements.namedItem("type") as HTMLSelectElement;
    type.value = "day-rating";
    type.dispatchEvent(new Event("change"));
    (form.elements.namedItem("ratedOn") as HTMLInputElement).value =
      "2026-08-23";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ ratedOn: "2026-08-23", rating: 5 }),
      method: "PUT",
      headers: expect.objectContaining({
        "X-Workspace-Id": "journal-workspace",
      }),
    });
  });

  it("renders every timeline item type and exposes retry and mutation failures", async () => {
    markup();
    const activity = {
      activity: { id: item.id, summary: "Shared a walk" },
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
    const problem = {
      code: "journal_unavailable",
      detail: "Try again later.",
      status: 503,
      title: "Journal unavailable",
      type: "https://kinship.test/problems/journal_unavailable",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(problem, 503))
      .mockResolvedValueOnce(
        response({ items: [activity, rating, untitled], status: "ready" }),
      )
      .mockResolvedValueOnce(response(problem, 503));
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    expect(document.querySelector("[data-journal-state]")?.textContent).toBe(
      "Try again later.",
    );
    document.querySelector<HTMLButtonElement>("[data-journal-retry]")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-journal-list]")?.textContent)
        .toContain("Shared a walk")
    );
    expect(document.querySelector("[data-journal-list]")?.textContent)
      .toContain("Day rating: 5/5");
    expect(document.querySelector("[data-journal-list]")?.textContent)
      .toContain("Journal post");
    document.querySelector<HTMLButtonElement>(
      '[data-journal-item-type="activity"] button',
    )!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-journal-state]")?.textContent).toBe(
        "Try again later.",
      )
    );
  });

  it("links an activity and supports canceling a fresh form", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [], status: "ready" }))
      .mockResolvedValueOnce(response({ id: item.id, status: "created" }, 201))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    const add = document.querySelector<HTMLButtonElement>(
      "[data-journal-add]",
    )!;
    const form = document.querySelector<HTMLFormElement>(
      "[data-journal-form]",
    )!;
    add.click();
    document.querySelector<HTMLButtonElement>("[data-journal-cancel]")!.click();
    expect(form.hidden).toBe(true);
    add.click();
    const type = form.elements.namedItem("type") as HTMLSelectElement;
    type.value = "activity";
    type.dispatchEvent(new Event("change"));
    const activity = form.elements.namedItem("activityId") as HTMLSelectElement;
    const option = document.createElement("option");
    option.textContent = "Shared a walk";
    option.value = item.id;
    activity.append(option);
    activity.value = item.id;
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ activityId: item.id }),
      method: "POST",
      headers: expect.objectContaining({
        "X-Workspace-Id": "journal-workspace",
      }),
    });
  });

  it("preserves an instant during a text-only edit in Europe/Belgrade and handles a cleared time", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "Europe/Belgrade";
    try {
      markup();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(response({ items: [item], status: "ready" }))
        .mockResolvedValueOnce(
          response({
            post: { ...item.post, body: "Edited" },
            status: "updated",
          }),
        )
        .mockResolvedValueOnce(response({ items: [item], status: "ready" }));
      vi.stubGlobal("fetch", fetchMock);
      await mountJournal();
      document.querySelector<HTMLButtonElement>(
        '[data-journal-item-type="post"] button',
      )!.click();
      const form = document.querySelector<HTMLFormElement>(
        "[data-journal-form]",
      )!;
      const occurredAt = form.elements.namedItem(
        "occurredAt",
      ) as HTMLInputElement;
      expect(occurredAt.value).toBe("2026-08-23T12:00");
      (form.elements.namedItem("body") as HTMLTextAreaElement).value = "Edited";
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)))
        .toMatchObject(
          { occurredAt: item.occurredAt },
        );

      document.querySelector<HTMLButtonElement>(
        '[data-journal-item-type="post"] button',
      )!.click();
      occurredAt.value = "";
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.querySelector("[data-journal-form-state]")?.textContent)
          .toBe("Choose a valid date and time.")
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      process.env.TZ = previousTimezone;
    }
  });

  it("renders authorized linkable activities as member-readable choices", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      activities: [{
        happenedAt: "2026-08-22T12:00:00.000Z",
        id: item.id,
        summary: "Shared a walk",
      }],
      items: [],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    const options = document.querySelector<HTMLSelectElement>(
      'select[name="activityId"]',
    )!;
    const choices = options.querySelectorAll("option:not([disabled])");
    expect(choices).toHaveLength(1);
    expect(choices[0]?.textContent).toContain("Shared a walk");
    expect(choices[0]?.textContent).not.toContain(item.id);
  });

  it("loads the canonical detail item from the route", async () => {
    markup();
    document.querySelector("[data-journal-add]")?.remove();
    const main = document.createElement("main");
    main.dataset.journalDetail = "";
    document.body.append(main);
    globalThis.history.pushState({}, "", `/app/journal/${item.id}`);
    const fetchMock = vi.fn().mockResolvedValueOnce(
      response({ item, status: "ready" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountJournal();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/v1/journal/items/${item.id}`,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "X-Workspace-Id": "journal-workspace",
    });
    expect(document.querySelector("[data-journal-list]")?.textContent)
      .toContain("Entry");
    globalThis.history.pushState({}, "", "/");
  });
});

vi.mock(
  "./workspace-context.ts",
  () => ({
    resolveWorkspaceSession: vi.fn().mockResolvedValue({
      status: "ready",
      session: { workspace: { id: "journal-workspace" } },
    }),
  }),
);

it("APR-009 journal waits for selected membership before reading or saving and supports retry", async () => {
  markup();
  vi.mocked(resolveWorkspaceSession).mockResolvedValueOnce({
    status: "unavailable",
  });
  const fetch = vi.fn().mockImplementation(() =>
    Promise.resolve(response({ status: "ready", items: [] }))
  );
  vi.stubGlobal("fetch", fetch);
  await mountJournal();
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector("[data-journal-state]")?.textContent).toContain(
    "session could not be confirmed",
  );
  document.querySelector("form")!.dispatchEvent(
    new SubmitEvent("submit", { bubbles: true, cancelable: true }),
  );
  expect(fetch).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("[data-journal-retry]")!.click();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
});
