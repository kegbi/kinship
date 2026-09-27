// @vitest-environment happy-dom

import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { preferences, workspaceSession } from "../../../testing/fixtures.ts";
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
const PREFERENCES = "GET /api/v1/settings/preferences";
const DUPLICATES = "GET /api/v1/people/duplicates";
const MERGE = "POST /api/v1/people/:primaryId/merge";
const PREVIEW = "GET /api/v1/people/:primaryId/merge-preview";

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
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
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

  it("reads names in the default order when the member's preferences could not be read", async () => {
    drawShell(`<div data-people-duplicates></div>`);
    stubApi({
      [DUPLICATES]: review([pair]),
      [PREFERENCES]: problemResponse(503),
      [SESSION]: jsonResponse(workspaceSession()),
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
        "1 pair of people may be the same person. Showing the first 1; merge some to see more.",
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
