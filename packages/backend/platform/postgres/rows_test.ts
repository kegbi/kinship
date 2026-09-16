import { pickDefined } from "./rows.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[GAP-010] an absent column leaves the property off entirely", () => {
  const picked = pickDefined({
    completedAt: null as string | null,
    description: "" as string | null,
    dueAt: undefined as string | undefined,
    personId: "1b4f0e98-51bb-4f8e-b0a9-77c4e1fd2e5c",
  });
  assert(
    Object.keys(picked).join(",") === "personId",
    `only the present column survives, received ${Object.keys(picked)}`,
  );
  assert(
    !("completedAt" in picked) && !("description" in picked) &&
      !("dueAt" in picked),
    "an absent column must not appear as an explicit undefined",
  );
  assert(
    picked.personId === "1b4f0e98-51bb-4f8e-b0a9-77c4e1fd2e5c",
    "a present column keeps its value",
  );
});

Deno.test("[GAP-010] the mapper composes with the required half of a record", () => {
  const row = {
    id: "8d2c",
    nickname: null as string | null,
    title: "Send the invitation",
  };
  const record: { readonly id: string; readonly nickname?: string } = {
    id: row.id,
    ...pickDefined({ nickname: row.nickname }),
  };
  assert(
    record.nickname === undefined && Object.keys(record).length === 1,
    `an optional property stays absent, received ${JSON.stringify(record)}`,
  );
  const named = { id: row.id, ...pickDefined({ nickname: row.title }) };
  assert(
    named.nickname === "Send the invitation",
    `a present optional property is spread in, received ${
      JSON.stringify(named)
    }`,
  );
});
