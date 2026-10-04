// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import {
  deleteSelection,
  previewDeletionSelection,
} from "./delete-selection.ts";
import type { PersonDeletionImpact } from "../../../../../../packages/contracts/generated/auth-client.ts";

const impact = (id: string) =>
  ({
    confirmation: `DELETE ${id}`,
    dependentRecordPolicy: "retained",
    person: { id, updatedAt: "2026-10-04T00:00:00Z" },
  }) as PersonDeletionImpact["impact"];
const snapshot = (id: string) =>
  jsonResponse({ status: "ready", impact: impact(id) });
const deleted = (id: string) =>
  jsonResponse({ status: "deleted", personId: id, next: "/app/people" });

describe("PEOPLE-009 selected deletion through canonical APIs", () => {
  it("previews serially without writing, then uses the exact revision and workspace", async () => {
    const held = deferred<Response>();
    const api = stubApi({
      "GET /api/v1/people/a/deletion-impact": held.promise,
      "GET /api/v1/people/b/deletion-impact": snapshot("b"),
      "DELETE /api/v1/people/a": deleted("a"),
      "DELETE /api/v1/people/b": problemResponse(409),
    });
    const progress: number[] = [];
    const pending = previewDeletionSelection(
      ["a", "b"],
      "workspace",
      new AbortController().signal,
      (n) => progress.push(n),
    );
    expect(api.calls()).toEqual(["GET /api/v1/people/a/deletion-impact"]);
    held.resolve(snapshot("a"));
    const previews = await pending;
    expect(progress).toEqual([1, 2]);
    expect(api.requests().every((request) => request.method === "GET")).toBe(
      true,
    );
    const answer = await deleteSelection(previews, "workspace");
    expect(answer.summary).toEqual({
      done: 1,
      failed: 1,
      skipped: 0,
      unchanged: 0,
    });
    expect(answer.results[1]).toEqual({
      personId: "b",
      outcome: "failed",
      code: "stale",
    });
    expect(api.bodies().slice(-2)).toEqual(
      ["a", "b"].map((id) => ({
        confirmation: `DELETE ${id}`,
        expectedUpdatedAt: impact(id).person.updatedAt,
      })),
    );
    expect(
      api.requests().every((request) =>
        request.headers.get("X-Workspace-Id") === "workspace"
      ),
    ).toBe(true);
  });

  it("reports unavailable and foreign people without exposing backend details", async () => {
    stubApi({
      "GET /api/v1/people/a/deletion-impact": problemResponse(404),
      "GET /api/v1/people/b/deletion-impact": problemResponse(503),
      "GET /api/v1/people/c/deletion-impact": snapshot("c"),
      "DELETE /api/v1/people/c": deleted("c"),
    });
    const previews = await previewDeletionSelection(
      ["a", "b", "c"],
      "workspace",
      new AbortController().signal,
      () => {},
    );
    expect((await deleteSelection(previews, "workspace")).results).toEqual([
      { personId: "a", outcome: "failed", code: "not_found" },
      { personId: "b", outcome: "failed", code: "unavailable" },
      { personId: "c", outcome: "done" },
    ]);
  });

  it("stops reading and writing after access is revoked", async () => {
    for (const status of [401, 403]) {
      const api = stubApi({
        "GET /api/v1/people/a/deletion-impact": problemResponse(status),
        "DELETE /api/v1/people/d": problemResponse(status),
      });
      const previews = await previewDeletionSelection(
        ["a", "b", "c"],
        "workspace",
        new AbortController().signal,
        () => {},
      );
      expect((await deleteSelection(previews, "workspace")).summary).toEqual({
        done: 0,
        failed: 1,
        skipped: 2,
        unchanged: 0,
      });
      const answer = await deleteSelection(
        ["d", "e"].map((id) => ({ personId: id, impact: impact(id) })),
        "workspace",
      );
      expect(answer.summary).toEqual({
        done: 0,
        failed: 1,
        skipped: 1,
        unchanged: 0,
      });
      expect(api.requests()).toHaveLength(2);
    }
  });

  it("stops previews when canceled before or during a read", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(
      await previewDeletionSelection(
        ["a"],
        "workspace",
        abort.signal,
        () => {},
      ),
    ).toEqual([]);
    const held = deferred<Response>();
    const api = stubApi({
      "GET /api/v1/people/a/deletion-impact": held.promise,
    });
    const active = new AbortController();
    const pending = previewDeletionSelection(
      ["a", "b"],
      "workspace",
      active.signal,
      () => {
        throw new Error("No stale progress");
      },
    );
    active.abort();
    held.resolve(snapshot("a"));
    expect(await pending).toEqual([]);
    expect(api.requests()).toHaveLength(1);
  });
});
