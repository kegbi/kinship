import { assertEquals } from "../../../testing/assert.ts";
import {
  INVITATION_WINDOW_MS,
  invitationExpiry,
  invitationSummary,
  memberDirectory,
  sameMailbox,
  type WorkspaceMemberRecord,
} from "./invitation_rules.ts";

Deno.test("[GAP-018] an invitation works for a week", () => {
  assertEquals(INVITATION_WINDOW_MS, 604_800_000);
  assertEquals(
    invitationExpiry(new Date("2026-03-01T10:00:00.000Z")).toISOString(),
    "2026-03-08T10:00:00.000Z",
  );
});

Deno.test("[GAP-018] an invitation is addressed to a mailbox, not to a spelling", () => {
  assertEquals(sameMailbox("ada@example.com", "Ada@Example.com"), true);
  assertEquals(sameMailbox("ADA@EXAMPLE.COM", "ada@example.com"), true);
  assertEquals(sameMailbox("ada@example.com", "grace@example.com"), false);
  assertEquals(
    sameMailbox("ada@example.com", " ada@example.com"),
    false,
    "only case is forgiven; anything else is another address",
  );
});

Deno.test("[GAP-018] an invitation is listed with its instants as text", () => {
  assertEquals(
    invitationSummary({
      createdAt: new Date("2026-03-01T10:00:00.000Z"),
      email: "ada@example.com",
      expiresAt: new Date("2026-03-08T10:00:00.000Z"),
      id: "i1",
      role: "member",
      status: "pending",
    }),
    {
      createdAt: "2026-03-01T10:00:00.000Z",
      email: "ada@example.com",
      expiresAt: "2026-03-08T10:00:00.000Z",
      id: "i1",
      role: "member",
      status: "pending",
    },
  );
});

const MEMBERS: readonly WorkspaceMemberRecord[] = [
  { id: "m3", role: "member", status: "active", userId: "u3" },
  { id: "m1", role: "owner", status: "active", userId: "u1" },
  { id: "m2", role: "admin", status: "active", userId: "u2" },
];

Deno.test("[GAP-018] the member list orders by address and then by identifier", () => {
  assertEquals(
    memberDirectory(MEMBERS, [
      { email: "Zoe@example.com", name: "Zoe", userId: "u1" },
      { email: "ada@example.com", name: "Ada", userId: "u2" },
      { email: "grace@example.com", name: "Grace", userId: "u3" },
    ]),
    [
      {
        email: "ada@example.com",
        id: "m2",
        name: "Ada",
        role: "admin",
        status: "active",
      },
      {
        email: "grace@example.com",
        id: "m3",
        name: "Grace",
        role: "member",
        status: "active",
      },
      {
        email: "Zoe@example.com",
        id: "m1",
        name: "Zoe",
        role: "owner",
        status: "active",
      },
    ],
  );
});

Deno.test("[GAP-018] two members at the same address keep a stable place", () => {
  assertEquals(
    memberDirectory([
      { id: "m2", role: "member", status: "active", userId: "u2" },
      { id: "m1", role: "member", status: "active", userId: "u1" },
    ], [
      { email: "shared@example.com", name: "One", userId: "u1" },
      { email: "shared@example.com", name: "Two", userId: "u2" },
    ]).map((member) => member.id),
    ["m1", "m2"],
  );
});

Deno.test("[GAP-018] a member whose identity has gone is left out, not shown blank", () => {
  assertEquals(
    memberDirectory(MEMBERS, [
      { email: "ada@example.com", name: "Ada", userId: "u2" },
    ]),
    [{
      email: "ada@example.com",
      id: "m2",
      name: "Ada",
      role: "admin",
      status: "active",
    }],
  );
  assertEquals(memberDirectory(MEMBERS, []), []);
  assertEquals(memberDirectory([], []), []);
});
