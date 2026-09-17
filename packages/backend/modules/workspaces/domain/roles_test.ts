import { assertEquals } from "../../../testing/assert.ts";
import { owner, privileged, type WorkspaceRole } from "./roles.ts";

const ROLES: readonly WorkspaceRole[] = ["admin", "member", "owner"];

Deno.test("[GAP-018] administrative work is an owner's or an administrator's", () => {
  assertEquals(
    ROLES.map((role) => [role, privileged({ role })]),
    [["admin", true], ["member", false], ["owner", true]],
  );
});

Deno.test("[GAP-018] the irreversible things are the owner's alone", () => {
  assertEquals(
    ROLES.map((role) => [role, owner({ role })]),
    [["admin", false], ["member", false], ["owner", true]],
  );
});
