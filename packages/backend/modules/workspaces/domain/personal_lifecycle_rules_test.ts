import { assertEquals } from "../../../testing/assert.ts";
import {
  blockingWorkspaces,
  claimedMembership,
  deleteIdentityConfirmation,
  leaveWorkspaceConfirmation,
  nextMembership,
  type PersonalLifecycleMembership,
} from "./personal_lifecycle_rules.ts";

const MEMBERSHIPS: readonly PersonalLifecycleMembership[] = [
  {
    finalOwner: false,
    memberId: "m1",
    role: "member",
    status: "active",
    workspaceId: "w1",
    workspaceName: "Home",
  },
  {
    finalOwner: true,
    memberId: "m2",
    role: "owner",
    status: "active",
    workspaceId: "w2",
    workspaceName: "Work",
  },
  {
    finalOwner: false,
    memberId: "m3",
    role: "member",
    status: "suspended",
    workspaceId: "w3",
    workspaceName: "Old",
  },
];

Deno.test("[GAP-018] the workspaces in the way are named, not merely counted", () => {
  assertEquals(blockingWorkspaces(MEMBERSHIPS), [{ id: "w2", name: "Work" }]);
  assertEquals(blockingWorkspaces([]), []);
  assertEquals(
    blockingWorkspaces(MEMBERSHIPS.filter((item) => !item.finalOwner)),
    [],
  );
});

Deno.test("[GAP-018] the phrase names what is being destroyed", () => {
  assertEquals(
    deleteIdentityConfirmation("ada@example.com"),
    "DELETE ada@example.com",
  );
  assertEquals(leaveWorkspaceConfirmation("Home"), "LEAVE Home");
});

Deno.test("[GAP-018] a request names one membership, and both halves have to match", () => {
  assertEquals(
    claimedMembership(MEMBERSHIPS, { memberId: "m2", workspaceId: "w2" }),
    MEMBERSHIPS[1],
  );
  assertEquals(
    claimedMembership(MEMBERSHIPS, { memberId: "m2", workspaceId: "w1" }),
    undefined,
    "the workspace agreeing is not enough",
  );
  assertEquals(
    claimedMembership(MEMBERSHIPS, { memberId: "m9", workspaceId: "w2" }),
    undefined,
  );
});

Deno.test("[GAP-018] leaving lands in the next active membership, or nowhere", () => {
  const left = MEMBERSHIPS[0]!;
  assertEquals(
    nextMembership(MEMBERSHIPS, left)?.workspaceId,
    "w2",
    "a suspended membership is nowhere to land",
  );
  assertEquals(
    nextMembership([left], left),
    undefined,
    "the one being left is not somewhere to land",
  );
  assertEquals(
    nextMembership(
      MEMBERSHIPS.filter((item) =>
        item.status !== "active" ||
        item.memberId === left.memberId
      ),
      left,
    ),
    undefined,
  );
});
