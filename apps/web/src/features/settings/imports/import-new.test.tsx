// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { IMPORT_NEW_ISLAND, mountNewImport } from "./import-new.tsx";
import { TOAST_REGION } from "../../../testing/shell.ts";
import { clearToasts } from "../../shell/toasts/toasts.ts";
import {
  clearSessionCache,
  resolveWorkspaceSession,
  SESSION_CACHE_KEY,
} from "../../../lib/workspace-context.ts";

const SESSION = "GET /api/v1/session";
const DRY_RUN = "POST /api/v1/imports/dry-runs";
const COMMIT = "POST /api/v1/imports/:id/commit";
const importId = "00000000-0000-4000-8000-000000000010";
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
const dryRun = () => jsonResponse({ importId, report, status: "dry_run" }, 201);
const monica = (id = 1) =>
  new File(
    [JSON.stringify({
      format: "monica-json",
      tables: { contacts: [{ first_name: `Person ${id}`, id }] },
      version: 1,
    })],
    `monica-${id}.json`,
    { type: "application/json" },
  );

function shell(): void {
  drawShell("<main data-import-new><div data-import-new-surface></div></main>");
}

const mount = () => mountSettled(() => mountNewImport());
const hook = (name: string) => element(`[data-import-${name}]`);
const input = () =>
  screen.getByLabelText<HTMLInputElement>("Monica JSON or SQL export");
const commit = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    hidden: true,
    name: "Commit import",
  });

async function choose(file: File | undefined): Promise<void> {
  Object.defineProperty(input(), "files", {
    configurable: true,
    value: file ? [file] : [],
  });
  await act(async () => {
    fireEvent.change(input());
    await Promise.resolve();
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(element<HTMLFormElement>("[data-import-form]"));
  });
}

function confirm(): void {
  act(() => {
    fireEvent.click(screen.getByLabelText("I confirm this validated import"));
  });
}

afterEach(() => {
  sessionStorage.clear();
  clearToasts();
});

it("shows commit progress, prevents duplicate commits, and announces dismissible completion counts", async () => {
  shell();
  document.body.insertAdjacentHTML("beforeend", TOAST_REGION);
  const pending = deferred<Response>();
  const api = stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [DRY_RUN]: dryRun(),
    [COMMIT]: pending.promise,
  });
  await mount();
  await choose(monica());
  submit();
  await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
  confirm();
  const button = commit();
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  expect(screen.getByRole("dialog", { name: "Importing your data" }))
    .toBeDefined();
  expect(
    screen.getByRole("progressbar", { name: "Import in progress" })
      .hasAttribute("aria-valuenow"),
  ).toBe(false);
  expect(input().disabled).toBe(true);
  await act(() =>
    pending.resolve(jsonResponse({
      importId,
      peopleCreated: 2,
      peopleReused: 1,
      peopleSkippedDeleted: 3,
      status: "completed",
    }))
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: "Open import report" }),
    )
  );
  expect(api.calls().filter((call) => call.endsWith("/commit"))).toHaveLength(
    1,
  );
  expect(element("#app-toasts").textContent).toContain(
    "2 created, 1 reused, 3 skipped",
  );
  expect(element("#app-toasts > li").dataset.tone).toBe("success");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
  expect(element("#app-toasts").children).toHaveLength(0);
});

it("closes commit progress and shows a dismissible error without announcing completion", async () => {
  shell();
  document.body.insertAdjacentHTML("beforeend", TOAST_REGION);
  stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [DRY_RUN]: dryRun(),
    [COMMIT]: problemResponse(503, { detail: "Try again." }),
  });
  await mount();
  await choose(monica());
  submit();
  await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
  confirm();
  fireEvent.click(commit());
  await waitFor(() => expect(hook("state").textContent).toBe("Try again."));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(element("#app-toasts > li").dataset.tone).toBe("error");
  expect(element("#app-toasts").textContent).toContain("Try again.");
  expect(commit().disabled).toBe(false);
  await waitFor(() => expect(document.activeElement).toBe(commit()));
});

