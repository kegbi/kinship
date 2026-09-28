/**
 * A person's avatar over HTTP (GAP-045, PEOPLE-007): the upload is bounded by
 * the avatar's own limit before the use case sees it, each refusal keeps its
 * own status, and the answer is the descriptor every reader draws with.
 */

import type { PersonAvatarManagement } from "../../public.ts";
import { avatarColor } from "../../public.ts";
import { AVATAR_FAILURES } from "./avatar.ts";
import { createPeopleRoutes } from "./routes.ts";
import { assertEquals, assertStatus } from "../../../../testing/assert.ts";
import { actor, headers, services } from "./people.test-helper.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const fileId = "00000000-0000-4000-8000-000000000200";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function app(avatars: Partial<PersonAvatarManagement>) {
  return createPeopleRoutes({
    ...services({ create: () => Promise.reject(new Error("unused")) }),
    avatars: {
      remove: () => Promise.reject(new Error("must not remove")),
      replace: () => Promise.reject(new Error("must not replace")),
      ...avatars,
    },
  });
}

function put(
  body: BodyInit,
  extra: Readonly<Record<string, string>> = {},
  path = `/api/v1/people/${personId}/avatar`,
) {
  return {
    path: `http://localhost${path}`,
    init: {
      body,
      headers: {
        ...headers,
        "content-type": "image/png",
        "X-File-Name": encodeURIComponent("ada lovelace.png"),
        ...extra,
      },
      method: "PUT",
    },
  };
}

Deno.test("[PEOPLE-007] an uploaded image answers with the avatar descriptor", async () => {
  let received: Parameters<PersonAvatarManagement["replace"]> | undefined;
  const request = put(png);
  const response = await app({
    replace: (...args) => {
      received = args;
      return Promise.resolve({
        avatar: { backgroundColor: "#B3D5FE", fileId },
        status: "updated",
      });
    },
  }).request(request.path, request.init);
  assertStatus(response, 200);
  assertEquals(await response.json(), {
    avatar: {
      color: "#b3d5fe",
      hasStoredImage: true,
      imageUrl: `/api/v1/people/${personId}/files/${fileId}/content`,
    },
    status: "updated",
  });
  assertEquals(response.headers.get("Cache-Control"), "private, no-store");
  assertEquals(received?.[0].workspaceId, actor.workspaceId);
  assertEquals(received?.[1], personId);
  assertEquals(received?.[2].filename, "ada lovelace.png");
  assertEquals(received?.[2].mimeType, "image/png");
  assertEquals([...received![2].bytes], [...png]);
});

Deno.test("[PEOPLE-007] an oversized avatar is refused before the use case", async () => {
  const request = put(new Uint8Array(1024 * 1024 + 1));
  const response = await app({}).request(request.path, request.init);
  assertStatus(response, 413);
  assertEquals(
    (await response.json() as { readonly code: string }).code,
    "avatar_too_large",
  );
});

Deno.test("[PEOPLE-007] a malformed upload is refused before the use case", async () => {
  for (
    const request of [
      put(png, {}, "/api/v1/people/not-a-person/avatar"),
      put(png, { "X-File-Name": "" }),
      put(png, { "X-File-Name": "%E0%A4%A" }),
      put(png, { "content-type": "" }),
    ]
  ) {
    const response = await app({}).request(request.path, request.init);
    assertStatus(response, 400);
  }
});

Deno.test("[PEOPLE-007] each refusal keeps its own status", async () => {
  const cases = [
    ["archived-write-rejected", 409, "archived_write_rejected"],
    ["forbidden", 403, "people_forbidden"],
    ["not-found", 404, "person_not_found"],
    ["quarantined", 423, "avatar_quarantined"],
    ["rejected-media", 415, "avatar_media_rejected"],
    ["storage-limit", 413, "avatar_too_large"],
    ["unavailable", 503, "avatar_unavailable"],
    ["validation-error", 400, "avatar_invalid"],
  ] as const;
  for (const [status, http, code] of cases) {
    const request = put(png);
    const response = await app({
      replace: () => Promise.resolve({ status }),
    }).request(request.path, request.init);
    assertStatus(response, http, status);
    assertEquals(
      (await response.json() as { readonly code: string }).code,
      code,
      status,
    );
  }
  const request = put(png);
  const thrown = await app({
    replace: () => Promise.reject(new Error("down")),
  }).request(request.path, request.init);
  assertStatus(thrown, 503);
});

Deno.test("[PEOPLE-007] removing an avatar answers with the initials descriptor", async () => {
  const response = await app({
    remove: (resolved, id) =>
      Promise.resolve(
        resolved.workspaceId === actor.workspaceId && id === personId
          ? { avatar: {}, status: "removed" }
          : { status: "not-found" },
      ),
  }).request(`http://localhost/api/v1/people/${personId}/avatar`, {
    headers,
    method: "DELETE",
  });
  assertStatus(response, 200);
  assertEquals(await response.json(), {
    avatar: { color: avatarColor(personId), hasStoredImage: false },
    status: "removed",
  });

  for (
    const [status, http] of [["archived-write-rejected", 409], [
      "unavailable",
      503,
    ]] as const
  ) {
    const refused = await app({
      remove: () => Promise.resolve({ status }),
    }).request(`http://localhost/api/v1/people/${personId}/avatar`, {
      headers,
      method: "DELETE",
    });
    assertStatus(refused, http, status);
  }
  const invalid = await app({}).request(
    "http://localhost/api/v1/people/nobody/avatar",
    { headers, method: "DELETE" },
  );
  assertStatus(invalid, 400);
  const thrown = await app({
    remove: () => Promise.reject(new Error("down")),
  }).request(`http://localhost/api/v1/people/${personId}/avatar`, {
    headers,
    method: "DELETE",
  });
  assertStatus(thrown, 503);
});

Deno.test("[PEOPLE-007] an avatar write needs the page's own origin", async () => {
  const request = put(png, { origin: "https://elsewhere.example" });
  const response = await app({}).request(request.path, request.init);
  assertStatus(response, 403);
});

Deno.test("[PEOPLE-007] the avatar refusals are the table the web app reads", () => {
  assertEquals(
    Object.keys(AVATAR_FAILURES.statuses).sort(),
    [
      "archived-write-rejected",
      "forbidden",
      "not-found",
      "quarantined",
      "rejected-media",
      "storage-limit",
      "validation-error",
    ],
  );
});
