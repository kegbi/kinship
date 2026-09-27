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
  mountPersonalLifecycle,
  PERSONAL_LIFECYCLE_ISLAND,
} from "./personal-lifecycle.tsx";

const SESSION = "GET /api/v1/session";
const PREVIEW = "GET /api/v1/settings/personal-lifecycle";
const LEAVE = "POST /api/v1/settings/personal-lifecycle/leave";
const DELETE = "DELETE /api/v1/settings/personal-lifecycle";
const profilePage = readFileSync(
  "apps/web/src/pages/app/settings/profile.astro",
  "utf8",
);

const membership = (overrides: object = {}) => ({
  finalOwner: false,
  id: ids.member,
  role: "owner",
  status: "active",
  workspace: { id: ids.workspace, name: "Circle" },
  ...overrides,
});
const preview = (overrides: object = {}) => ({
  activeSessionCount: 2,
  blockingWorkspaces: [],
  confirmations: {
    deleteIdentity: "DELETE owner@example.test",
    leaveWorkspace: "LEAVE Circle",
  },
  memberships: [
    membership(),
    membership({
      id: "member-next",
      role: "member",
      workspace: { id: "workspace-next", name: "Friends" },
    }),
  ],
  retainedLegalRecords: true,
  status: "ready",
  ...overrides,
});

function shell(): void {
  drawShell('<main><section id="account-lifecycle"></section></main>');
}

const mount = (navigate = vi.fn()) =>
  mountSettled(() => mountPersonalLifecycle(document, navigate));
const leaveForm = () => element<HTMLFormElement>("#leave-workspace-form");
const deleteForm = () => element<HTMLFormElement>("#delete-identity-form");
const status = () => element("#lifecycle-status");
const leave = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Leave workspace" });
const remove = () =>
  screen.getByRole<HTMLButtonElement>("button", {
    name: "Delete personal identity",
  });

function fill(form: HTMLFormElement, confirmation: string, password: string) {
  const scope = within(form);
  act(() => {
    fireEvent.input(scope.getByLabelText(/confirmation/i), {
      target: { value: confirmation },
    });
    fireEvent.input(scope.getByLabelText("Current password"), {
      target: { value: password },
    });
  });
}

function submit(form: HTMLFormElement): void {
  act(() => {
    fireEvent.submit(form);
  });
}

afterEach(() => sessionStorage.clear());

