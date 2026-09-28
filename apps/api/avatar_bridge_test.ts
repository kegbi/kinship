/**
 * The avatar bridge passes on what a discard answered (REL-083).
 *
 * People records an avatar image it could not discard, so the bridge that
 * fills people's images port with the files facade must not swallow the
 * facade's `unavailable` answer, as it once did.
 */

import type { PersonFileManagement } from "../../packages/backend/modules/files/public.ts";
import { assertEquals } from "../../packages/backend/testing/assert.ts";
import { actor, uuid } from "../../packages/backend/testing/fixtures.ts";
import { avatarImages } from "./composition.ts";

function bridge(answer: "discarded" | "unavailable") {
  const files = {
    discardAvatar: () =>
      Promise.resolve(
        answer === "discarded"
          ? { fileIds: [uuid(1)], status: "discarded" as const }
          : { status: "unavailable" as const },
      ),
    discardHeldAvatars: () =>
      Promise.resolve(
        answer === "discarded"
          ? { fileIds: [], status: "discarded" as const }
          : { status: "unavailable" as const },
      ),
  } as unknown as PersonFileManagement;
  return avatarImages(files);
}

Deno.test("[REL-083] the avatar bridge passes on a discard the files module could not complete", async () => {
  const command = { actor: actor(), fileId: uuid(1), personId: uuid(2) };
  for (const answer of ["discarded", "unavailable"] as const) {
    assertEquals(await bridge(answer).discard(command), { status: answer });
    assertEquals(await bridge(answer).discardHeld(command), {
      status: answer,
    });
  }
});
