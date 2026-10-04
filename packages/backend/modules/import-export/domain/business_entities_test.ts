import { assertEquals } from "../../../testing/assert.ts";
import {
  businessTargetId,
  type UnstagedBusinessEntity,
} from "./business_entities.ts";
Deno.test("business IDs remain stable within a source and isolated across sources and workspaces", async () => {
  const entity: UnstagedBusinessEntity = {
    owner: "interactions",
    sourceTable: "notes",
    sourcePrimaryKey: "1",
    targetTable: "notes",
    data: { kind: "note", sourceAccountId: "1" },
  };
  const first = await businessTargetId("workspace-a", entity, "source-a");
  assertEquals(
    first,
    await businessTargetId("workspace-a", entity, "source-a"),
  );
  assertEquals(
    first === await businessTargetId("workspace-b", entity, "source-a"),
    false,
  );
  assertEquals(
    first === await businessTargetId("workspace-a", entity, "source-b"),
    false,
  );
  assertEquals(/^[a-f0-9-]{36}$/.test(first), true);
});
