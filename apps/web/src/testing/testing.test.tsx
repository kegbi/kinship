// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeFindings, expectNoAxeViolations } from "./a11y.ts";
import { deferred, jsonResponse, problemResponse, stubApi } from "./api.ts";
import { personProfile, sectionProps, workspaceSession } from "./fixtures.ts";
import {
  adoptMount,
  chooseOptions,
  drawShell,
  mountPending,
  mountSettled,
  renderIsland,
} from "./render.tsx";

const realFetch = globalThis.fetch;

describe("GAP-030 island test support", () => {
  it("answers routes by method and template and records each call", async () => {
    const api = stubApi({
      "GET /api/v1/people/:personId/gifts?giftCursor=next": jsonResponse({
        page: 2,
      }),
      "GET /api/v1/people/:personId/gifts": ({ params }) =>
        jsonResponse({ page: 1, personId: params.personId }),
      "POST /api/v1/people/:personId/gifts": problemResponse(409, {
        code: "conflict",
      }),
    });
    const first = await fetch("/api/v1/people/p%201/gifts");
    const again = await fetch("/api/v1/people/p%201/gifts");
    const next = await fetch("/api/v1/people/p1/gifts?giftCursor=next");
    const refused = await fetch("/api/v1/people/p1/gifts", {
      body: JSON.stringify({ name: "Book" }),
      method: "POST",
    });
    expect(await first.json()).toEqual({ page: 1, personId: "p 1" });
    expect(await again.json()).toEqual({ page: 1, personId: "p 1" });
    expect(await next.json()).toEqual({ page: 2 });
    expect(refused.status).toBe(409);
    expect(refused.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(await refused.json()).toMatchObject({
      code: "conflict",
      status: 409,
      type: "about:blank",
    });
    expect(api.calls()).toEqual([
      "GET /api/v1/people/p%201/gifts",
      "GET /api/v1/people/p%201/gifts",
      "GET /api/v1/people/p1/gifts?giftCursor=next",
      "POST /api/v1/people/p1/gifts",
    ]);
    expect(api.bodies()).toEqual([{ name: "Book" }]);
  });

  it("consumes a list answer one call at a time and serves held answers", async () => {
    const held = deferred<Response>();
    const api = stubApi({
      "GET /api/v1/today": [jsonResponse({ n: 1 }), held.promise],
    });
    expect(await (await fetch("/api/v1/today")).json()).toEqual({ n: 1 });
    const waiting = fetch("/api/v1/today");
    held.resolve(jsonResponse({ n: 2 }));
    expect(await (await waiting).json()).toEqual({ n: 2 });
    api.route("GET /api/v1/today", jsonResponse({ n: 3 }));
    expect(await (await fetch("/api/v1/today")).json()).toEqual({ n: 3 });
  });

  it("answers any method and path from a catch-all handler", async () => {
    const api = stubApi({
      "* /api/v1/*": ({ method, url }) =>
        jsonResponse({ method, path: url.pathname }),
    });
    const answer = await fetch("/api/v1/people/p1/notes", { method: "PUT" });
    expect(await answer.json()).toEqual({
      method: "PUT",
      path: "/api/v1/people/p1/notes",
    });
    expect(api.calls()).toEqual(["PUT /api/v1/people/p1/notes"]);
  });

  it.fails("fails the test when a request matches no route", async () => {
    stubApi({ "GET /api/v1/today": jsonResponse({}) });
    // The island would fold the rejection into "unavailable"; the stub
    // still fails the test once it finishes.
    await fetch("/api/v1/people").catch(() => undefined);
  });

  it("restored fetch after the tests before it", () => {
    expect(globalThis.fetch).toBe(realFetch);
    expect(document.body.innerHTML).toBe("");
  });

  it("mounts a section and unmounts it when the test ends", async () => {
    const body = drawShell('<section id="card"></section>');
    const held = deferred<void>();
    let unmounted = 0;
    const settled = mountPending(async () => {
      await held.promise;
      return () => unmounted += 1;
    });
    held.resolve();
    const unmount = await settled;
    unmount();
    unmount();
    expect(unmounted).toBe(1);
    await mountSettled(() => Promise.resolve(() => unmounted += 1));
    adoptMount(() => unmounted += 10)();
    expect(unmounted).toBe(11);
    expect(body.querySelector("#card")).not.toBeNull();
  });

  it("renders an island and waits until it is ready", async () => {
    const { island } = await renderIsland(<button type="button">Save</button>);
    expect(island.hasAttribute("data-island-ready")).toBe(true);
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    await expectNoAxeViolations(island);
  });

  it("chooses several options of a multiple select at once", () => {
    drawShell(
      '<select multiple aria-label="Tags"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>',
    );
    const select = document.querySelector("select")!;
    chooseOptions(select, ["a", "c"]);
    expect([...select.selectedOptions].map((option) => option.value)).toEqual([
      "a",
      "c",
    ]);
  });

  it("reports axe's structural findings", async () => {
    drawShell('<button type="button"></button><img src="x.png">');
    expect((await axeFindings()).map((finding) => finding.id).sort()).toEqual([
      "button-name",
      "image-alt",
    ]);
    await expect(expectNoAxeViolations()).rejects.toThrow("button-name");
  });

  it("builds contract-typed fixtures", () => {
    expect(personProfile({ person: { familyName: "Lovelace" } }).person)
      .toMatchObject({ familyName: "Lovelace", givenName: "Ada" });
    expect(sectionProps({ archived: true }).archived).toBe(true);
    expect(workspaceSession().workspaces).toHaveLength(1);
  });
});
