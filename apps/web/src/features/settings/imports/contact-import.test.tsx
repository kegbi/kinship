// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { mountNewImport } from "./import-new.tsx";
import { mountImportReport } from "./import-report.tsx";

const SESSION = "GET /api/v1/session";
const DRY_RUN = "POST /api/v1/imports/dry-runs";
const MAPPING = "POST /api/v1/imports/:id/mapping";
const REPORT = "GET /api/v1/imports/:id";
const importId = "00000000-0000-4000-8000-000000000020";
const report = {
  counts: {
    contacts: 2,
    legacyCredentialsDiscarded: 0,
    missingFiles: 0,
    orphans: 0,
    unsupported: 1,
  },
  diagnostics: [{
    code: "skipped-properties",
    message:
      "1 vCard property will be skipped: PHOTO (1). Photos are not imported.",
    severity: "skipped",
  }],
};
const preview = {
  delimiter: ";",
  headers: ["First name", "E-mail", "Shoe size"],
  rowCount: 7,
  rows: [["Ada", "ada@example.com", "38"], ["Grace", "", "40"]],
  suggested: ["givenName", "email", "ignore"],
};
const vcard = "BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ada\r\nEND:VCARD\r\n";

function shell(): void {
  drawShell("<main data-import-new><div data-import-new-surface></div></main>");
}
const hook = (name: string) => element(`[data-import-${name}]`);

async function choose(label: string, file: File | undefined): Promise<void> {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  Object.defineProperty(input, "files", {
    configurable: true,
    value: file ? [file] : [],
  });
  await act(async () => {
    fireEvent.change(input);
    await Promise.resolve();
  });
}

function pick(source: string): void {
  act(() => {
    fireEvent.click(screen.getByLabelText(source));
  });
}

function submit(): void {
  act(() => {
    fireEvent.submit(element<HTMLFormElement>("[data-import-form]"));
  });
}

afterEach(() => sessionStorage.clear());

