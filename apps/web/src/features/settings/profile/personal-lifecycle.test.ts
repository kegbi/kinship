import { describe, expect, it } from "vitest";
import type { PersonalLifecyclePreview } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  blockersText,
  initialLifecycle,
  lifecycleBlocks,
  lifecycleReducer,
  membershipDetail,
} from "./personal-lifecycle.ts";

type Membership = PersonalLifecyclePreview["memberships"][number];
const membership = (overrides: Partial<Membership> = {}): Membership => ({
  finalOwner: false,
  id: "member",
  role: "owner",
  status: "active",
  workspace: { id: "workspace", name: "Circle" },
  ...overrides,
});
const preview = (
  overrides: Partial<PersonalLifecyclePreview> = {},
): PersonalLifecyclePreview => ({
  activeSessionCount: 1,
  blockingWorkspaces: [],
  confirmations: { deleteIdentity: "DELETE a", leaveWorkspace: "LEAVE b" },
  memberships: [membership()],
  retainedLegalRecords: true,
  status: "ready",
  ...overrides,
});

describe("AUTH-005 personal lifecycle state", () => {
  it("loads the impact, then holds only the action in flight", () => {
    const loaded = lifecycleReducer(initialLifecycle, {
      preview: preview(),
      type: "loaded",
      workspaceId: "workspace",
    });
    expect(loaded).toMatchObject({ phase: "ready", workspaceId: "workspace" });
    const leaving = lifecycleReducer(loaded, {
      action: "leave",
      type: "submitting",
    });
    expect(leaving).toMatchObject({
      busy: "leave",
      status: "Revalidating membership impact…",
    });
    expect(
      lifecycleReducer(loaded, { action: "delete", type: "submitting" }).status,
    ).toBe("Reauthenticating and revalidating every membership…");
    expect(lifecycleReducer(leaving, { message: "No.", type: "refused" }))
      .toMatchObject({ busy: undefined, status: "No." });
    expect(
      lifecycleReducer(initialLifecycle, {
        message: "Down.",
        type: "unavailable",
      }),
    ).toMatchObject({ phase: "unavailable", status: "Down." });
  });

  it("describes each membership and what blocks each action", () => {
    expect(membershipDetail(membership())).toBe("owner");
    expect(membershipDetail(membership({ finalOwner: true }))).toBe(
      "owner · final active owner",
    );
    expect(
      membershipDetail(membership({ role: "member", status: "suspended" })),
    )
      .toBe("member · suspended");
    expect(lifecycleBlocks(preview(), "workspace")).toEqual({
      delete: false,
      leave: false,
    });
    const blocked = preview({
      blockingWorkspaces: [
        { id: "workspace", name: "Circle" },
        { id: "other", name: "Friends" },
      ],
      memberships: [membership({ finalOwner: true })],
    });
    expect(lifecycleBlocks(blocked, "workspace")).toEqual({
      delete: true,
      leave: true,
    });
    expect(lifecycleBlocks(blocked, "elsewhere").leave).toBe(false);
    expect(blockersText(preview())).toBeUndefined();
    expect(blockersText(blocked)).toMatch(
      /^You are the final active owner of Circle, Friends\. Transfer ownership/,
    );
  });
});
