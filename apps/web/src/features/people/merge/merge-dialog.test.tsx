// @vitest-environment happy-dom

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { ids } from "../../../testing/fixtures.ts";
import { renderIsland } from "../../../testing/render.tsx";
import { MergeDialog } from "./merge-dialog.tsx";
import type { MergePerson } from "./merge-state.ts";

const PEOPLE = "GET /api/v1/people";
const MERGE = "POST /api/v1/people/:primaryId/merge";
const PREVIEW = "GET /api/v1/people/:primaryId/merge-preview";
/** A distinct revision per person, from the last digits of its identifier. */
const revisionOf = (id: string) =>
  `2026-09-27T10:${id.slice(-3, -1)}:0${id.slice(-1)}.000000Z`;

/** The server's preview for whichever primary the request names. */
function previewAnswer(
  conflicts: readonly Record<string, string>[] = [],
  conflictsDigest = "ab".repeat(32),
) {
  return (
    request: {
      readonly params: Readonly<Record<string, string>>;
      readonly url: URL;
    },
  ) => {
    const identity = (id: string, updatedAt: string) => ({
      givenName: "Grace",
      id,
      isDeceased: false,
      isPartial: false,
      lifecycle: "active",
      updatedAt,
    });
    const primary = request.params.primaryId!;
    const duplicate = request.url.searchParams.get("duplicateId")!;
    return jsonResponse({
      conflicts,
      conflictsDigest,
      duplicate: identity(duplicate, revisionOf(duplicate)),
      moves: 2,
      primary: identity(primary, revisionOf(primary)),
      status: "ready",
    });
  };
}
const anchor: MergePerson = {
  familyName: "Hopper",
  givenName: "Grace",
  id: ids.person,
  middleName: "Brewster",
  nickname: "Amazing",
};
const other = (id: string, givenName = "Grace") => ({
  familyName: "Hopper",
  givenName,
  id,
  isPartial: false,
  isStarred: false,
  lifecycle: "active",
  tagCount: 0,
  tags: [],
});
const directory = (people: readonly unknown[]) =>
  jsonResponse({ lifecycle: "active", people, status: "ready" });

async function open(
  overrides: Partial<Parameters<typeof MergeDialog>[0]> = {},
) {
  const onCancel = vi.fn();
  const onMerged = vi.fn();
  await renderIsland(
    <MergeDialog
      anchor={anchor}
      finalFocus={createRef()}
      nameOrder="family_given_nickname"
      onCancel={onCancel}
      onMerged={onMerged}
      roles={{ anchor: "this person", other: "chosen person" }}
      workspaceId={ids.workspace}
      {...overrides}
    />,
  );
  const dialog = within(
    await screen.findByRole("dialog", { name: "Merge two people?" }),
  );
  return { dialog, onCancel, onMerged, user: userEvent.setup() };
}

