// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountImports } from "./imports.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const session = {
  member: { id: "member", role: "admin" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [],
};
const report = {
  counts: {
    contacts: 1,
    legacyCredentialsDiscarded: 1,
    missingFiles: 1,
    orphans: 0,
    unsupported: 0,
  },
  diagnostics: [{
    code: "missing-attachment",
    message: "One file is missing.",
    severity: "warning",
  }],
};
function newMarkup() {
  return `<main data-import-new><form data-import-form><input type="file"><button>Validate dry run</button></form><p data-import-detection></p><p data-import-state></p><section data-import-report hidden><span data-import-contacts></span><span data-import-missing></span><span data-import-credentials></span><span data-import-unsupported></span><ul data-import-diagnostics></ul><input data-import-confirm type="checkbox"><button data-import-commit disabled>Commit import</button></section></main>`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("IMPORT-001 settings import", () => {
  it("detects a file, renders dry-run diagnostics, and commits only after confirmation", async () => {
    document.body.innerHTML = newMarkup();
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        calls.push(path);
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.endsWith("/dry-runs")) {
          return Promise.resolve(
            response({
              importId: "00000000-0000-4000-8000-000000000010",
              report,
              status: "dry_run",
            }, 201),
          );
        }
        return Promise.resolve(
          response({
            importId: "00000000-0000-4000-8000-000000000010",
            peopleCreated: 1,
            peopleReused: 0,
            status: "completed",
          }),
        );
      }),
    );
    await mountImports();
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    Object.defineProperty(input, "files", {
      value: [
        new File(
          [JSON.stringify({
            format: "monica-json",
            version: 1,
            tables: { contacts: [] },
          })],
          "monica.json",
          { type: "application/json" },
        ),
      ],
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-import-detection]")?.textContent)
        .toContain("detected")
    );
    document.querySelector<HTMLFormElement>("[data-import-form]")!
      .requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-import-contacts]")?.textContent)
        .toBe("1")
    );
    const commit = document.querySelector<HTMLButtonElement>(
      "[data-import-commit]",
    )!;
    expect(commit.disabled).toBe(true);
    const confirm = document.querySelector<HTMLInputElement>(
      "[data-import-confirm]",
    )!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    commit.click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("1 created, 0 reused")
    );
    expect(calls).toEqual([
      "/api/v1/session",
      "/api/v1/imports/dry-runs",
      "/api/v1/imports/00000000-0000-4000-8000-000000000010/commit",
    ]);
  });

  it("serializes validation and never makes a replaced source response committable", async () => {
    document.body.innerHTML = newMarkup();
    let dryRuns = 0;
    let resolveDryRun!: (response: Response) => void;
    const pendingDryRun = new Promise<Response>((resolve) => {
      resolveDryRun = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.endsWith("/dry-runs")) {
          dryRuns++;
          return pendingDryRun;
        }
        throw new Error("stale import became committable");
      }),
    );
    await mountImports();
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    const select = async (id: number) => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [
          new File(
            [JSON.stringify({
              format: "monica-json",
              version: 1,
              tables: { contacts: [{ id, first_name: `Person ${id}` }] },
            })],
            `monica-${id}.json`,
            { type: "application/json" },
          ),
        ],
      });
      input.dispatchEvent(new Event("change"));
      await vi.waitFor(() =>
        expect(document.querySelector("[data-import-detection]")?.textContent)
          .toContain("detected")
      );
    };
    await select(1);
    const form = document.querySelector<HTMLFormElement>("[data-import-form]")!;
    form.requestSubmit();
    form.requestSubmit();
    await vi.waitFor(() => expect(dryRuns).toBe(1));
    expect(input.disabled).toBe(true);
    await select(2);
    resolveDryRun(response({
      importId: "00000000-0000-4000-8000-000000000010",
      report,
      status: "dry_run",
    }, 201));
    await vi.waitFor(() => expect(input.disabled).toBe(false));
    const confirm = document.querySelector<HTMLInputElement>(
      "[data-import-confirm]",
    )!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    expect(
      document.querySelector<HTMLButtonElement>("[data-import-commit]")
        ?.disabled,
    )
      .toBe(true);
    expect(document.querySelector<HTMLElement>("[data-import-report]")?.hidden)
      .toBe(true);
  });

  it("ignores a stale file read that finishes after a replacement", async () => {
    document.body.innerHTML = newMarkup();
    let dryRuns = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/v1/session") {
          return Promise.resolve(response(session));
        }
        if (path.endsWith("/dry-runs")) {
          dryRuns++;
          return Promise.resolve(response({
            importId: "00000000-0000-4000-8000-000000000010",
            report,
            status: "dry_run",
          }, 201));
        }
        throw new Error("stale file became committable");
      }),
    );
    await mountImports();
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    let resolveSlow!: (contents: string) => void;
    let slowReadFinished = false;
    const slowContents = new Promise<string>((resolve) => {
      resolveSlow = resolve;
    });
    const slowFile = new File([], "monica-a.json", {
      type: "application/json",
    });
    Object.defineProperty(slowFile, "text", {
      value: async () => {
        const contents = await slowContents;
        slowReadFinished = true;
        return contents;
      },
    });
    const replacement = new File(["{"], "monica-b.json", {
      type: "application/json",
    });
    const select = (file: File) => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [file],
      });
      input.dispatchEvent(new Event("change"));
    };

    select(slowFile);
    select(replacement);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-import-detection]")?.textContent)
        .toContain("not valid JSON")
    );
    resolveSlow(JSON.stringify({
      format: "monica-json",
      version: 1,
      tables: { contacts: [{ id: 1, first_name: "Stale A" }] },
    }));
    await vi.waitFor(() => expect(slowReadFinished).toBe(true));
    await Promise.resolve();

    expect(document.querySelector("[data-import-detection]")?.textContent)
      .toContain("not valid JSON");
    document.querySelector<HTMLFormElement>("[data-import-form]")!
      .requestSubmit();
    await Promise.resolve();
    expect(dryRuns).toBe(0);
    expect(document.querySelector("[data-import-state]")?.textContent)
      .toContain("Choose a supported Monica JSON export first");
    expect(document.querySelector<HTMLElement>("[data-import-report]")?.hidden)
      .toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-import-commit]")
        ?.disabled,
    ).toBe(true);
  });

  it("lists resumable import history and keeps member data hidden", async () => {
    document.body.innerHTML =
      `<main data-import-index><p data-import-state></p><button data-import-retry hidden></button><ol data-import-history></ol></main>`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          response(
            new URL(String(input), "http://localhost").pathname ===
                "/api/v1/session"
              ? session
              : {
                imports: [{
                  createdAt: "2026-08-23T10:00:00Z",
                  importId: "00000000-0000-4000-8000-000000000010",
                  report,
                  sourceProfile: "json_export",
                  status: "dry_run",
                }],
              },
          ),
        )
      ),
    );
    await mountImports();
    expect(document.querySelector("[data-import-history]")?.textContent)
      .toContain("Dry run");
    document.body.innerHTML =
      `<main data-import-index><p data-import-state></p><ol data-import-history><li>secret</li></ol></main>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          response({ ...session, member: { id: "member", role: "member" } }),
        )
      ),
    );
    await mountImports();
    expect(document.body.textContent).not.toContain("secret");
  });
});
