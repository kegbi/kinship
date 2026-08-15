import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  PeopleManagement,
  PersonIdentity,
} from "../../packages/backend/modules/people/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PeopleHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly people: PeopleManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

const personSchema = z.object({
  duplicateOverride: z.boolean().optional(),
  familyName: z.string().trim().max(200).optional(),
  givenName: z.string().trim().max(200),
  isPartial: z.boolean(),
  middleName: z.string().trim().max(200).optional(),
  nickname: z.string().trim().max(200).optional(),
}).strict();
const personIdSchema = z.uuid();

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Readonly<Record<string, string>>,
): Response {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...(errors ? { errors } : {}),
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

function requireOrigin(
  context: Context,
  policy: BrowserSecurityPolicy,
): Response | undefined {
  return context.req.header("Origin") === policy.origin ? undefined : problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

async function actor(context: Context, services: PeopleHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved
    ? {
      memberId: resolved.memberId,
      role: resolved.role,
      userId: resolved.userId,
      workspaceId: resolved.workspaceId,
    }
    : undefined;
}

function identity(person: PersonIdentity) {
  return {
    ...(person.familyName ? { familyName: person.familyName } : {}),
    givenName: person.givenName,
    id: person.id,
    isPartial: person.isPartial,
    ...(person.middleName ? { middleName: person.middleName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
  };
}

export function createPeopleRoutes(services: PeopleHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/people/:personId", async (context) => {
    const parsed = personIdSchema.safeParse(context.req.param("personId"));
    if (!parsed.success) {
      return problem(
        context,
        400,
        "person_id_invalid",
        "Invalid person",
        "Use a valid canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.get(resolved, parsed.data).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person unavailable",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person unavailable",
        "Your active workspace membership no longer permits this view.",
      );
    }
    if (result.status === "not-found") {
      return problem(
        context,
        404,
        "person_not_found",
        "Person not found",
        "No active person with this identifier exists in the current workspace.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      person: identity(result.person),
      status: "ready",
    });
  });
  routes.post("/api/v1/people", async (context) => {
    const forbidden = requireOrigin(context, services.browserSecurity);
    if (forbidden) return forbidden;
    const parsed = personSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!parsed.success) {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the identity fields and try again.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) {
      return problem(
        context,
        401,
        "session_invalid",
        "Authentication required",
        "Sign in with an active workspace membership.",
      );
    }
    const result = await services.people.create(resolved, {
      ...(parsed.data.duplicateOverride === true
        ? { duplicateOverride: true }
        : {}),
      ...(parsed.data.familyName ? { familyName: parsed.data.familyName } : {}),
      givenName: parsed.data.givenName,
      isPartial: parsed.data.isPartial,
      ...(parsed.data.middleName ? { middleName: parsed.data.middleName } : {}),
      ...(parsed.data.nickname ? { nickname: parsed.data.nickname } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "people_unavailable",
        "Person could not be created",
        "The person service is temporarily unavailable.",
      );
    }
    if (result.status === "validation-error") {
      return problem(
        context,
        400,
        "validation_failed",
        "Invalid person",
        "Review the highlighted identity fields and try again.",
        result.errors,
      );
    }
    if (result.status === "possible-duplicate") {
      return problem(
        context,
        409,
        "possible_duplicate",
        "Possible duplicate",
        `A person named ${
          result.duplicates[0]?.displayName ?? "this"
        } already exists in this workspace. Review the match or create anyway.`,
        { duplicate: "Confirm Create anyway to keep both people." },
      );
    }
    if (result.status === "forbidden") {
      return problem(
        context,
        403,
        "people_forbidden",
        "Person could not be created",
        "Your active workspace membership no longer permits this change.",
      );
    }
    context.header("Cache-Control", "private, no-store");
    return context.json({
      next: `/app/people/${result.person.id}`,
      person: identity(result.person),
      status: "created",
    }, 201);
  });
  return routes;
}