it("AUD-F3 drops the session after a commit, so the next page reads the imported time zone", async () => {
  shell();
  const api = stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [DRY_RUN]: dryRun(),
    [COMMIT]: jsonResponse({
      importId,
      peopleCreated: 1,
      peopleReused: 0,
      peopleSkippedDeleted: 0,
      status: "completed",
    }),
  });
  await mount();
  expect(sessionStorage.getItem(SESSION_CACHE_KEY)).not.toBeNull();
  await choose(monica());
  submit();
  await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
  confirm();
  fireEvent.click(commit());
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Open import report" }))
      .toBeDefined()
  );

  // A Monica commit can set the member's own time zone, which the session's
  // preferences carry; the next page reads them again.
  expect(sessionStorage.getItem(SESSION_CACHE_KEY)).toBeNull();
  await resolveWorkspaceSession();
  expect(api.calls().filter((call) => call === SESSION)).toHaveLength(2);
});

it("keeps the session when a commit is refused", async () => {
  shell();
  const api = stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [DRY_RUN]: dryRun(),
    [COMMIT]: problemResponse(503, { detail: "Try again." }),
  });
  await mount();
  await choose(monica());
  submit();
  await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
  confirm();
  fireEvent.click(commit());
  await waitFor(() => expect(hook("state").textContent).toBe("Try again."));

  expect(sessionStorage.getItem(SESSION_CACHE_KEY)).not.toBeNull();
  await resolveWorkspaceSession();
  expect(api.calls().filter((call) => call === SESSION)).toHaveLength(1);
});

