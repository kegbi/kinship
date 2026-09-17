import { assert, assertEquals } from "./assert.ts";
import {
  actor,
  memberId,
  person,
  personId,
  sessionActor,
  TEST_WORKSPACE_NAME,
  userId,
  uuid,
  workspaceActor,
  workspaceId,
} from "./fixtures.ts";

Deno.test("[GAP-014] identifiers are the padded ordinals the suites already used", () => {
  assertEquals(uuid(3), "00000000-0000-4000-8000-000000000003");
  assertEquals(uuid(100), "00000000-0000-4000-8000-000000000100");
  assertEquals(userId(), uuid(1));
  assertEquals(memberId(), uuid(2));
  assertEquals(workspaceId(), uuid(3));
  assertEquals(personId(), uuid(100));
  assertEquals(personId(7), uuid(7));
  assert(
    new Set([userId(), memberId(), workspaceId(), personId()]).size === 4,
    "the default identities are distinct",
  );
});

Deno.test("[GAP-014] the actor builders default to the standard member and accept overrides", () => {
  assertEquals(actor(), {
    memberId: uuid(2),
    role: "member",
    userId: uuid(1),
    workspaceId: uuid(3),
  });
  assertEquals(actor({ role: "admin" }).role, "admin");
  assertEquals(actor({ workspaceId: uuid(9) }).workspaceId, uuid(9));

  assertEquals(workspaceActor(), {
    memberId: uuid(2),
    role: "member",
    userId: uuid(1),
    workspaceId: uuid(3),
    workspaceName: TEST_WORKSPACE_NAME,
  });
  assertEquals(
    workspaceActor({ workspaceName: "Circle" }).workspaceName,
    "Circle",
  );

  const session = sessionActor({ role: "owner" });
  assertEquals(session.accessibleWorkspaces, []);
  assertEquals(session.role, "owner");
  assertEquals(session.workspaceName, TEST_WORKSPACE_NAME);
  assertEquals(
    sessionActor({ accessibleWorkspaces: [workspaceActor()] })
      .accessibleWorkspaces.length,
    1,
  );
});

Deno.test("[GAP-014] the person builder carries the name the suites use when the name means nothing", () => {
  assertEquals(person(), {
    familyName: "Lovelace",
    givenName: "Ada",
    id: uuid(100),
    isPartial: false,
  });
  assertEquals(person({ isPartial: true, id: uuid(101) }), {
    familyName: "Lovelace",
    givenName: "Ada",
    id: uuid(101),
    isPartial: true,
  });
});
