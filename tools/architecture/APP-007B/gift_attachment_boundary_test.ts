function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-007B gifts consume files-owned links only through its public boundary", async () => {
  const source = await Deno.readTextFile(
    "packages/backend/modules/gifts/adapters/postgres/gift_repository.ts",
  );
  assert(
    !source.includes("gift_file_links"),
    "gifts repository must not read files-owned gift_file_links",
  );
});