describe("PEOPLE-008 merge dialog", () => {
  it("searches for everyone else, says how many it found, and lets the member choose again", async () => {
    const api = stubApi({
      [PEOPLE]: [
        problemResponse(503),
        directory([
          other("00000000-0000-4000-8000-000000000201"),
          other("00000000-0000-4000-8000-000000000202", "Gracie"),
        ]),
      ],
      [PREVIEW]: previewAnswer(),
    });
    const { dialog, user } = await open();
    expect(dialog.getByText("Who else is Hopper Grace Brewster “Amazing”?"))
      .toBeTruthy();
    const search = dialog.getByLabelText("Find the person to merge with");
    await user.type(search, "x");
    await user.click(dialog.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(dialog.getByText("People could not be searched. Try again."))
        .toBeTruthy()
    );
    await user.clear(search);
    await user.type(search, "{Enter}");
    await waitFor(() =>
      expect(dialog.getByText("2 people found.")).toBeTruthy()
    );
    const searches = api.requests();
    expect(searches[0]?.url.searchParams.get("search")).toBe("x");
    expect(searches[1]?.url.searchParams.has("search")).toBe(false);
    expect(searches[1]?.url.searchParams.get("limit")).toBe("10");
    await user.click(
      dialog.getByRole("button", { name: "Merge with Hopper Gracie" }),
    );
    expect(
      dialog.getByRole("radio", { name: "Keep Hopper Gracie (chosen person)" }),
    )
      .toHaveProperty("checked", false);
    await user.click(
      dialog.getByRole("button", { name: "Choose someone else" }),
    );
    expect(dialog.getByLabelText("Find the person to merge with")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Merge people" }))
      .toHaveProperty("disabled", true);
  });

  it("shows only the latest search and never submits before the other person is chosen", async () => {
    let first!: (response: Response) => void;
    const api = stubApi({
      [PEOPLE]: [
        () => new Promise<Response>((resolve) => (first = resolve)),
        directory([other("00000000-0000-4000-8000-000000000205")]),
      ],
    });
    const { dialog, user } = await open();
    const search = dialog.getByLabelText("Find the person to merge with");
    await user.type(search, "Gr{Enter}");
    await user.type(search, "ace{Enter}");
    await waitFor(() =>
      expect(dialog.getByText("1 person found.")).toBeTruthy()
    );
    await act(async () => {
      first(directory([]));
      await Promise.resolve();
    });
    expect(dialog.getByText("1 person found.")).toBeTruthy();
    const form = document.querySelector<HTMLFormElement>("#person-merge-form")!;
    await act(async () => {
      form.requestSubmit();
      await Promise.resolve();
    });
    expect(api.requests().filter((entry) => entry.method === "POST"))
      .toHaveLength(0);
  });

  it("previews the chosen primary, lists what is kept and discarded, and confirms against the preview's revisions", async () => {
    const other = "00000000-0000-4000-8000-000000000203";
    const api = stubApi({
      [MERGE]: [
        () => Promise.reject(new Error("offline")),
        jsonResponse({
          duplicateId: ids.person,
          moved: 1,
          next: `/app/people/${other}`,
          person: {
            givenName: "Grace",
            id: other,
            isDeceased: false,
            isPartial: false,
            lifecycle: "active",
            updatedAt: "2026-09-27T12:00:00.000000Z",
          },
          status: "merged",
        }),
      ],
      [PREVIEW]: previewAnswer([
        { discarded: "12 March", fact: "birthday", kept: "10 December" },
      ]),
    });
    const { dialog, onMerged, user } = await open({
      other: { givenName: "Grace", id: other },
      roles: { anchor: "added first", other: "added later" },
    });
    expect(dialog.queryByRole("button", { name: "Choose someone else" }))
      .toBeNull();
    await waitFor(() =>
      expect(
        dialog.getByRole("list", { name: "What is kept and discarded" })
          .textContent,
      ).toBe("Birthday — Kept: 10 December, discarded: 12 March")
    );
    await user.click(
      dialog.getByRole("radio", { name: "Keep Grace (added later)" }),
    );
    await waitFor(() =>
      expect(dialog.getByText(/^2 records that name Hopper Grace/))
        .toBeTruthy()
    );
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() =>
      expect(dialog.getByText("Nothing was merged. Try again.")).toBeTruthy()
    );
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledTimes(1));
    const previews = api.requests().filter((entry) => entry.method === "GET");
    expect(previews.map((entry) => entry.params.primaryId)).toEqual([
      ids.person,
      other,
    ]);
    const confirmed = {
      confirmed: true,
      conflictsDigest: "ab".repeat(32),
      duplicateId: ids.person,
      duplicateRevision: revisionOf(ids.person),
      primaryRevision: revisionOf(other),
    };
    expect(api.bodies().filter(Boolean)).toEqual([confirmed, confirmed]);
  });

  it("reads the preview again when the merge was out of date, shows the new conflicts, and confirms against them", async () => {
    const other = "00000000-0000-4000-8000-000000000205";
    const api = stubApi({
      [MERGE]: [
        problemResponse(409, {
          code: "merge_conflicts_changed",
          detail:
            "What this merge would discard changed since it was reviewed. Review it again before merging.",
        }),
        jsonResponse({
          duplicateId: other,
          moved: 2,
          next: `/app/people/${ids.person}`,
          person: {
            givenName: "Grace",
            id: ids.person,
            isDeceased: false,
            isPartial: false,
            lifecycle: "active",
            updatedAt: "2026-09-27T12:00:00.000000Z",
          },
          status: "merged",
        }),
      ],
      [PREVIEW]: [
        previewAnswer(),
        previewAnswer(
          [{ discarded: "12 March", fact: "birthday", kept: "10 December" }],
          "cd".repeat(32),
        ),
      ],
    });
    const { dialog, onMerged, user } = await open({
      other: { givenName: "Grace", id: other },
    });
    await dialog.findByText(/^2 records that name/);
    expect(dialog.queryByRole("list", { name: "What is kept and discarded" }))
      .toBeNull();
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() =>
      expect(
        dialog.getByRole("list", { name: "What is kept and discarded" })
          .textContent,
      ).toBe("Birthday — Kept: 10 December, discarded: 12 March")
    );
    expect(
      dialog.getByText(
        "What this merge would discard changed since it was reviewed. Review it again before merging.",
      ),
    ).toBeTruthy();
    expect(onMerged).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    await waitFor(() => expect(onMerged).toHaveBeenCalledTimes(1));
    expect(
      api.bodies().filter(Boolean).map((body) =>
        (body as { conflictsDigest: string }).conflictsDigest
      ),
    ).toEqual(["ab".repeat(32), "cd".repeat(32)]);
    expect(api.requests().filter((entry) => entry.method === "GET"))
      .toHaveLength(2);
  });

  it("says why a preview was refused and offers no confirmation", async () => {
    stubApi({
      [PREVIEW]: problemResponse(409, {
        code: "merge_both_members",
        detail: "Both people are workspace members' own records.",
      }),
    });
    const { dialog } = await open({
      other: { givenName: "Grace", id: "00000000-0000-4000-8000-000000000206" },
    });
    await waitFor(() =>
      expect(
        dialog.getByText("Both people are workspace members' own records."),
      )
        .toBeTruthy()
    );
    expect(dialog.getByRole("button", { name: "Merge people" }))
      .toHaveProperty("disabled", true);
  });

  it("falls back to its own words when a preview could not be read at all", async () => {
    stubApi({ [PREVIEW]: () => Promise.reject(new Error("offline")) });
    const { dialog } = await open({
      other: { givenName: "Grace", id: "00000000-0000-4000-8000-000000000207" },
    });
    await waitFor(() =>
      expect(
        dialog.getByText(
          "What this merge would change could not be read. Try again.",
        ),
      ).toBeTruthy()
    );
  });

  it("closes on Escape or Cancel merge, but not while the merge is in flight", async () => {
    let release!: (response: Response) => void;
    stubApi({
      [MERGE]: () => new Promise<Response>((resolve) => (release = resolve)),
      [PREVIEW]: previewAnswer(),
    });
    const { dialog, onCancel, user } = await open({
      other: { givenName: "Grace", id: "00000000-0000-4000-8000-000000000204" },
    });
    await waitFor(() =>
      expect(dialog.getByText(/^2 records that name/)).toBeTruthy()
    );
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.click(dialog.getByRole("button", { name: "Merge people" }));
    expect(dialog.getByText("Merging…")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(problemResponse(409, { detail: "One of these people changed." }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(dialog.getByText("One of these people changed.")).toBeTruthy()
    );
    await user.click(dialog.getByRole("button", { name: "Cancel merge" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