describe("IMPORT-002 contact imports", () => {
  it("validates a vCard and lists what it skips", async () => {
    shell();
    const api = stubApi({
      [DRY_RUN]: jsonResponse({ importId, report, status: "dry_run" }, 201),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountNewImport());
    expect(screen.getByLabelText<HTMLInputElement>("Monica backup").checked)
      .toBe(true);
    pick("vCard");
    expect(hook("detection").textContent).toBe(
      "Choose a file to detect its format.",
    );
    const input = screen.getByLabelText<HTMLInputElement>("vCard file");
    expect(input.accept).toContain(".vcf");
    await choose("vCard file", new File([vcard], "people.vcf"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe("vCard file detected.")
    );
    submit();
    await waitFor(() => expect(hook("contacts").textContent).toBe("2"));
    expect(hook("diagnostics").textContent).toContain("PHOTO (1)");
    expect(api.bodies()[0]).toEqual({
      source: { format: "vcard", text: vcard },
    });
    await expectNoAxeViolations(document.body);
  });

  it("refuses a file that is not UTF-8 or not a vCard before uploading it", async () => {
    shell();
    const api = stubApi({ [SESSION]: jsonResponse(workspaceSession()) });
    await mountSettled(() => mountNewImport());
    pick("CSV");
    await choose(
      "CSV file",
      new File([new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xe9])], "a.csv"),
    );
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This file is not UTF-8 encoded. Save it as UTF-8 and try again.",
      )
    );
    await choose("CSV file", new File(["﻿  \n"], "b.csv"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This CSV file has no header row.",
      )
    );
    pick("vCard");
    await choose("vCard file", new File(["hello"], "c.vcf"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This file does not look like a vCard.",
      )
    );
    submit();
    await waitFor(() =>
      expect(hook("state").textContent).toBe("Choose a supported file first.")
    );
    expect(api.calls()).toEqual([SESSION]);
  });

  it("maps a CSV's columns from its preview, then shows the dry run", async () => {
    shell();
    const api = stubApi({
      [DRY_RUN]: jsonResponse({ importId, preview, status: "mapping" }, 201),
      [MAPPING]: [
        problemResponse(400, {
          code: "import_mapping_invalid",
          detail: "Map at least one column to a name, email, or phone.",
        }),
        jsonResponse({ importId, report, status: "dry_run" }),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountNewImport());
    pick("CSV");
    await choose(
      "CSV file",
      new File(["First name;E-mail\nAda;ada@example.com\n"], "people.csv"),
    );
    await waitFor(() =>
      expect(hook("detection").textContent).toBe("CSV file detected.")
    );
    submit();
    const heading = await screen.findByRole("heading", { name: "Map columns" });
    expect(document.activeElement).toBe(heading);
    expect(hook("state").textContent).toBe(
      "Map each column to a field, or choose Ignore, then apply the mapping.",
    );
    expect(hook("mapping").textContent).toContain("7 rows. The first 2 rows");
    expect(screen.getByRole("cell", { name: "ada@example.com" })).toBeTruthy();
    const email = screen.getByLabelText<HTMLSelectElement>("E-mail");
    expect(email.value).toBe("email");
    expect(screen.getByLabelText<HTMLSelectElement>("Shoe size").value).toBe(
      "ignore",
    );
    await expectNoAxeViolations(document.body);
    act(() => {
      fireEvent.change(email, { target: { value: "note" } });
    });
    await act(async () => {
      fireEvent.submit(element<HTMLFormElement>("[data-import-mapping-form]"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "Map at least one column to a name, email, or phone.",
      )
    );
    expect(screen.getByLabelText<HTMLSelectElement>("E-mail").value).toBe(
      "note",
    );
    await act(async () => {
      fireEvent.submit(element<HTMLFormElement>("[data-import-mapping-form]"));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook("contacts").textContent).toBe("2"));
    expect(document.querySelector("[data-import-mapping]")).toBeNull();
    expect(api.calls()).toEqual([
      SESSION,
      DRY_RUN,
      `POST /api/v1/imports/${importId}/mapping`,
      `POST /api/v1/imports/${importId}/mapping`,
    ]);
    expect(api.bodies()).toEqual([
      {
        source: {
          format: "csv",
          text: "First name;E-mail\nAda;ada@example.com\n",
        },
      },
      { columns: ["givenName", "note", "ignore"] },
      { columns: ["givenName", "note", "ignore"] },
    ]);
  });

  it("asks again for a file that is cleared or cannot be read", async () => {
    shell();
    stubApi({ [SESSION]: jsonResponse(workspaceSession()) });
    await mountSettled(() => mountNewImport());
    pick("CSV");
    const unreadable = new File(["x"], "broken.csv");
    Object.defineProperty(unreadable, "arrayBuffer", {
      value: () => Promise.reject(new Error("gone")),
    });
    await choose("CSV file", unreadable);
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "This file could not be read.",
      )
    );
    await choose("CSV file", undefined);
    await waitFor(() =>
      expect(hook("detection").textContent).toBe(
        "Choose a file to detect its format.",
      )
    );
  });

  it("applies one mapping at a time and says so when the answer is empty", async () => {
    shell();
    const answer = deferred<Response>();
    const api = stubApi({
      [DRY_RUN]: jsonResponse({
        importId,
        preview: {
          ...preview,
          headers: ["", "E-mail"],
          rowCount: 1,
          rows: [["Ada"]],
          suggested: ["givenName", "email"],
        },
        status: "mapping",
      }, 201),
      [MAPPING]: answer.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountNewImport());
    pick("CSV");
    await choose("CSV file", new File([",E-mail\nAda\n"], "one.csv"));
    await waitFor(() =>
      expect(hook("detection").textContent).toBe("CSV file detected.")
    );
    submit();
    await screen.findByRole("heading", { name: "Map columns" });
    expect(hook("mapping").textContent).toContain(
      "1 row. The first row is shown.",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Column 1").value).toBe(
      "givenName",
    );
    const form = element<HTMLFormElement>("[data-import-mapping-form]");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(hook("state").textContent).toBe("Applying the mapping…")
    );
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    await act(async () => {
      answer.resolve(jsonResponse({}, 500));
      await answer.promise;
    });
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "The mapping could not be applied.",
      )
    );
    expect(
      api.calls().filter((call) => call.endsWith("/mapping")),
    ).toHaveLength(1);
  });

  it("resumes a CSV import awaiting its mapping from the history link", async () => {
    shell();
    stubApi({
      [REPORT]: jsonResponse({
        createdAt: "2026-09-27T10:00:00.000Z",
        importId,
        preview,
        report: { ...report, counts: { ...report.counts, contacts: 0 } },
        sourceProfile: "csv",
        sourceSystem: "csv",
        status: "pending",
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountNewImport(document, `?import=${importId}`));
    await screen.findByRole("heading", { name: "Map columns" });
    expect(screen.getByLabelText<HTMLInputElement>("CSV").checked).toBe(true);
  });

  it("never lets a late resume replace a source the reader chose", async () => {
    shell();
    const resumed = deferred<Response>();
    stubApi({
      [REPORT]: resumed.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const settled = mountPending(() =>
      mountNewImport(document, `?import=${importId}`)
    );
    await waitFor(() => screen.getByLabelText("vCard"));
    pick("vCard");
    await choose("vCard file", new File([vcard], "people.vcf"));
    await act(async () => {
      resumed.resolve(jsonResponse({
        createdAt: "2026-09-27T10:00:00.000Z",
        importId,
        preview,
        report,
        sourceProfile: "csv",
        sourceSystem: "csv",
        status: "pending",
      }));
      await settled;
    });
    expect(document.querySelector("[data-import-mapping]")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("vCard").checked).toBe(
      true,
    );
  });

  it("links a pending CSV import's report back to its mapping step", async () => {
    drawShell(
      "<main><div data-import-report-surface></div></main>",
    );
    stubApi({
      [REPORT]: jsonResponse({
        createdAt: "2026-09-27T10:00:00.000Z",
        importId,
        preview,
        report,
        sourceProfile: "csv",
        sourceSystem: "csv",
        status: "pending",
      }),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() =>
      mountImportReport(document, `/app/settings/import/${importId}`)
    );
    const resume = await screen.findByRole("link", {
      name: "Continue column mapping",
    });
    expect(resume.getAttribute("href")).toBe(
      `/app/settings/import/new?import=${importId}`,
    );
    expect(hook("status").textContent).toBe("Awaiting column mapping");
  });

  it("says so when the linked import no longer awaits a mapping", async () => {
    shell();
    stubApi({
      [REPORT]: problemResponse(404),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mountSettled(() => mountNewImport(document, `?import=${importId}`));
    await waitFor(() =>
      expect(hook("state").textContent).toBe(
        "That import is not awaiting a column mapping.",
      )
    );
    expect(document.querySelector("[data-import-mapping]")).toBeNull();
  });
});
