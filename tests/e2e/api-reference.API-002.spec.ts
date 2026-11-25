import { expect, test } from "./support/test.ts";
import { readFile } from "node:fs/promises";
import { createPerson, registerVerified } from "./support/api.ts";
import { origin, sessionCookieName } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

test("[API-002] visitors read and download the reference without JavaScript", {
  annotation: { type: "flow", description: "API-002" },
}, async ({ browser, page: accessibilityPage }) => {
  // The reference is the longest page there is, and axe reads all of it.
  test.setTimeout(120_000);
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: origin,
    ignoreHTTPSErrors: true,
    // Anchor navigation and schema expansion must settle before the pointer
    // returns to the header download link; do not test smooth-scroll timing.
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Public", exact: true })
      .getByRole("link", { name: "API", exact: true }).press("Enter");
    await expect(page).toHaveURL(/\/docs\/api\/?$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "public.api-reference",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "API reference",
    );
    await expect(page.getByRole("link", { name: "API", exact: true }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.locator("input, astro-island")).toHaveCount(0);
    await page.getByRole("navigation", { name: "API reference contents" })
      .getByRole("link", { name: "Operations", exact: true }).press("Enter");
    await expect(page).toHaveURL(/#operations$/);

    const response = await context.request.get(
      `${origin}/docs/api/openapi.json`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    const servedJson = await response.text();
    const document = await response.json() as {
      openapi: string;
      paths: Record<
        string,
        Record<
          string,
          {
            operationId: string;
            security: unknown;
            parameters?: { name: string }[];
          }
        >
      >;
      components: { schemas: Record<string, unknown> };
    };
    expect(document.openapi).toBe("3.1.0");
    const operations = Object.values(document.paths).flatMap(Object.values);
    // The served document is the bearer surface the registry derives; its
    // size grows with every token-enabled route, so only its rendering is pinned.
    expect(operations.length).toBeGreaterThan(0);
    // Read in one round trip: the page renders each operation exactly once.
    expect(
      (await page.locator("[data-api-operation]").evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-api-operation"))
      )).sort(),
    ).toEqual(operations.map(({ operationId }) => operationId).sort());
    for (const operation of operations) {
      expect(operation.security).toEqual([{ kinship_api_token: [] }]);
      expect(operation.parameters?.some(({ name }) => name === "Origin"))
        .toBeFalsy();
    }
    const address = page.locator("#schema-AddressFact");
    await address.locator("summary").press("Enter");
    expect(JSON.parse(await address.locator("pre").innerText())).toEqual(
      document.components.schemas.AddressFact,
    );
    const downloadLink = page.getByRole("link", {
      name: "Download OpenAPI 3.1",
      exact: true,
    });
    await expect(downloadLink).toHaveAttribute(
      "href",
      "/docs/api/openapi.json",
    );
    await expect(downloadLink).toHaveAttribute(
      "download",
      "kinship-openapi.json",
    );
    const downloadPromise = page.waitForEvent("download");
    await downloadLink.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("kinship-openapi.json");
    expect(await download.failure()).toBeNull();
    const downloadedJson = await readFile(await download.path(), "utf8");
    expect(downloadedJson).toBe(servedJson);
    expect(JSON.parse(downloadedJson)).toEqual(document);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/docs/api");
      await expect(page.getByRole("link", { name: "API", exact: true }))
        .toBeInViewport();
      expect(
        await page.getByRole("banner").locator("a").evaluateAll((links) =>
          links.filter((link) => {
            const bounds = link.getBoundingClientRect();
            return bounds.left < 0 || bounds.right > innerWidth;
          }).map((link) => link.textContent?.trim())
        ),
      ).toEqual([]);
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
      ).toBe(true);
    }
    expect(
      (await context.cookies()).some(({ name }) => name === sessionCookieName),
    ).toBe(false);
  } finally {
    await context.close();
  }
  // axe schedules page timers, which cannot run with JavaScript disabled.
  // Keep the actual reading/download/reflow checks above in the no-script context.
  await accessibilityPage.goto("/docs/api");
  await expectAccessible(accessibilityPage);
});

test(
  "[API-002] a focused code block or link inside an operation shows its whole focus ring",
  {
    annotation: { type: "flow", description: "API-002" },
  },
  async ({ page }) => {
    // An operation's `content-visibility: auto` clips paint at its padding box
    // (FER-14), and WebKit has no `overflow-clip-margin`, so the operation's
    // own padding must hold the ring of a block that sits flush with its edge.
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/docs/api");
      const operation = page.locator(".reference-operation").first();
      for (
        const target of [
          operation.locator(".response-list pre[tabindex]").first(),
          operation.getByRole("link", { name: "Back to operation index ↑" }),
        ]
      ) {
        await target.focus();
        const overflow = await target.evaluate((element) => {
          const style = getComputedStyle(element);
          const ring = parseFloat(style.outlineWidth) +
            parseFloat(style.outlineOffset);
          const clip = element.closest(".reference-operation")!;
          const box = clip.getBoundingClientRect();
          const edges = getComputedStyle(clip);
          const rect = element.getBoundingClientRect();
          return {
            focusVisible: element.matches(":focus-visible"),
            outline: style.outlineStyle,
            ring,
            left: box.left + parseFloat(edges.borderLeftWidth) -
              (rect.left - ring),
            right: rect.right + ring -
              (box.right - parseFloat(edges.borderRightWidth)),
            top: box.top + parseFloat(edges.borderTopWidth) - (rect.top - ring),
            bottom: rect.bottom + ring -
              (box.bottom - parseFloat(edges.borderBottomWidth)),
          };
        });
        expect(overflow).toMatchObject({
          focusVisible: true,
          outline: "solid",
        });
        expect(overflow.ring).toBeGreaterThan(0);
        for (const side of ["left", "right", "top", "bottom"] as const) {
          expect(overflow[side], `${width}px: ring past the ${side} edge`)
            .toBeLessThanOrEqual(0);
        }
      }
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
      ).toBe(true);
    }
  },
);

