import { describe, expect, it } from "vitest";
import { isUuid, UUID_SOURCE } from "./uuid.ts";

describe("MCP-R3 one web definition of a UUID", () => {
  it.each([
    ["a time-based v1", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"],
    ["a random v4", "123e4567-e89b-42d3-a456-426614174000"],
    ["a Unix-time v7", "017f22e2-79b0-7cc3-98c4-dc0c0c07398f"],
    ["a derived v8", "8e5213b9-8cee-8024-8aed-45319d1b7d1b"],
    ["an upper-case v8", "8E5213B9-8CEE-8024-8AED-45319D1B7D1B"],
  ])("accepts %s", (_, value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each([
    ["the nil uuid", "00000000-0000-0000-0000-000000000000"],
    ["the max uuid", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
    ["version 9", "8e5213b9-8cee-9024-8aed-45319d1b7d1b"],
    ["the Microsoft variant", "8e5213b9-8cee-8024-caed-45319d1b7d1b"],
    ["a short uuid", "8e5213b9-8cee-8024-8aed-45319d1b7d1"],
    ["a padded uuid", " 8e5213b9-8cee-8024-8aed-45319d1b7d1b"],
    ["nonsense", "not-a-uuid"],
  ])("refuses %s", (_, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it("embeds in a route pattern without anchors of its own", () => {
    const route = new RegExp(`^/app/journal/(${UUID_SOURCE})$`);
    expect(
      route.exec("/app/journal/8e5213b9-8cee-8024-8aed-45319d1b7d1b")?.[1],
    ).toBe("8e5213b9-8cee-8024-8aed-45319d1b7d1b");
  });
});
