import { assert, assertEquals } from "../../../../testing/assert.ts";
import { parseMonicaSource } from "./monica_source.ts";
import {
  contactTypePlan,
  sourceContactTypes,
} from "../contact_type_mapping.ts";

Deno.test("Monica preserves unused type catalog and metadata without inventing contacts", () => {
  const parsed = parseMonicaSource({
    format: "monica-sql",
    text:
      "INSERT INTO contacts (id,account_id,first_name) VALUES (1,1,'Example'); INSERT INTO contact_field_types (id,account_id,name,fontawesome_icon,protocol,delible,type,created_at,updated_at) VALUES (1,1,'Chat','fa-comment','chat',0,'custom','2020-01-02 03:04:05','2021-02-03 04:05:06'),(2,1,'Unused','fa-unused',NULL,1,'custom',NULL,NULL); INSERT INTO contact_fields (id,account_id,contact_id,contact_field_type_id,data,created_at,updated_at) VALUES (1,1,1,1,'example','2022-03-04 05:06:07','2023-04-05 06:07:08');",
  }, { maxAttachmentBytes: 100 });
  assert(typeof parsed !== "string", "source parses");
  assertEquals(parsed.unsupported, 0);
  assertEquals(parsed.contacts.length, 1);
  const types = sourceContactTypes(
    [{ contact: parsed.details!.get("1")! }],
    parsed.contactTypeCatalog,
  );
  assertEquals(types.map(({ name, count }) => ({ name, count })), [{
    name: "Chat",
    count: 1,
  }, { name: "Unused", count: 0 }]);
  assertEquals(types[0], {
    key: "1:1",
    name: "Chat",
    kind: "custom",
    protocol: "chat",
    icon: "fa-comment",
    canDelete: false,
    createdAt: "2020-01-02T03:04:05.000Z",
    updatedAt: "2021-02-03T04:05:06.000Z",
    count: 1,
  });
  assertEquals(
    parsed.details!.get("1")!.contactMethods![0]!.createdAt,
    "2022-03-04T05:06:07.000Z",
  );
  assertEquals(
    parsed.details!.get("1")!.contactMethods![0]!.updatedAt,
    "2023-04-05T06:07:08.000Z",
  );
  for (const action of ["skip", "map", "create"] as const) {
    const plan = contactTypePlan([types[1]!], [{
      id: "target",
      name: "Other",
      kind: "custom",
      archived: false,
    }], [{
      sourceKey: "1:2",
      action,
      ...(action === "map" ? { typeId: "target" } : {}),
    }]);
    assertEquals(plan.status, "ready");
    assertEquals(plan.create.length, action === "create" ? 1 : 0);
    assertEquals(plan.mapping, action === "map" ? { "1:2": "target" } : {});
  }
});

Deno.test("Monica catalog refuses duplicate keys and malformed metadata before staging", () => {
  for (
    const row of [
      { name: "x".repeat(121) },
      { protocol: 123 },
      { fontawesome_icon: "x".repeat(101) },
      { delible: "yes" },
      { created_at: "2020-02-30 00:00:00" },
      { updated_at: "private invalid timestamp" },
    ]
  ) {
    const parsed = parseMonicaSource({
      format: "monica-json",
      version: 1,
      tables: {
        contacts: [],
        contact_field_types: [{ id: 1, name: "Chat", type: "custom", ...row }],
      },
    }, { maxAttachmentBytes: 100 });
    assert(typeof parsed === "string", "invalid metadata fails before staging");
    assert(
      !parsed.includes("private"),
      "diagnostic does not echo source values",
    );
  }
  const duplicated = parseMonicaSource({
    format: "monica-json",
    version: 1,
    tables: { contacts: [], contact_field_types: [{ id: 1 }, { id: 1 }] },
  }, { maxAttachmentBytes: 100 });
  assert(typeof duplicated === "string", "ambiguous catalog rejected");
});

Deno.test("catalog upgrade retains the 68b322c fingerprint for numeric-only contact identity", async () => {
  const parsed = parseMonicaSource({
    format: "monica-json",
    version: 1,
    tables: {
      contacts: [{ id: 1, first_name: "Example" }],
      contact_field_types: [{
        id: 1,
        name: "Chat",
        type: "custom",
        fontawesome_icon: "fa-chat",
        delible: 0,
        created_at: "2020-01-02 03:04:05",
      }, { id: 2, name: "Unused", type: "custom" }],
      contact_fields: [{
        contact_id: 1,
        contact_field_type_id: 1,
        data: "synthetic-handle",
        updated_at: "2021-02-03 04:05:06",
      }],
    },
  }, { maxAttachmentBytes: 100 });
  assert(typeof parsed !== "string", "upgrade source parses");
  const prior = parsed.compatibleSources![0]!;
  const { stageContacts, sourceFingerprint } = await import(
    "../import_rules.ts"
  );
  const staged = stageContacts(prior, () => "ignored");
  assert(typeof staged !== "string", "prior source stages");
  // Measured against the committed 68b322c normalizer using this synthetic source.
  assertEquals(
    await sourceFingerprint(prior, staged.contacts),
    "82a7fdc19cc5e219ff5821bdbdb3e0222a2c41e8bc2bd96c782a8ff63b34e9d9",
  );
});