test(
  "[API-002] documented bearer automation retrieves a person, manages tasks, and captures an interaction",
  {
    annotation: { type: "flow", description: "API-002" },
  },
  async ({ page, request, playwright }) => {
    test.setTimeout(180_000);
    const email = `reference-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Reference",
      lastName: "Owner",
      workspaceName: "Automation circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email);
    const personId = await createPerson(page.request, { givenName: "Ada" });
    await page.goto("/app/settings/api");
    await expect(page.getByRole("link", { name: "Read the API reference" }))
      .toHaveAttribute("href", "/docs/api");
    await page.getByLabel("Token name").fill("Documented automation");
    for (
      const label of [
        "Read people",
        "Read person profiles",
        "Read tasks",
        "Create tasks",
        "Edit and complete tasks",
        "Record interactions",
      ]
    ) {
      await page.getByLabel(label, { exact: true }).check();
    }
    await page.getByRole("button", { name: "Create token", exact: true })
      .click();
    const secretInput = page.getByLabel("New API token secret");
    await expect(secretInput).toBeVisible();
    const secret = await secretInput.inputValue();
    // Separate context: real bearer requests have neither session cookies nor Origin.
    const automation = await playwright.request.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { Authorization: `Bearer ${secret}` },
    });
    try {
      const directory = await automation.get("/api/v1/people?limit=20");
      expect(directory.status()).toBe(200);
      expect(await directory.json()).toMatchObject({
        status: "ready",
        people: [{ id: personId }],
      });
      const identity = await automation.get(
        `/api/v1/people/${personId}/identity`,
      );
      expect(identity.status()).toBe(200);
      expect(await identity.json()).toMatchObject({
        status: "ready",
        person: { id: personId, givenName: "Ada" },
      });

      const body = {
        requestId: crypto.randomUUID(),
        personId,
        title: "Ask Ada about her trip",
      };
      const created = await automation.post("/api/v1/tasks", { data: body });
      expect(created.status()).toBe(201);
      const task = (await created.json() as { task: { id: string } }).task;
      const replay = await automation.post("/api/v1/tasks", { data: body });
      expect(replay.status()).toBe(201);
      expect((await replay.json()).task.id).toBe(task.id);
      const conflict = await automation.post("/api/v1/tasks", {
        data: { ...body, title: "Changed payload" },
      });
      expect(conflict.status()).toBe(409);
      expect(await conflict.json()).toMatchObject({
        code: "task_request_conflict",
      });
      const detail = await automation.get(`/api/v1/tasks/${task.id}`);
      expect(detail.status()).toBe(200);
      const current = await detail.json() as { task: { updatedAt: string } };
      const edited = await automation.patch(`/api/v1/tasks/${task.id}`, {
        data: {
          expectedUpdatedAt: current.task.updatedAt,
          title: "Call Ada about her trip",
          dueAt: null,
        },
      });
      expect(edited.status()).toBe(200);
      expect(await edited.json()).toMatchObject({
        status: "saved",
        task: { title: "Call Ada about her trip" },
      });
      const tasks = await automation.get(
        `/api/v1/tasks?personId=${personId}&status=open&limit=20`,
      );
      expect(tasks.status()).toBe(200);
      expect(await tasks.json()).toMatchObject({
        status: "ready",
        items: [{ id: task.id }],
      });
      for (const completed of [true, false]) {
        const completion = await automation.put(
          `/api/v1/tasks/${task.id}/completion`,
          { data: { completed } },
        );
        expect(completion.status()).toBe(200);
        expect(await completion.json()).toMatchObject({
          task: { status: completed ? "completed" : "open" },
        });
      }
      for (
        const path of [
          "/api/v1/interaction-options",
          "/api/v1/communication-options",
        ]
      ) {
        expect((await automation.get(path)).status()).toBe(200);
      }
      const note = {
        kind: "note",
        requestId: crypto.randomUUID(),
        personId,
        body: "Ada is planning a trip in November.",
      };
      const captured = await automation.post("/api/v1/interactions", {
        data: note,
      });
      expect(captured.status()).toBe(201);
      const capturedBody = await captured.json();
      expect(capturedBody).toMatchObject({
        status: "created",
        record: { kind: "note", body: note.body },
      });
      const recaptured = await automation.post("/api/v1/interactions", {
        data: note,
      });
      expect(recaptured.status()).toBe(201);
      expect((await recaptured.json()).record.id).toBe(capturedBody.record.id);
      // relationships:read was deliberately not granted.
      const refused = await automation.get(
        `/api/v1/people/${personId}/relationships`,
      );
      expect(refused.status()).toBe(401);
      expect(await refused.json()).toMatchObject({ code: "session_invalid" });

      await page.locator("[data-api-list] li", {
        hasText: "Documented automation",
      })
        .getByRole("button", { name: "Revoke", exact: true }).click();
      await expect(
        page.locator("[data-api-list] li", {
          hasText: "Documented automation",
        }),
      ).toContainText("Revoked");
      const revoked = await automation.get("/api/v1/tasks");
      expect(revoked.status()).toBe(401);
      expect(await revoked.json()).toMatchObject({ code: "session_invalid" });
    } finally {
      await automation.dispose();
    }
  },
);
