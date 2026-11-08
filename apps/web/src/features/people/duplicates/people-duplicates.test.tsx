// @vitest-environment happy-dom

import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import {
  sessionWithoutPreferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { IDLE_TIMEOUT_MS } from "../../../lib/idle.ts";
import { clearSessionCache } from "../../../lib/workspace-context.ts";
import {
  drawShell,
  element,
  mountSettled,
  renderIsland,
} from "../../../testing/render.tsx";
import {
  mountPeopleDuplicates,
  PeopleDuplicates,
} from "./people-duplicates.tsx";

const SESSION = "GET /api/v1/session";
const DUPLICATES = "GET /api/v1/people/duplicates";
const MERGE = "POST /api/v1/people/:primaryId/merge";
const PREVIEW = "GET /api/v1/people/:primaryId/merge-preview";
const DISMISS = "POST /api/v1/people/duplicates/dismissals";

const first = "00000000-0000-4000-8000-000000000101";
const second = "00000000-0000-4000-8000-000000000102";
const person = (id: string, overrides: Record<string, unknown> = {}) => ({
  familyName: "Lovelace",
  givenName: "Ada",
  id,
  updatedAt: `2026-09-27T10:00:0${id.endsWith("1") ? 1 : 2}.000000Z`,
  ...overrides,
});
const review = (pairs: readonly unknown[], truncated = false) =>
  jsonResponse({ pairs, status: "ready", truncated });
const pair = {
  people: [person(first), person(second, { nickname: "Countess" })],
  reasons: ["email", "name"],
};
/** The server's preview, whose revisions are newer than the review's. */
const preview = (request: {
  readonly params: Readonly<Record<string, string>>;
  readonly url: URL;
}) => {
  const identity = (id: string) => ({
    familyName: "Lovelace",
    givenName: "Ada",
    id,
    isDeceased: false,
    isPartial: false,
    lifecycle: "active",
    updatedAt: `2026-09-27T11:00:0${id.endsWith("1") ? 1 : 2}.000000Z`,
  });
  return jsonResponse({
    conflicts: [],
    conflictsDigest: "ab".repeat(32),
    duplicate: identity(request.url.searchParams.get("duplicateId")!),
    moves: 4,
    primary: identity(request.params.primaryId!),
    status: "ready",
  });
};
const base = {
  [PREVIEW]: preview,
  [SESSION]: jsonResponse(workspaceSession()),
};
const merged = jsonResponse({
  duplicateId: second,
  moved: 4,
  next: `/app/people/${first}`,
  person: {
    familyName: "Lovelace",
    givenName: "Ada",
    id: first,
    isDeceased: false,
    isPartial: false,
    lifecycle: "active",
    updatedAt: "2026-09-27T12:00:00.000000Z",
  },
  status: "merged",
});

async function openReview() {
  const user = userEvent.setup();
  await user.click(
    within(element("#people-duplicates")).getByRole("button", {
      name: "Review possible duplicates",
    }),
  );
  return user;
}

describe("PEOPLE-008 duplicate review island", () => {
  it("stays out of the page when there is nothing to review or it could not be read", async () => {
    for (
      const routes of [
        { ...base, [DUPLICATES]: review([]) },
        { ...base, [DUPLICATES]: problemResponse(503) },
        { [SESSION]: problemResponse(503) },
      ]
    ) {
      // Each page is its own document, with no session yet.
      clearSessionCache();
      drawShell(`<div data-people-duplicates></div>`);
      stubApi(routes);
      await mountSettled(() => mountPeopleDuplicates());
      expect(element("#people-duplicates").hidden).toBe(true);
      document.body.innerHTML = "";
    }
    // A page without the region mounts nothing, and unmounts nothing.
    const unmount = await mountPeopleDuplicates();
    expect(unmount()).toBeUndefined();
  });

  it("FEQ-11 reads no duplicates until the browser is idle, waiting at most its timeout", async () => {
    const idle: IdleRequestCallback[] = [];
    const options: (IdleRequestOptions | undefined)[] = [];
    onTestFinished(() => void vi.unstubAllGlobals());
    vi.stubGlobal(
      "requestIdleCallback",
      (callback: IdleRequestCallback, option?: IdleRequestOptions) => {
        idle.push(callback);
        options.push(option);
        return idle.length;
      },
    );
    drawShell(`<div data-people-duplicates></div>`);
    const api = stubApi({ ...base, [DUPLICATES]: review([pair]) });
    const mounted = mountPeopleDuplicates();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.fetch).not.toHaveBeenCalled();
    expect(element("[data-people-duplicates]").dataset.island).toBeUndefined();
    expect(options).toEqual([{ timeout: IDLE_TIMEOUT_MS }]);
    await mountSettled(() => {
      idle[0]!({ didTimeout: true, timeRemaining: () => 0 });
      return mounted;
    });
    expect(api.calls()).toEqual([SESSION, DUPLICATES]);
    expect(element("#people-duplicates").hidden).toBe(false);
  });

  it("reads names in the default order when the session carries no preferences", async () => {
    drawShell(`<div data-people-duplicates></div>`);
    stubApi({
      [DUPLICATES]: review([pair]),
      [SESSION]: jsonResponse(sessionWithoutPreferences()),
    });
    await mountSettled(() => mountPeopleDuplicates());
    expect(element("#people-duplicates").textContent).toContain(
      "Ada Lovelace and Ada Lovelace “Countess”",
    );
  });

  it("folds the pairs away, then lists each with its reasons and a Merge… action", async () => {
    drawShell(`<div data-people-duplicates></div>`);
    stubApi({ ...base, [DUPLICATES]: review([pair], true) });
    await mountSettled(() => mountPeopleDuplicates());
    const region = within(element("#people-duplicates"));
    expect(region.getByRole("heading", { name: "Possible duplicates" }))
      .toBeTruthy();
    expect(
      region.getByText(
        "1 pair of people may be the same person. More are waiting: merge pairs or mark them as not duplicates to see the rest.",
      ),
    ).toBeTruthy();
    expect(element("#people-duplicates-list").hidden).toBe(true);
    await openReview();
    expect(element("#people-duplicates-list").hidden).toBe(false);
    expect(region.getByText("Ada Lovelace and Ada Lovelace “Countess”"))
      .toBeTruthy();
    expect(region.getByText("Same name · same email address")).toBeTruthy();
    expect(
      region.getByRole("button", {
        name: "Merge Ada Lovelace and Ada Lovelace “Countess”…",
      }),
    ).toBeTruthy();
    await expectNoAxeViolations(element("#people-duplicates"));
  });

  it("merges the pair into the chosen record, says it cannot be undone, and lands on it", async () => {
    const navigate = vi.fn();
    const answer = deferred<Response>();
    const api = stubApi({
      ...base,
      [DUPLICATES]: review([pair]),
      [MERGE]: answer.promise,
    });
    const settled = deferred<void>();
    await renderIsland(
      <PeopleDuplicates navigate={navigate} onSettled={settled.resolve} />,
    );
    await act(() => settled.promise);
    const user = await openReview();
    await user.click(screenButton(/^Merge Ada Lovelace and/));
    const dialog = within(await screenDialog());
    expect(dialog.getByText("A merge cannot be undone.")).toBeTruthy();
    const keepFirst = dialog.getByRole("radio", {
      name: "Keep Ada Lovelace (added first)",
    });
    expect(keepFirst).toHaveProperty("checked", true);
    await waitFor(() => expect(document.activeElement).toBe(keepFirst));
    await user.click(
      dialog.getByRole("radio", {
        name: "Keep Ada Lovelace “Countess” (added later)",
      }),
    );
    expect(
      await dialog.findByText(
        /^4 records that name Ada Lovelace move to Ada Lovelace “Countess”/,
      ),
    ).toBeTruthy();
    await user.click(dialog.getByRole("radio", { name: /added first/ }));
    await dialog.findByText(/^4 records that name Ada Lovelace “Countess”/);
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    expect(dialog.getByRole("button", { name: "Merge people" }))
      .toHaveProperty("disabled", true);
    expect(dialog.getByRole("button", { name: "Cancel merge" }))
      .toHaveProperty("disabled", true);
    await act(async () => {
      answer.resolve(merged.clone());
      await answer.promise;
    });
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/app/people/${first}`)
    );
    const request = api.requests().find((entry) => entry.method === "POST");
    expect(request?.url.pathname).toBe(`/api/v1/people/${first}/merge`);
    expect(request?.body).toEqual({
      confirmed: true,
      conflictsDigest: "ab".repeat(32),
      duplicateId: second,
      duplicateRevision: "2026-09-27T11:00:02.000000Z",
      primaryRevision: "2026-09-27T11:00:01.000000Z",
    });
  });

  it("mounted on the page, lands the browser on the kept person", async () => {
    drawShell(`<div data-people-duplicates></div>`);
    stubApi({ ...base, [DUPLICATES]: review([pair]), [MERGE]: merged });
    const assign = vi.spyOn(globalThis.location, "assign")
      .mockImplementation(() => undefined);
    await mountSettled(() => mountPeopleDuplicates());
    const user = await openReview();
    await user.click(screenButton(/^Merge Ada Lovelace and/));
    const dialog = within(await screenDialog());
    await dialog.findByText(/^4 records that name/);
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/app/people/${first}`)
    );
    assign.mockRestore();
  });

  it("keeps the dialog open with the refusal, and Cancel merge returns to the pair", async () => {
    stubApi({
      ...base,
      [DUPLICATES]: review([pair]),
      [MERGE]: problemResponse(409, {
        code: "person_stale",
        detail:
          "One of these people changed. Review them again before merging.",
      }),
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const opener = screenButton(/^Merge Ada Lovelace and/);
    await user.click(opener);
    const dialog = within(await screenDialog());
    await dialog.findByText(/^4 records that name/);
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() =>
      expect(
        dialog.getByText(
          "One of these people changed. Review them again before merging.",
        ),
      ).toBeTruthy()
    );
    await user.click(dialog.getByRole("button", { name: "Cancel merge" }));
    await waitFor(() =>
      expect(document.querySelector("[role=dialog]")).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

describe("REL-064 not duplicates", () => {
  const other = {
    people: [
      person("00000000-0000-4000-8000-000000000103", { givenName: "Grace" }),
      person("00000000-0000-4000-8000-000000000104", { givenName: "Grace" }),
    ],
    reasons: ["name"],
  };
  const NOT_DUPLICATES =
    "Mark Ada Lovelace and Ada Lovelace “Countess” as not duplicates";

  it("marks a pair for everyone, busy while it saves, then drops it and says so", async () => {
    const answer = deferred<Response>();
    const api = stubApi({
      ...base,
      [DISMISS]: answer.promise,
      [DUPLICATES]: review([pair, other]),
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    expect(region.getByRole("button", { name: NOT_DUPLICATES }))
      .toHaveProperty("disabled", true);
    for (const button of region.getAllByRole("button", { name: /^Merge / })) {
      expect(button).toHaveProperty("disabled", true);
    }
    expect(region.getByRole("status").textContent).toBe(
      "Marking Ada Lovelace and Ada Lovelace “Countess” as not duplicates…",
    );
    await act(async () => {
      answer.resolve(
        jsonResponse({ personIds: [first, second], status: "dismissed" }),
      );
      await answer.promise;
    });
    await waitFor(() =>
      expect(region.queryByRole("button", { name: NOT_DUPLICATES })).toBeNull()
    );
    expect(region.getByRole("status").textContent).toBe(
      "Ada Lovelace and Ada Lovelace “Countess” are marked as not duplicates. They will not be suggested again.",
    );
    expect(region.getByText("1 pair of people may be the same person."))
      .toBeTruthy();
    expect(region.getByRole("button", { name: /^Merge Grace/ }))
      .toHaveProperty("disabled", false);
    expect(document.activeElement?.id).toBe("people-duplicates-heading");
    const request = api.requests().find((entry) => entry.method === "POST");
    expect(request?.url.pathname).toBe("/api/v1/people/duplicates/dismissals");
    expect(request?.body).toEqual({ personIds: [first, second] });
    await expectNoAxeViolations(element("#people-duplicates"));
  });

  it("keeps the review in view once its last pair is dismissed", async () => {
    drawShell(`<div data-people-duplicates></div>`);
    stubApi({
      ...base,
      [DISMISS]: jsonResponse({
        personIds: [first, second],
        status: "dismissed",
      }),
      [DUPLICATES]: review([pair]),
    });
    await mountSettled(() => mountPeopleDuplicates());
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    await waitFor(() =>
      expect(region.getByText("No possible duplicates are left to review."))
        .toBeTruthy()
    );
    expect(element("#people-duplicates").hidden).toBe(false);
    expect(element("#people-duplicates-toggle").hidden).toBe(true);
    expect(region.getByRole("status").textContent).toContain(
      "are marked as not duplicates.",
    );
  });

  it("reads a cut-off review once more after its last shown pair is dismissed (REL-090)", async () => {
    const reread = deferred<Response>();
    let reads = 0;
    stubApi({
      ...base,
      [DISMISS]: jsonResponse({
        personIds: [first, second],
        status: "dismissed",
      }),
      [DUPLICATES]: () => ++reads === 1 ? review([pair], true) : reread.promise,
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    await waitFor(() =>
      expect(region.getByText("Looking for more possible duplicates…"))
        .toBeTruthy()
    );
    expect(region.queryByText("No possible duplicates are left to review."))
      .toBeNull();
    expect(reads).toBe(2);
    await act(async () => {
      reread.resolve(review([other]).clone());
      await reread.promise;
    });
    await waitFor(() =>
      expect(region.getByText("1 pair of people may be the same person."))
        .toBeTruthy()
    );
    // The status line says what the second read found.
    expect(region.getByRole("status").textContent).toBe(
      "Ada Lovelace and Ada Lovelace “Countess” are marked as not duplicates. They will not be suggested again. 1 more pair of possible duplicates to review.",
    );
    // The list stays open on the pairs the second read found.
    expect(element("#people-duplicates-list").hidden).toBe(false);
    expect(region.getByRole("button", { name: /^Merge Grace/ }))
      .toHaveProperty("disabled", false);
    expect(document.activeElement?.id).toBe("people-duplicates-heading");
    expect(reads).toBe(2);
  });

  it("says to reload when the second read of a cut-off review fails", async () => {
    let reads = 0;
    stubApi({
      ...base,
      [DISMISS]: jsonResponse({
        personIds: [first, second],
        status: "dismissed",
      }),
      [DUPLICATES]: () =>
        ++reads === 1 ? review([pair], true) : problemResponse(503),
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    await waitFor(() =>
      expect(
        region.getByText(
          "More possible duplicates may be waiting. Reload the page to review them.",
        ),
      ).toBeTruthy()
    );
    expect(element("#people-duplicates").hidden).toBe(false);
    expect(region.getByRole("status").textContent).toBe(
      "Ada Lovelace and Ada Lovelace “Countess” are marked as not duplicates. They will not be suggested again. More possible duplicates may be waiting. Reload the page to review them.",
    );
  });

  it("keeps a refused pair in the list and says why", async () => {
    stubApi({
      ...base,
      [DISMISS]: problemResponse(404, {
        code: "person_not_found",
        detail: "Both people must exist in the current workspace.",
      }),
      [DUPLICATES]: review([pair]),
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    await waitFor(() =>
      expect(region.getByRole("status").textContent).toBe(
        "Both people must exist in the current workspace.",
      )
    );
    expect(region.getByRole("button", { name: NOT_DUPLICATES }))
      .toHaveProperty("disabled", false);
  });

  it("says nothing was saved when the answer is not a dismissal", async () => {
    stubApi({
      ...base,
      [DISMISS]: jsonResponse({ status: "ready" }),
      [DUPLICATES]: review([pair]),
    });
    const settled = deferred<void>();
    await renderIsland(<PeopleDuplicates onSettled={settled.resolve} />);
    await act(() => settled.promise);
    const user = await openReview();
    const region = within(element("#people-duplicates"));
    await user.click(region.getByRole("button", { name: NOT_DUPLICATES }));
    await waitFor(() =>
      expect(region.getByRole("status").textContent).toBe(
        "Nothing was saved. Try again.",
      )
    );
    expect(region.getByRole("button", { name: NOT_DUPLICATES })).toBeTruthy();
  });
});

function screenButton(name: RegExp): HTMLElement {
  return within(document.body).getByRole("button", { name });
}

async function screenDialog(): Promise<HTMLElement> {
  return await waitFor(() => {
    const dialog = document.querySelector<HTMLElement>("[role=dialog]");
    if (!dialog) throw new Error("the merge dialog is not open");
    return dialog;
  });
}
