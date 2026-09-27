// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
  mountWorkspaceDanger,
  WORKSPACE_DANGER_ISLAND,
} from "./workspace-danger.tsx";

const SESSION = "GET /api/v1/session";
const PREVIEW = "GET /api/v1/settings/workspace-lifecycle";
const RESET = "POST /api/v1/settings/workspace-lifecycle/reset";
const DELETE = "DELETE /api/v1/settings/workspace-lifecycle";
const page = readFileSync(
  "apps/web/src/pages/app/settings/workspace/danger-zone.astro",
  "utf8",
);
const preview = {
  activeSessionCount: 2,
  confirmations: {
    deleteWorkspace: "DELETE Family",
    resetWorkspace: "RESET Family",
  },
  counts: { journalPosts: 3, people: 4 },
  impactToken: "a".repeat(64),
  status: "ready",
  workspace: { id: ids.workspace, name: "Family" },
};

function shell(): void {
  drawShell(
    "<main data-workspace-danger><div data-danger-surface></div></main>",
  );
}

const mount = (navigate = vi.fn()) =>
  mountSettled(() => mountWorkspaceDanger(document, navigate));
const status = () => element("[data-danger-status]");
const resetForm = () => element<HTMLFormElement>("[data-danger-reset]");
const deleteForm = () => element<HTMLFormElement>("[data-danger-delete]");
const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { hidden: true, name });

function fill(form: HTMLFormElement, confirmation: string): void {
  const scope = within(form);
  act(() => {
    fireEvent.input(scope.getByLabelText(/confirmation/i), {
      target: { value: confirmation },
    });
    fireEvent.input(scope.getByLabelText("Current password"), {
      target: { value: "current" },
    });
  });
}

function submit(form: HTMLFormElement): void {
  act(() => {
    fireEvent.submit(form);
  });
}

afterEach(() => sessionStorage.clear());

describe("WORKSPACE-002 workspace danger zone", () => {
  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(WORKSPACE_DANGER_ISLAND).toBe("settings-workspace-danger");
  });

  it("keeps destructive submissions disabled until current impact is ready", async () => {
    expect(page.match(/type="submit" disabled>/g)).toHaveLength(2);
    shell();
    const loaded = deferred<Response>();
    const api = stubApi({
      [PREVIEW]: loaded.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const settled = mountPending(() => mountWorkspaceDanger(document));
    await waitFor(() => expect(api.calls()).toContain(PREVIEW));
    expect(status().textContent).toBe("Loading current impact…");
    expect(button("Delete workspace").disabled).toBe(true);
    expect(button("Reset workspace data").disabled).toBe(true);
    fill(deleteForm(), "DELETE Family");
    submit(deleteForm());
    await act(async () => {
      loaded.resolve(jsonResponse(preview));
      await settled;
    });
    expect(button("Delete workspace").disabled).toBe(false);
    expect(api.calls()).toEqual([SESSION, PREVIEW]);
  });

  it("renders current impact and submits its authoritative token once", async () => {
    shell();
    sessionStorage.setItem("kinship.active-workspace", ids.workspace);
    const answered = deferred<Response>();
    const api = stubApi({
      [DELETE]: answered.promise,
      [PREVIEW]: jsonResponse(preview),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    expect(status().textContent).toBe(
      "Current impact loaded. Review it before confirming.",
    );
    const counts = element("[data-danger-counts]");
    expect(counts.hidden).toBe(false);
    expect(counts.textContent).toBe("journal posts3people4");
    expect(element("[data-danger-sessions]").textContent).toBe("2");
    expect(element("[data-reset-confirmation]").textContent).toBe(
      "RESET Family",
    );
    expect(element("[data-delete-confirmation]").textContent).toBe(
      "DELETE Family",
    );
    await expectNoAxeViolations(document.body);
    fill(deleteForm(), "DELETE Family");
    submit(deleteForm());
    expect(status().textContent).toBe(
      "Reauthenticating and revalidating current impact…",
    );
    expect(button("Delete workspace").disabled).toBe(true);
    submit(deleteForm());
    await act(async () => {
      answered.resolve(jsonResponse({
        cleanupStatus: "complete",
        next: "/auth/sign-in",
        status: "deleted",
      }));
      await answered.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/auth/sign-in"));
    expect(api.bodies()).toEqual([{
      confirmation: "DELETE Family",
      impactToken: "a".repeat(64),
      password: "current",
    }]);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
  });

  it("re-enables reset after revalidation refuses it or the server is unreachable", async () => {
    shell();
    stubApi({
      [PREVIEW]: jsonResponse(preview),
      [RESET]: [
        problemResponse(409, { detail: "Impact changed" }),
        unreachable,
      ],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    fill(resetForm(), "RESET Family");
    submit(resetForm());
    await waitFor(() => expect(status().textContent).toBe("Impact changed"));
    expect(button("Reset workspace data").disabled).toBe(false);
    submit(resetForm());
    await waitFor(() =>
      expect(status().textContent).toBe("The workspace was not changed.")
    );
    expect(button("Reset workspace data").disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("withdraws both forms without an owner session or an impact", async () => {
    for (
      const [routes, message] of [
        [{
          [SESSION]: jsonResponse(
            workspaceSession({ member: { id: ids.member, role: "admin" } }),
          ),
        }, "An active owner session could not be confirmed."],
        [
          { [SESSION]: unreachable },
          "An active owner session could not be confirmed.",
        ],
        [{
          [PREVIEW]: problemResponse(503, { detail: "Impact unavailable" }),
          [SESSION]: jsonResponse(workspaceSession()),
        }, "Impact unavailable"],
        [{
          [PREVIEW]: unreachable,
          [SESSION]: jsonResponse(workspaceSession()),
        }, "Current workspace impact could not be loaded."],
      ] as const
    ) {
      shell();
      stubApi(routes);
      const unmount = await mount();
      expect(status().textContent).toBe(message);
      expect(resetForm().hidden).toBe(true);
      expect(deleteForm().hidden).toBe(true);
      expect(element("[data-danger-counts]").hidden).toBe(true);
      unmount();
    }
  });

  it("holds both destructive actions while either is in flight", async () => {
    shell();
    const reset = deferred<Response>();
    const api = stubApi({
      [PREVIEW]: jsonResponse(preview),
      [RESET]: reset.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    fill(resetForm(), "RESET Family");
    fill(deleteForm(), "DELETE Family");
    submit(resetForm());
    expect(button("Reset workspace data").disabled).toBe(true);
    expect(button("Delete workspace").disabled).toBe(true);
    submit(deleteForm());
    expect(api.calls()).not.toContain(DELETE);
    await act(async () => {
      reset.resolve(problemResponse(409, { detail: "Impact changed" }));
      await reset.promise;
    });
    await waitFor(() =>
      expect(button("Delete workspace").disabled).toBe(false)
    );
  });
});
