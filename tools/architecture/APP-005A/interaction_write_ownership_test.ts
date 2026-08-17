function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-005A interaction write adapter reads only interaction-owned tables", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../packages/backend/modules/interactions/adapters/postgres/interaction_repository.ts",
      import.meta.url,
    ),
  );
  for (
    const foreignTable of [
      "crm.people",
      "crm.activity_types",
      "crm.emotion_options",
    ]
  ) {
    assert(
      !source.includes(foreignTable),
      `interaction write adapter reads foreign table ${foreignTable}`,
    );
  }
});

Deno.test("APP-005B communication adapter reads only interaction-owned tables", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "../../../packages/backend/modules/interactions/adapters/postgres/communication_repository.ts",
      import.meta.url,
    ),
  );
  for (
    const foreignTable of [
      "crm.people",
      "crm.contact_method_types",
      "crm.person_contact_methods",
      "crm.emotion_options",
    ]
  ) {
    assert(
      !source.includes(foreignTable),
      `communication adapter reads foreign table ${foreignTable}`,
    );
  }
});
