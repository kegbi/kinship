import { describe, expect, it } from "vitest";
import type { WorkspaceMembers } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  initialMembers,
  INVITATION_SENT,
  invitationRefusal,
  listWords,
  type MembersAction,
  membersReducer,
  optionLabel,
  SENDING,
} from "./members.ts";

const reduce = (...actions: MembersAction[]) =>
  actions.reduce(membersReducer, initialMembers);
const lists = { invitations: [], members: [] } as unknown as WorkspaceMembers;

describe("AUTH-002 members state", () => {
  it("words each phase of the lists", () => {
    expect(listWords(initialMembers)).toEqual({
      invitationCount: "Loading…",
      memberCount: "Loading…",
      members: "Loading active members securely…",
      pending: "Loading pending invitations…",
    });
    expect(listWords(reduce({ type: "no-session" })).members).toBe(
      "Your session could not be confirmed.",
    );
    expect(listWords(reduce({ forbidden: true, type: "refused" })).pending)
      .toBe("Pending invitations are restricted.");
    expect(listWords(reduce({ forbidden: false, type: "refused" })).members)
      .toBe("Members could not be loaded. Try again.");
    expect(listWords(reduce({ lists, type: "loaded" }))).toEqual({
      invitationCount: "0 pending",
      memberCount: "0 active",
      members: "No active members are available.",
      pending: "No pending invitations.",
    });
    expect(listWords({ ...initialMembers, phase: "ready" }).memberCount).toBe(
      "0 active",
    );
  });

  it("tracks the invitation and each role save", () => {
    const sending = reduce({ type: "sending" });
    expect(sending).toMatchObject({ inviteStatus: SENDING, sending: true });
    expect(membersReducer(sending, { message: INVITATION_SENT, type: "sent" }))
      .toMatchObject({ inviteStatus: INVITATION_SENT, sending: false });
    expect(membersReducer(sending, { type: "no-session" })).toMatchObject({
      inviteStatus: "",
      sending: false,
    });
    const saving = reduce({ id: "a", type: "saving" });
    expect(saving.saving).toEqual(["a"]);
    expect(membersReducer(saving, { id: "a", message: "Done.", type: "saved" }))
      .toMatchObject({ managedStatus: "Done.", saving: [] });
    expect(
      reduce({ timePreferences: undefined, type: "context" }).timePreferences,
    ).toBeUndefined();
  });

  it("shows the role controls, or why they are missing", () => {
    expect(reduce({ members: [], type: "managed" }).managedStatus).toBe(
      "No manageable members.",
    );
    const member = { id: "a" } as never;
    expect(reduce({ members: [member], type: "managed" }).managedStatus)
      .toBeUndefined();
    expect(
      reduce({ members: [member], message: "a updated.", type: "managed" })
        .managedStatus,
    ).toBe("a updated.");
    expect(reduce({ message: "Down.", type: "managed" })).toMatchObject({
      managed: undefined,
      managedStatus: "Down.",
    });
  });

  it("words refusals and options", () => {
    expect(invitationRefusal(undefined)).toBe(
      "The invitation could not be sent. Try again.",
    );
    expect(optionLabel("suspended")).toBe("Suspended");
  });
});
