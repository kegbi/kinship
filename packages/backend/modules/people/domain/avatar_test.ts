import { assertEquals } from "../../../testing/assert.ts";
import {
  AVATAR_PALETTE,
  avatarColor,
  avatarView,
  isAvatarColor,
} from "./avatar.ts";

const ada = "10000000-0000-4000-8000-000000000001";
const grace = "10000000-0000-4000-8000-000000000002";

Deno.test("[GAP-045] a stored colour is kept, normalized to six lower-case digits", () => {
  assertEquals(avatarColor(ada, "#B3D5FE"), "#b3d5fe");
  assertEquals(avatarColor(ada, "#abc"), "#aabbcc", "a short colour expands");
  assertEquals(avatarColor(ada, " #b3d5fe "), "#b3d5fe", "padding is ignored");
});

Deno.test("[GAP-045] a person without a usable colour gets a stable palette colour", () => {
  for (const unusable of [undefined, "", "blue", "#12345", "#gggggg"]) {
    const color = avatarColor(ada, unusable);
    assertEquals(
      AVATAR_PALETTE.includes(color as typeof AVATAR_PALETTE[number]),
      true,
      `${unusable} falls back to the palette`,
    );
    assertEquals(color, avatarColor(ada), "the fallback is stable per person");
  }
  const colours = new Set(
    Array.from(
      { length: 64 },
      (_, index) =>
        avatarColor(
          `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
    ),
  );
  assertEquals(colours.size > 1, true, "people are spread over the palette");
  assertEquals(avatarColor(ada) === avatarColor(ada), true);
  assertEquals(typeof avatarColor(grace), "string");
});

Deno.test("[GAP-045] only six- or three-digit hex colours are colours", () => {
  assertEquals(isAvatarColor("#a1b2c3"), true);
  assertEquals(isAvatarColor("#A1B"), true);
  assertEquals(isAvatarColor("a1b2c3"), false);
  assertEquals(isAvatarColor("#a1b2c3d4"), false);
  assertEquals(isAvatarColor("red"), false);
});

Deno.test("[GAP-045] the view names the image only when a stored file backs it", () => {
  assertEquals(avatarView(ada, {}), { color: avatarColor(ada) });
  assertEquals(
    avatarView(ada, { backgroundColor: "#b3d5fe", fileId: grace }),
    { color: "#b3d5fe", fileId: grace },
  );
});
