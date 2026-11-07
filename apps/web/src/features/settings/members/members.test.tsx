// @vitest-environment happy-dom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { MEMBERS_ISLAND, mountMembersPage } from "./members.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const MEMBERS = "GET /api/v1/workspace-members";
const INVITE = "POST /api/v1/workspace-invitations";
const MANAGED = "GET /api/v1/settings/members";
const UPDATE = "PATCH /api/v1/settings/members/:id";
const REVOKE = "DELETE /api/v1/workspace-invitations/:id";

const owner = {
  email: "owner@example.test",
  id: ids.member,
  name: "Owner Person",
  role: "owner",
  status: "active",
};
const colleague = {
  email: "colleague@example.test",
  id: "00000000-0000-4000-8000-000000000012",
  name: "",
  role: "member",
  status: "active",
};
const pending = {
  createdAt: "2026-08-15T12:00:00Z",
  email: "pending@example.test",
  expiresAt: "2026-08-22T12:00:00Z",
  id: "invite",
  invitedBy: { id: ids.member, name: "Owner Person" },
  role: "member",
  status: "pending",
};
const lists = (members: object[] = [owner], invitations = [pending]) =>
  jsonResponse({ invitations, members, status: "ready" });
const managed = (...members: object[]) =>
  jsonResponse({ members, status: "ready" });
const base = {
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
  [SESSION]: jsonResponse(workspaceSession()),
};

function shell(): void {
  drawShell("<main><div data-settings-members></div></main>");
}

const mount = () => mountSettled(() => mountMembersPage());
const invitationForm = () => element<HTMLFormElement>("#invitation-form");
const status = () => element("#invitation-status");

function invite(email: string, role = "member"): void {
  act(() => {
    fireEvent.input(screen.getByLabelText("Email address"), {
      target: { value: email },
    });
    fireEvent.change(screen.getByLabelText("Role"), {
      target: { value: role },
    });
    fireEvent.submit(invitationForm());
  });
}

afterEach(() => sessionStorage.clear());