describe("AUTH-005 personal lifecycle", () => {
  it("does nothing when the panel is absent", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(PERSONAL_LIFECYCLE_ISLAND).toBe("settings-personal-lifecycle");
  });

  it("labels mixed active and suspended membership impact truthfully", async () => {
    shell();
    stubApi({
      [PREVIEW]: jsonResponse(preview({
        memberships: [
          membership(),
          membership({
            id: "member-next",
            role: "member",
            status: "suspended",
            workspace: { id: "workspace-next", name: "Friends" },
          }),
        ],
      })),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    expect(element("#lifecycle-membership-count").textContent).toBe("2");
    expect(element("#lifecycle-session-count").textContent).toBe("2");
    expect(element("#lifecycle-loading").hidden).toBe(true);
    expect(element("#lifecycle-counts").hidden).toBe(false);
    const list = screen.getByRole("list", { name: "Affected memberships" });
    expect(
      within(list).getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Circleowner", "Friendsmember · suspended"]);
    expect(element("#leave-confirmation-value").textContent).toBe(
      "LEAVE Circle",
    );
    expect(element("#delete-confirmation-value").textContent).toBe(
      "DELETE owner@example.test",
    );
    expect(element("#lifecycle-blockers").hidden).toBe(true);
    expect(profilePage).toContain("<dt>Affected memberships</dt>");
    await expectNoAxeViolations(document.body);
  });

  it("shows current impact and disables actions that would orphan a workspace", async () => {
    shell();
    stubApi({
      [PREVIEW]: jsonResponse(preview({
        blockingWorkspaces: [{ id: ids.workspace, name: "Circle" }],
        memberships: [membership({ finalOwner: true })],
      })),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    expect(element("#lifecycle-membership-count").textContent).toBe("1");
    expect(screen.getByRole("list", { name: "Affected memberships" }))
      .toHaveProperty("textContent", "Circleowner · final active owner");
    const blockers = element("#lifecycle-blockers");
    expect(blockers.hidden).toBe(false);
    expect(blockers.getAttribute("role")).toBeNull();
    expect(blockers.textContent).toBe(
      "You are the final active owner of Circle. Transfer ownership in Members before leaving an owned workspace or deleting your identity. Workspace deletion is a separate owner action.",
    );
    expect(leave().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
  });

  it("keeps both password forms unable to submit until the current impact has loaded", async () => {
    for (const id of ["leave-workspace-form", "delete-identity-form"]) {
      const form = new RegExp(`<form[^>]*id="${id}"[\\s\\S]*?</form>`).exec(
        profilePage,
      )?.[0];
      expect(form, id).toMatch(/<button type="submit"[^>]*\sdisabled>/);
    }
    shell();
    const loaded = deferred<Response>();
    const api = stubApi({
      [PREVIEW]: loaded.promise,
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const settled = mountPending(() => mountPersonalLifecycle(document));
    await waitFor(() => expect(api.calls()).toContain(PREVIEW));
    expect([leave().disabled, remove().disabled]).toEqual([true, true]);
    fill(leaveForm(), "LEAVE Circle", "current password");
    fill(deleteForm(), "DELETE owner@example.test", "current password");
    for (const form of [leaveForm(), deleteForm()]) {
      const early = new Event("submit", { bubbles: true, cancelable: true });
      act(() => {
        form.dispatchEvent(early);
      });
      expect(early.defaultPrevented).toBe(true);
    }
    await act(async () => {
      loaded.resolve(jsonResponse(preview()));
      await settled;
    });
    expect([leave().disabled, remove().disabled]).toEqual([false, false]);
    expect(api.calls()).toEqual([SESSION, PREVIEW]);
  });

  it("reauthenticates, leaves, and selects the next valid workspace", async () => {
    shell();
    const answered = deferred<Response>();
    const api = stubApi({
      [LEAVE]: answered.promise,
      [PREVIEW]: jsonResponse(preview()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    fill(leaveForm(), "LEAVE Circle", "current password");
    submit(leaveForm());
    expect(status().textContent).toBe("Revalidating membership impact…");
    expect(leave().disabled).toBe(true);
    submit(leaveForm());
    await act(async () => {
      answered.resolve(jsonResponse({
        next: "/app",
        nextWorkspaceId: "workspace-next",
        status: "left",
      }));
      await answered.promise;
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/app"));
    expect(api.calls().filter((call) => call === LEAVE)).toHaveLength(1);
    expect(api.bodies()).toEqual([{
      confirmation: "LEAVE Circle",
      password: "current password",
    }]);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      "workspace-next",
    );
  });

  it("clears the workspace when leaving names no next workspace", async () => {
    shell();
    sessionStorage.setItem("kinship.active-workspace", ids.workspace);
    stubApi({
      [LEAVE]: jsonResponse({ next: "/auth/sign-in", status: "left" }),
      [PREVIEW]: jsonResponse(preview()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    fill(leaveForm(), "LEAVE Circle", "current password");
    submit(leaveForm());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/auth/sign-in"));
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
  });

  it("keeps a failed reauthentication retryable without changing navigation", async () => {
    shell();
    stubApi({
      [DELETE]: [
        problemResponse(403, {
          code: "reauthentication_required",
          detail: "Enter your current password.",
        }),
        unreachable,
      ],
      [LEAVE]: unreachable,
      [PREVIEW]: jsonResponse(preview()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    fill(deleteForm(), "DELETE owner@example.test", "wrong");
    submit(deleteForm());
    expect(status().textContent).toBe(
      "Reauthenticating and revalidating every membership…",
    );
    await waitFor(() =>
      expect(status().textContent).toBe("Enter your current password.")
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(remove().disabled).toBe(false);
    submit(deleteForm());
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Your personal identity was not deleted.",
      )
    );
    submit(leaveForm());
    await waitFor(() =>
      expect(status().textContent).toBe("The workspace could not be left.")
    );
    expect(leave().disabled).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("clears workspace state after confirmed personal identity deletion", async () => {
    shell();
    sessionStorage.setItem("kinship.active-workspace", ids.workspace);
    const api = stubApi({
      [DELETE]: jsonResponse({ next: "/auth/sign-in", status: "deleted" }),
      [PREVIEW]: jsonResponse(preview()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const navigate = vi.fn();
    await mount(navigate);
    fill(deleteForm(), "DELETE owner@example.test", "current password");
    submit(deleteForm());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/auth/sign-in"));
    expect(api.bodies()).toEqual([{
      confirmation: "DELETE owner@example.test",
      password: "current password",
    }]);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
  });

  it("reports an impact or session it could not confirm, with both actions held", async () => {
    for (
      const [routes, message] of [
        [{
          [PREVIEW]: problemResponse(503, { detail: "Impact is unavailable." }),
        }, "Impact is unavailable."],
        [
          { [PREVIEW]: unreachable },
          "Current account impact could not be loaded.",
        ],
        [{}, "Your session could not be confirmed."],
      ] as const
    ) {
      shell();
      stubApi({
        ...routes,
        [SESSION]: Object.keys(routes).length
          ? jsonResponse(workspaceSession())
          : unreachable,
      });
      const unmount = await mount();
      expect(status().textContent).toBe(message);
      expect([leave().disabled, remove().disabled]).toEqual([true, true]);
      expect(element("#lifecycle-loading").hidden).toBe(false);
      unmount();
    }
  });

  it("holds both destructive actions while either is in flight", async () => {
    shell();
    const left = deferred<Response>();
    const api = stubApi({
      [LEAVE]: left.promise,
      [PREVIEW]: jsonResponse(preview()),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    fill(leaveForm(), "LEAVE Circle", "current password");
    fill(deleteForm(), "DELETE owner@example.test", "current password");
    submit(leaveForm());
    expect(leave().disabled).toBe(true);
    expect(remove().disabled).toBe(true);
    submit(deleteForm());
    expect(api.calls()).not.toContain(DELETE);
    await act(async () => {
      left.resolve(problemResponse(403, { detail: "Wrong password." }));
      await left.promise;
    });
    await waitFor(() => expect(remove().disabled).toBe(false));
    expect(leave().disabled).toBe(false);
  });
});