describe("IMPORT-001 settings import", () => {
  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(IMPORT_NEW_ISLAND).toBe("settings-import-new");
  });

  it("detects a file, renders dry-run diagnostics, and commits only after confirmation", async () => {
    shell();
    const api = stubApi({
      [COMMIT]: jsonResponse({
        importId,
        peopleCreated: 1,
        peopleReused: 0,
        peopleSkippedDeleted: 0,
        status: "completed",
      }),
      [DRY_RUN]: dryRun(),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    expect(hook("detection").textContent).toBe(
      "Choose an export to detect its format.",
    );
    await choose(monica());
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Monica JSON version 1 detected.",
      )
    );
    submit();
    expect(hook("state").textContent).toBe("Validating bounded staging…");
    expect(input().disabled).toBe(true);
    await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
    expect(hook("state").textContent).toBe(
      "Dry run complete. Review the report before committing.",
    );
    expect(input().disabled).toBe(false);
    expect(hook("report").hidden).toBe(false);
    expect(hook("missing").textContent).toBe("1");
    expect(hook("credentials").textContent).toBe("1");
    expect(hook("orphans").textContent).toBe("0");
    expect(hook("unsupported").textContent).toBe("0");
    const diagnostic = hook("diagnostics").querySelector("li")!;
    expect(diagnostic.textContent).toBe("One file is missing.");
    expect(diagnostic.dataset.severity).toBe("warning");
    await expectNoAxeViolations(document.body);
    expect(commit().disabled).toBe(true);
    confirm();
    expect(commit().disabled).toBe(false);
    act(() => {
      fireEvent.click(commit());
    });
    expect(hook("state").textContent).toBe("Committing validated import…");
    const link = await screen.findByRole("link", {
      name: "Open import report",
    });
    expect(link.getAttribute("href")).toBe(`/app/settings/import/${importId}`);
    expect(hook("state").textContent).toBe(
      "Import completed: 1 created, 0 reused.",
    );
    expect(api.calls()).toEqual([
      SESSION,
      DRY_RUN,
      `POST /api/v1/imports/${importId}/commit`,
    ]);
    expect((api.bodies()[0] as { source: { format: string } }).source.format)
      .toBe("monica-json");
  });

  it("detects a file chosen before the session resolved", async () => {
    shell();
    const session = deferred<Response>();
    stubApi({ [SESSION]: session.promise });
    const settled = mountPending(() => mountNewImport());
    await choose(monica());
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Monica JSON version 1 detected.",
      )
    );
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    expect(hook("detection").textContent).toBe(
      "Monica JSON version 1 detected.",
    );
  });

  it("keeps a validation submitted before the session resolved off the URL and runs it once the file is detected", async () => {
    shell();
    const session = deferred<Response>();
    const api = stubApi({ [DRY_RUN]: dryRun(), [SESSION]: session.promise });
    const settled = mountPending(() => mountNewImport());
    await choose(monica());
    const early = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      element("[data-import-form]").dispatchEvent(early);
    });
    expect(early.defaultPrevented).toBe(true);
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
    expect(api.calls()).toEqual([SESSION, DRY_RUN]);
  });

  it("serializes validation and never makes a replaced source response committable", async () => {
    shell();
    const answered = deferred<Response>();
    const api = stubApi({
      [DRY_RUN]: answered.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    await choose(monica(1));
    submit();
    submit();
    expect(api.calls().filter((call) => call === DRY_RUN)).toHaveLength(1);
    expect(input().disabled).toBe(true);
    await choose(monica(2));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Monica JSON version 1 detected.",
      )
    );
    await act(async () => {
      answered.resolve(dryRun());
      await answered.promise;
    });
    await waitFor(() => expect(input().disabled).toBe(false));
    expect(hook("state").textContent).toBe(
      "Source changed. Validate the selected export.",
    );
    confirm();
    expect(commit().disabled).toBe(true);
    expect(hook("report").hidden).toBe(true);
  });

  it("ignores a stale file read that finishes after a replacement", async () => {
    shell();
    const api = stubApi({ [SESSION]: jsonResponse(workspaceSession()) });
    await mount();
    const slow = deferred<string>();
    const slowFile = new File([], "monica-a.json");
    Object.defineProperty(slowFile, "text", { value: () => slow.promise });
    await choose(slowFile);
    await choose(new File(["{"], "monica-b.json"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This file is not valid JSON.",
      )
    );
    await act(async () => {
      slow.resolve(JSON.stringify({ format: "monica-json", version: 1 }));
      await slow.promise;
    });
    expect(hook("detection").textContent).toBe("This file is not valid JSON.");
    submit();
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "Choose a supported Monica JSON or SQL export first.",
      )
    );
    expect(api.calls()).toEqual([SESSION]);
    expect(hook("report").hidden).toBe(true);
    expect(commit().disabled).toBe(true);
  });

  it("refuses unsupported, oversized, unreadable, and absent files", async () => {
    shell();
    stubApi({ [SESSION]: jsonResponse(workspaceSession()) });
    await mount();
    await choose(new File([JSON.stringify({ format: "vcard" })], "a.json"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Unsupported export. Choose Monica JSON version 1.",
      )
    );
    const large = new File([], "large.json");
    Object.defineProperty(large, "size", { value: 1_500_001 });
    await choose(large);
    expect(hook("detection").textContent).toBe(
      "This file exceeds the 1.5 MB staging limit.",
    );
    const unreadable = new File([], "broken.json");
    Object.defineProperty(unreadable, "text", {
      value: () => Promise.reject(new Error("unreadable")),
    });
    await choose(unreadable);
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This export could not be read.",
      )
    );
    await choose(undefined);
    expect(hook("detection").textContent).toBe(
      "Choose an export to detect its format.",
    );
  });

  it("keeps refused validation and commit retryable", async () => {
    shell();
    stubApi({
      [COMMIT]: [
        problemResponse(409, { detail: "Import already committed." }),
        unreachable,
      ],
      [DRY_RUN]: [
        problemResponse(413, { detail: "Too many rows." }),
        unreachable,
        dryRun(),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    await choose(monica());
    await waitFor(() =>
      expect(hook("detection").textContent).toContain("detected")
    );
    for (
      const expected of ["Too many rows.", "The import could not be validated."]
    ) {
      submit();
      await waitFor(() => expect(hook("state").textContent).toBe(expected));
      expect(input().disabled).toBe(false);
    }
    submit();
    await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
    confirm();
    for (
      const expected of [
        "Import already committed.",
        "The import could not be committed.",
      ]
    ) {
      act(() => {
        fireEvent.click(commit());
      });
      await waitFor(() => expect(hook("state").textContent).toBe(expected));
      expect(commit().disabled).toBe(false);
    }
  });

  it("shows the admin-only and unconfirmed states", async () => {
    for (
      const [answer, message, withForm] of [
        [
          jsonResponse(
            workspaceSession({ member: { id: ids.member, role: "member" } }),
          ),
          "Workspace import requires owner or administrator access.",
          false,
        ],
        [unreachable, "Your session could not be confirmed.", true],
      ] as const
    ) {
      shell();
      clearSessionCache();
      stubApi({ [SESSION]: answer });
      const unmount = await mount();
      expect(hook("state").textContent).toBe(message);
      expect(document.querySelector("[data-import-form]") !== null).toBe(
        withForm,
      );
      unmount();
    }
  });

  it("holds Validate dry run while the chosen file is still being read", async () => {
    shell();
    stubApi({
      [DRY_RUN]: dryRun(),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    const slow = deferred<string>();
    const file = monica();
    Object.defineProperty(file, "text", { value: () => slow.promise });
    await choose(file);
    submit();
    const validate = screen.getByRole<HTMLButtonElement>("button", {
      name: "Validate dry run",
    });
    expect(validate.disabled).toBe(true);
    await act(async () => {
      slow.resolve(JSON.stringify({ format: "monica-json", version: 1 }));
      await slow.promise;
    });
    await waitFor(() => expect(hook("contacts").textContent).toBe("1"));
    expect(validate.disabled).toBe(false);
  });

  it("detects a file picked in the page before the island mounted", async () => {
    drawShell(
      '<main data-import-new><div data-import-new-surface><input id="import-source" type="file"></div></main>',
    );
    Object.defineProperty(element("#import-source"), "files", {
      value: [monica()],
    });
    stubApi({ [SESSION]: jsonResponse(workspaceSession()) });
    await mount();
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Monica JSON version 1 detected.",
      )
    );
  });
});

it.each([0, 2])(
  "requires an explicit contact type choice for %i methods and sends creation only on confirmed commit",
  async (count) => {
    shell();
    const api = stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [DRY_RUN]: jsonResponse({
        importId,
        status: "dry_run",
        report: {
          ...report,
          contactMethodTypes: {
            proposals: [{
              key: "7:2",
              name: "Chat handle",
              kind: "custom",
              protocol: "chat",
              count,
              canCreate: true,
            }],
            existingTypes: [],
          },
        },
      }),
      [COMMIT]: jsonResponse({
        importId,
        status: "completed",
        peopleCreated: 1,
        peopleReused: 0,
        peopleSkippedDeleted: 0,
      }),
    });
    await mount();
    await choose(monica());
    submit();
    const choice = await screen.findByLabelText(
      `Chat handle (${count === 0 ? "unused type" : `${count} methods`})`,
    );
    confirm();
    expect(commit().disabled).toBe(true);
    fireEvent.change(choice, { target: { value: "create" } });
    expect(commit().disabled).toBe(true);
    confirm();
    expect(commit().disabled).toBe(false);
    fireEvent.click(commit());
    await waitFor(() =>
      expect(api.calls().filter((call) => call.includes("/commit")))
        .toHaveLength(
          1,
        )
    );
    expect(
      api.requests().find((call) => call.url.pathname.includes("/commit"))
        ?.body,
    ).toEqual({
      confirmed: true,
      contactMethodTypes: [{ sourceKey: "7:2", action: "create" }],
    });
  },
);

