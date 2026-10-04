import { assertEquals } from "../../../../testing/assert.ts";
import { monicaContactType, monicaTimestamps } from "./monica_contact_types.ts";

Deno.test("source catalog normalizes optional metadata and source kinds", () => {
  assertEquals(monicaContactType({}), undefined);
  assertEquals(monicaContactType({ id: 1 }), {
    key: ":1",
    name: "Custom",
    kind: "custom",
  });
  for (
    const [type, name] of [
      ["email", "Email"],
      ["phone", "Phone"],
      ["url", "Website"],
      ["social", "social"],
      ["unknown", "unknown"],
    ]
  ) {
    assertEquals(monicaContactType({ id: 1, type, delible: null }), {
      key: ":1",
      name,
      kind: type === "unknown" ? "custom" : type,
      ...(type === "unknown" ? { sourceKind: type } : {}),
    });
  }
  assertEquals(
    monicaContactType({
      id: 1,
      account_id: 2,
      name: " Label ",
      type: "im",
      fontawesome_icon: " fa-icon ",
      protocol: " chat ",
      delible: 1,
    }),
    {
      key: "2:1",
      name: "Label",
      kind: "im",
      protocol: "chat",
      icon: "fa-icon",
      canDelete: true,
    },
  );
  assertEquals(
    monicaContactType({
      id: 1,
      type: "username",
      name: null,
      fontawesome_icon: "",
      protocol: null,
    }),
    { key: ":1", name: "username", kind: "username" },
  );
  assertEquals(monicaTimestamps({ created_at: null, updated_at: "" }), {});
  assertEquals(
    monicaTimestamps({
      created_at: "2020-01-01T01:02:03.123Z",
      updated_at: "2020-01-01 01:02:03.1",
    }),
    {
      createdAt: "2020-01-01T01:02:03.123Z",
      updatedAt: "2020-01-01T01:02:03.100Z",
    },
  );
  for (
    const value of [
      1,
      "2020-01-01",
      "2020-02-30 00:00:00",
      "2020-99-01 00:00:00",
      "2020-01-01 25:00:00",
    ]
  ) {
    assertEquals(
      monicaTimestamps({ created_at: value }),
      "A Monica contact method timestamp is invalid.",
    );
  }
});