describe("AUTH-002 members settings", () => {
  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(MEMBERS_ISLAND).toBe("settings-members");
  });

  it("renders lists and submits one generated-client invitation", async () => {
    shell();
    const selected = "00000000-0000-4000-8000-000000000033";
    sessionStorage.setItem("kinship.active-workspace", selected);
    const api = stubApi({
      ...base,
      [INVITE]: jsonResponse({ status: "invited" }, 201),
      [MANAGED]: managed(owner),
      [MEMBERS]: [lists(), lists([owner], [])],
      [SESSION]: jsonResponse(
        workspaceSession({ workspace: { id: selected, name: "Selected" } }),
      ),
    });
    await mount();
    const active = element("#member-list");
    expect(active.hidden).toBe(false);
    expect(within(active).getByRole("listitem").textContent).toBe(
      "Owner Personowner@example.testowner",
    );
    expect(element("#members-state").hidden).toBe(true);
    expect(element("#member-count").textContent).toBe("1 active");
    expect(element("#invitation-count").textContent).toBe("1 pending");
    expect(element("#pending-list").textContent).toBe(
      "pending@example.testInvited by Owner Person · Expires Aug 22, 2026, 12:00 PMmemberRevoke",
    );
    await expectNoAxeViolations(document.body);
    invite(" Invitee@Example.test ", "admin");
    expect(status().textContent).toBe(
      "Creating and delivering the invitation…",
    );
    await waitFor(() =>
      expect(status().textContent).toBe(
        "Invitation sent. The link can be used once within seven days.",
      )
    );
    expect(api.bodies()).toEqual([
      { email: "invitee@example.test", role: "admin" },
    ]);
    expect(
      api.requests().every((request) =>
        request.headers.get("x-workspace-id") === selected
      ),
    ).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Email address").value)
      .toBe("");
    await waitFor(() =>
      expect(element("#pending-state").textContent).toBe(
        "No pending invitations.",
      )
    );
    expect(element("#pending-state").hidden).toBe(false);
    expect(element("#pending-list").hidden).toBe(true);
  });

  it("keeps an invitation sent before the page loaded off the URL and sends it once loaded", async () => {
    shell();
    const session = deferred<Response>();
    const api = stubApi({
      ...base,
      [INVITE]: jsonResponse({ status: "invited" }, 201),
      [MANAGED]: managed(owner),
      [MEMBERS]: lists(),
      [SESSION]: session.promise,
    });
    const settled = mountPending(() => mountMembersPage());
    act(() => {
      fireEvent.input(screen.getByLabelText("Email address"), {
        target: { value: "early@example.test" },
      });
    });
    const early = new Event("submit", { bubbles: true, cancelable: true });
    act(() => {
      invitationForm().dispatchEvent(early);
    });
    expect(early.defaultPrevented).toBe(true);
    expect(status().textContent).toBe(
      "Creating and delivering the invitation…",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Send invitation" })
        .disabled,
    ).toBe(true);
    act(() => {
      invitationForm().dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await settled;
    });
    await waitFor(() => expect(status().textContent).toMatch(/seven days/));
    expect(api.bodies()).toEqual([
      { email: "early@example.test", role: "member" },
    ]);
  });

  it("shows role denial, unavailable lists, and an unconfirmed session honestly", async () => {
    for (
      const [routes, members, pendingState, badge, formHidden] of [
        [
          { ...base, [MEMBERS]: problemResponse(403) },
          "Only workspace owners and admins can view members.",
          "Pending invitations are restricted.",
          "Unavailable",
          true,
        ],
        [
          { ...base, [MEMBERS]: unreachable },
          "Members could not be loaded. Try again.",
          "Pending invitations could not be loaded.",
          "Unavailable",
          false,
        ],
        [
          { [SESSION]: unreachable },
          "Your session could not be confirmed.",
          "Pending invitations are unavailable.",
          "Loading…",
          true,
        ],
      ] as const
    ) {
      shell();
      stubApi(routes);
      const unmount = await mount();
      expect(element("#members-state").textContent).toBe(members);
      expect(element("#pending-state").textContent).toBe(pendingState);
      expect(element("#member-count").textContent).toBe(badge);
      expect(invitationForm().hidden).toBe(formHidden);
      unmount();
    }
  });

  it("words invitation refusals and keeps the form usable", async () => {
    shell();
    stubApi({
      ...base,
      [INVITE]: [
        problemResponse(409, { code: "already_member" }),
        problemResponse(403, { code: "invitation_forbidden" }),
        problemResponse(422, { detail: "That address cannot be invited." }),
        unreachable,
      ],
      [MANAGED]: managed(),
      [MEMBERS]: lists([], []),
    });
    await mount();
    expect(element("#members-state").textContent).toBe(
      "No active members are available.",
    );
    expect(element("#managed-state").textContent).toBe(
      "No manageable members.",
    );
    for (
      const expected of [
        "That person is already an active member.",
        "Only a workspace owner or admin can send invitations.",
        "That address cannot be invited.",
        "The invitation could not be sent. Try again.",
      ]
    ) {
      invite("someone@example.test");
      await waitFor(() => expect(status().textContent).toBe(expected));
      expect(
        screen.getByRole<HTMLButtonElement>("button", {
          name: "Send invitation",
        }).disabled,
      ).toBe(false);
    }
  });

  it("keeps a member update announcement visible after refresh, and a refusal beside it", async () => {
    shell();
    const saved = deferred<Response>();
    const api = stubApi({
      ...base,
      [MANAGED]: [
        managed(owner, colleague),
        managed(owner, { ...colleague, role: "admin" }),
      ],
      [MEMBERS]: lists([owner, colleague]),
      [UPDATE]: [
        saved.promise,
        problemResponse(409, {
          detail: "At least one active workspace owner must remain.",
        }),
        unreachable,
      ],
    });
    await mount();
    expect(element("#member-list").textContent).toContain(
      "colleague@example.testcolleague@example.testmember",
    );
    const state = element("#managed-state");
    expect(state.hidden).toBe(true);
    const role = screen.getByLabelText<HTMLSelectElement>(
      "Access level for colleague@example.test",
    );
    expect(role.value).toBe("member");
    const row = role.closest("li")!;
    expect(row.querySelector("strong")?.textContent).toBe(
      "colleague@example.test",
    );
    act(() => {
      fireEvent.change(role, { target: { value: "admin" } });
    });
    const save = within(row).getByRole<HTMLButtonElement>("button", {
      name: "Save",
    });
    act(() => {
      fireEvent.click(save);
    });
    expect(save.disabled).toBe(true);
    act(() => {
      fireEvent.click(save);
    });
    await act(async () => {
      saved.resolve(jsonResponse({
        member: { ...colleague, role: "admin" },
        status: "ready",
      }));
      await saved.promise;
    });
    await waitFor(() =>
      expect(state.textContent).toBe("colleague@example.test updated.")
    );
    expect(state.hidden).toBe(false);
    expect(api.bodies()).toEqual([{ role: "admin", status: "active" }]);
    expect(
      screen.getByLabelText<HTMLSelectElement>(
        "Access level for colleague@example.test",
      ).value,
    ).toBe("admin");
    const ownerRole = screen.getByLabelText<HTMLSelectElement>(
      "Access level for owner@example.test",
    );
    act(() => {
      fireEvent.change(ownerRole, { target: { value: "member" } });
      fireEvent.click(
        within(ownerRole.closest("li")!).getByRole("button", { name: "Save" }),
      );
    });
    await waitFor(() =>
      expect(state.textContent).toBe(
        "At least one active workspace owner must remain.",
      )
    );
    expect(ownerRole.value).toBe("member");
    act(() => {
      fireEvent.click(
        within(ownerRole.closest("li")!).getByRole("button", { name: "Save" }),
      );
    });
    await waitFor(() =>
      expect(state.textContent).toBe("Member could not be updated.")
    );
  });

  it("SECT-04 names who invited each pending invitee and revokes one", async () => {
    shell();
    const revoked = deferred<Response>();
    const orphan = {
      ...pending,
      email: "orphan@example.test",
      id: "orphan",
      invitedBy: null,
      role: "admin",
    };
    const api = stubApi({
      ...base,
      [MANAGED]: managed(owner),
      [MEMBERS]: [
        lists([owner], [pending, orphan]),
        lists([owner], [orphan]),
        lists([owner], []),
      ],
      [REVOKE]: [
        revoked.promise,
        unreachable,
        problemResponse(404, {
          detail: "That invitation is not pending in this workspace.",
        }),
      ],
    });
    await mount();
    const rows = within(element("#pending-list")).getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("small")?.textContent)).toEqual([
      "Invited by Owner Person · Expires Aug 22, 2026, 12:00 PM",
      "Invited by a former member · Expires Aug 22, 2026, 12:00 PM",
    ]);
    expect(rows[1]!.querySelector(".role-badge")?.textContent).toBe("admin");
    await expectNoAxeViolations(document.body);
    const revoke = screen.getByRole<HTMLButtonElement>("button", {
      name: "Revoke invitation for pending@example.test",
    });
    act(() => {
      fireEvent.click(revoke);
    });
    expect(revoke.disabled).toBe(true);
    act(() => {
      fireEvent.click(revoke);
    });
    await act(async () => {
      revoked.resolve(jsonResponse({ status: "revoked" }));
      await revoked.promise;
    });
    const state = element("#pending-status");
    await waitFor(() =>
      expect(state.textContent).toBe(
        "Invitation for pending@example.test revoked.",
      )
    );
    expect(
      api.calls().filter((call) => call.startsWith("DELETE")),
    ).toEqual(["DELETE /api/v1/workspace-invitations/invite"]);
    expect(element("#invitation-count").textContent).toBe("1 pending");
    expect(
      screen.queryByRole("button", {
        name: "Revoke invitation for pending@example.test",
      }),
    ).toBeNull();
    const orphanRevoke = screen.getByRole<HTMLButtonElement>("button", {
      name: "Revoke invitation for orphan@example.test",
    });
    act(() => {
      fireEvent.click(orphanRevoke);
    });
    await waitFor(() =>
      expect(state.textContent).toBe("The invitation could not be revoked.")
    );
    expect(orphanRevoke.disabled).toBe(false);
    // Revoked or accepted elsewhere meanwhile: the stale row goes with a
    // fresh list instead of offering a Revoke that can only fail again.
    act(() => {
      fireEvent.click(orphanRevoke);
    });
    await waitFor(() =>
      expect(element("#invitation-count").textContent).toBe("0 pending")
    );
    expect(state.textContent).toBe(
      "That invitation is not pending in this workspace.",
    );
    expect(
      screen.queryByRole("button", {
        name: "Revoke invitation for orphan@example.test",
      }),
    ).toBeNull();
    expect(
      api.calls().filter((call) => call.startsWith("DELETE")),
    ).toHaveLength(3);
  });

  it("says when member administration is unavailable", async () => {
    for (
      const [answer, message] of [
        [problemResponse(403, { detail: "Admins only." }), "Admins only."],
        [unreachable, "Member administration is unavailable."],
      ] as const
    ) {
      shell();
      stubApi({ ...base, [MANAGED]: answer, [MEMBERS]: lists() });
      const unmount = await mount();
      expect(element("#managed-state").textContent).toBe(message);
      expect(element("#managed-list").hidden).toBe(true);
      unmount();
    }
  });
});
