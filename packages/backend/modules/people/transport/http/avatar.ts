/**
 * A person's avatar over HTTP (GAP-045, PEOPLE-007).
 *
 * `PUT` replaces the avatar with the image in the body and `DELETE` resets
 * the person to their initials. The image itself is never served from here:
 * the descriptor names the person-file download route, which authorizes and
 * serves it with the same private headers as any of the person's files.
 *
 * The upload reads its body like the person-file upload does, streamed
 * against the avatar's own one-megabyte ceiling, so the composition root
 * exempts this path from the global body cap and an oversized image is
 * answered as an avatar that is too large rather than as a generic refusal.
 */

import { Hono } from "hono";
import {
  removePersonAvatar,
  replacePersonAvatar,
} from "../../../../../contracts/routes/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import { readBoundedBody } from "../../../../../http-kit/body_limit.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../http-kit/origin.ts";
import { definedProblem } from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseValue } from "../../../../../http-kit/validate.ts";
import {
  avatarDescriptor,
  type PeopleHttpServices,
  PERSON_ID_INVALID,
} from "./shared.ts";

/** What an avatar is served from. */
export type PersonAvatarHttpServices = Pick<
  PeopleHttpServices,
  "avatars" | "browserSecurity" | "protectedSessions"
>;

/** The avatar's own upload ceiling, as the files module applies it. */
const AVATAR_BODY_MAX_BYTES = 1024 * 1024;

/** What a refused avatar change says. */
export const AVATAR_FAILURES: FailureTable = {
  fallback: {
    code: "avatar_unavailable",
    detail: "The avatar could not be changed right now.",
    status: 503,
    title: "Avatar unavailable",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before changing their avatar.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "people_forbidden",
      detail: "Your active workspace membership no longer permits this change.",
      title: "Avatar unavailable",
    },
    "not-found": {
      code: "person_not_found",
      detail: "No person with this identifier exists in the current workspace.",
      title: "Person not found",
    },
    quarantined: {
      code: "avatar_quarantined",
      detail:
        "This image did not pass the file check and was held for review. Choose another image.",
      status: 423,
      title: "Image held for review",
    },
    "rejected-media": {
      code: "avatar_media_rejected",
      detail: "Choose a JPEG, PNG, or WebP image.",
      status: 415,
      title: "Image type rejected",
    },
    "storage-limit": {
      code: "avatar_too_large",
      detail: "Choose an image of 1 MB or less.",
      status: 413,
      title: "Image too large",
    },
    "validation-error": {
      code: "avatar_invalid",
      detail: "Choose a non-empty image with a filename.",
      status: 400,
      title: "Invalid image",
    },
  },
};

const failure = failureResponder(AVATAR_FAILURES);

/** A filename carried in a header, percent-encoded by the browser. */
function decodedName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function createAvatarRoutes(
  services: PersonAvatarHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  mount(routes, replacePersonAvatar, origin, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return definedProblem(context, PERSON_ID_INVALID);
    const filename = decodedName(context.req.header("X-File-Name"));
    const mimeType = context.req.header("Content-Type")?.split(";", 1)[0]
      ?.trim();
    if (!filename || !mimeType) return failure(context, "validation-error");
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const bytes = await readBoundedBody(
      context.req.raw,
      AVATAR_BODY_MAX_BYTES,
    ).catch(() => undefined);
    if (!bytes) return failure(context, "storage-limit");
    const result = await services.avatars?.replace(actor, personId.data, {
      bytes,
      filename,
      mimeType,
    }).catch(() => undefined);
    if (!result) return failure(context, "unavailable");
    if (result.status !== "updated") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      avatar: avatarDescriptor(personId.data, result.avatar),
      status: "updated",
    });
  });

  mount(routes, removePersonAvatar, origin, session, async (context) => {
    const personId = parseValue(uuid, context.req.param("personId"));
    if ("errors" in personId) return definedProblem(context, PERSON_ID_INVALID);
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.avatars?.remove(actor, personId.data)
      .catch(() => undefined);
    if (!result) return failure(context, "unavailable");
    if (result.status !== "removed") return failure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json({
      avatar: avatarDescriptor(personId.data, result.avatar),
      status: "removed",
    });
  });

  return routes;
}