it("requires Monica timezone and per-contact genders, applies bulk currency with exact individual overrides, retains retries and clears revalidation", async () => {
  shell();
  const monicaChoices = {
    currencyMinorUnits: { EUR: 2, JPY: 0, KWD: 3 },
    currencies: ["EUR", "JPY", "KWD"],
    genders: [{ id: "from-source", name: "Source option", source: true }],
    debts: [{
      sourceKey: "1",
      contactName: "Ada",
      rawAmount: "56000",
      minorUnits: false,
      reason: "Travel",
      direction: "i_owe",
    }, {
      sourceKey: "2",
      contactName: "Ada",
      rawAmount: "56000.25",
      minorUnits: false,
      direction: "they_owe",
    }],
    contacts: [{ sourceKey: "1", contactName: "Ada", sourceGender: "999" }, {
      sourceKey: "2",
      contactName: "Grace",
      sourceGender: "888",
    }],
  };
  const api = stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [DRY_RUN]: jsonResponse({
      importId,
      report: { ...report, monicaChoices },
      status: "dry_run",
    }),
    [COMMIT]: problemResponse(503, { detail: "Try again." }),
  });
  await mount();
  await choose(monica());
  submit();
  const timezone = await screen.findByLabelText("Your timezone");
  confirm();
  expect(commit().disabled).toBe(true);
  expect(timezone.getAttribute("role")).toBe("combobox");
  act(() => timezone.focus());
  fireEvent.input(timezone, {
    target: { value: "UT" },
    inputType: "insertText",
  });
  fireEvent.click(
    await screen.findByRole("option", { name: "UTC" }),
  );
  fireEvent.change(screen.getByLabelText("Currency for all debts"), {
    target: { value: "EUR" },
  });
  expect(commit().disabled).toBe(true);
  fireEvent.click(
    screen.getByRole("button", { name: "Apply currency to all debts" }),
  );
  expect(screen.getByText("56000 EUR")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Ada — debt 2"), {
    target: { value: "KWD" },
  });
  expect(screen.getByText("56000.25 KWD")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Ada — gender"), {
    target: { value: "unspecified" },
  });
  fireEvent.change(screen.getByLabelText("Grace — gender"), {
    target: { value: "source:from-source" },
  });
  confirm();
  expect(commit().disabled).toBe(false);
  fireEvent.click(commit());
  await waitFor(() => expect(hook("state").textContent).toBe("Try again."));
  expect((screen.getByLabelText("Your timezone") as HTMLInputElement).value)
    .toBe("UTC");
  expect((screen.getByLabelText("Ada — debt 2") as HTMLSelectElement).value)
    .toBe("KWD");
  expect(api.requests().find((c) => c.url.pathname.includes("/commit"))?.body)
    .toEqual({
      confirmed: true,
      monicaChoices: {
        timezone: "UTC",
        currencies: [{ sourceKey: "1", currencyCode: "EUR" }, {
          sourceKey: "2",
          currencyCode: "KWD",
        }],
        genders: [{ sourceKey: "1", action: "unspecified" }, {
          sourceKey: "2",
          action: "source",
          genderId: "from-source",
        }],
      },
    });
  fireEvent.change(screen.getByLabelText("Grace — gender"), {
    target: { value: "create" },
  });
  confirm();
  expect(commit().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("New gender option for Grace"), {
    target: { value: "Custom" },
  });
  confirm();
  expect(commit().disabled).toBe(false);
  submit();
  await waitFor(() =>
    expect((screen.getByLabelText("Your timezone") as HTMLInputElement).value)
      .toBe("")
  );
  expect((screen.getByLabelText("Ada — debt 1") as HTMLSelectElement).value)
    .toBe("");
  expect(commit().disabled).toBe(true);
  await expectNoAxeViolations();
});
