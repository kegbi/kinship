import { assertEquals } from "../../../testing/assert.ts";
import { contactTypePlan } from "./contact_type_mapping.ts";
const source = [{ key: "1", name: "Chat", kind: "custom" as const, count: 2 }];
Deno.test("contact type plans require choices, preserve active matches, and refuse retired targets", () => {
  assertEquals(contactTypePlan(source, [], []).status, "decision-required");
  assertEquals(
    contactTypePlan(source, [], [{ sourceKey: "1", action: "create" }]),
    { status: "ready", mapping: {}, create: source },
  );
  assertEquals(
    contactTypePlan(source, [{
      id: "type",
      name: "Chat",
      kind: "custom",
      archived: false,
    }], []).mapping,
    { "1": "type" },
  );
  assertEquals(
    contactTypePlan(source, [{
      id: "retired",
      name: "Chat",
      kind: "custom",
      archived: true,
    }], [{ sourceKey: "1", action: "map", typeId: "retired" }]).status,
    "decision-required",
  );
  assertEquals(
    contactTypePlan(source, [{
      id: "retired",
      name: "Chat",
      kind: "custom",
      archived: true,
    }], [{ sourceKey: "1", action: "create" }]).status,
    "decision-required",
  );
  assertEquals(
    contactTypePlan(source, [], [{ sourceKey: "other", action: "skip" }])
      .status,
    "decision-required",
  );
});

Deno.test("contact type plans support explicit mappings and skips without creating configuration", () => {
  const active = [{
    id: "target",
    name: "Other",
    kind: "custom",
    archived: false,
  }];
  assertEquals(
    contactTypePlan(source, active, [{
      sourceKey: "1",
      action: "map",
      typeId: "target",
    }]),
    { status: "ready", mapping: { "1": "target" }, create: [] },
  );
  assertEquals(
    contactTypePlan(source, [], [{ sourceKey: "1", action: "skip" }]),
    { status: "ready", mapping: {}, create: [] },
  );
  assertEquals(
    contactTypePlan(source, [], [{ sourceKey: "1", action: "skip" }, {
      sourceKey: "1",
      action: "create",
    }]).status,
    "decision-required",
  );
  assertEquals(
    contactTypePlan(
      [...source, { key: "2", name: "CHAT", kind: "social", count: 1 }],
      [],
      [{ sourceKey: "1", action: "create" }, {
        sourceKey: "2",
        action: "create",
      }],
    ).status,
    "decision-required",
  );
  assertEquals(
    contactTypePlan([{ key: "url", name: "Site", kind: "url", count: 1 }], [{
      id: "url-type",
      name: "Website",
      kind: "custom",
      archived: false,
    }], []).mapping,
    { url: "url-type" },
  );
  assertEquals(
    contactTypePlan([{ key: "email", name: "Work", kind: "email", count: 1 }], [
      { id: "email-type", name: "Email", kind: "custom", archived: false },
    ], []).mapping,
    { email: "email-type" },
  );
  assertEquals(
    contactTypePlan(
      [{ key: "phone", name: "Mobile", kind: "phone", count: 1 }],
      [{ id: "phone-type", name: "Telephone", kind: "phone", archived: false }],
      [],
    ).mapping,
    { phone: "phone-type" },
  );
});
