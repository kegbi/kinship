/**
 * A person's life events over HTTP (JOURNAL-002): record, edit, remove.
 *
 * The read stays with the person's page (`people` serves it from the
 * person-profile read model); these three writes are the journal module's,
 * because it owns `life_events`. Both directions carry exactly the
 * components the stated precision declares, and a refusal names life events
 * rather than borrowing the person's words.
 */

import { type Context, Hono } from "hono";
import type { z } from "zod";
import type {
  LifeEventManagement,
  LifeEventValue,
  StoredLifeEvent,
} from "../../public.ts";
import {
  createPersonLifeEvent,
  deletePersonLifeEvent,
  updatePersonLifeEvent,
} from "../../../../../contracts/routes/people.ts";
import {
  personLifeEventInput,
  personLifeEventUpdateInput,
  personTransitionInput,
} from "../../../../../contracts/schemas/people.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import type { PersonalTokenAuthority } from "../../../../../http-kit/scoped_actor.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import type { ProblemErrors } from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import { parseJsonBody, parseValue } from "../../../../../http-kit/validate.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import { routeAdmission } from "./admission.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface LifeEventHttpServices {
  /** The personal-token authority; the three writes require `people:write`. */
  readonly apiTokens?: PersonalTokenAuthority;
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly lifeEvents: LifeEventManagement;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
}

/**
 * What a refused life-event write says. A section an administrator turned
 * off and a membership that no longer permits the write answer alike, so the
 * refusal never says which sections a workspace has configured.
 */
export const LIFE_EVENT_FAILURES: FailureTable = {
  fallback: {
    code: "validation_failed",
    detail: "Review the name, type, precision, and known date components.",
    status: 400,
    title: "Invalid life event",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore this person before changing life events.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "life_events_forbidden",
      detail:
        "Your active workspace membership or profile configuration no longer permits this change.",
      title: "Life events unavailable",
    },
    hidden: {
      code: "life_events_forbidden",
      detail:
        "Your active workspace membership or profile configuration no longer permits this change.",
      status: 403,
      title: "Life events unavailable",
    },
    "not-found": {
      code: "life_event_not_found",
      detail:
        "The person or life event does not exist in the active workspace.",
      title: "Life event not found",
    },
    stale: {
      code: "life_event_stale",
      detail: "Refresh the life events before trying again.",
      status: 409,
      title: "Life event changed",
    },
    unavailable: {
      code: "life_events_unavailable",
      detail: "Life events are temporarily unavailable.",
      title: "Life events unavailable",
    },
  },
};

const failure = failureResponder(LIFE_EVENT_FAILURES);

/** A body the contract refuses, with the field errors the contract named. */
function invalid(context: Context, errors: ProblemErrors): Response {
  return failure(context, { errors, status: "validation-error" });
}

/** The command a request body makes, carrying only what it named. */
function lifeEventValue(
  input: z.infer<typeof personLifeEventInput>,
): LifeEventValue {
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.note === undefined ? {} : { note: input.note }),
    precision: input.precision,
    ...(input.typeId === undefined ? {} : { typeId: input.typeId }),
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}

/** The event as the person's page reads it, whichever route answers. */
export function presentLifeEvent(event: StoredLifeEvent) {
  return {
    date: {
      ...(event.day === undefined ? {} : { day: event.day }),
      ...(event.happenedAt ? { happenedAt: event.happenedAt } : {}),
      ...(event.month === undefined ? {} : { month: event.month }),
      precision: event.precision,
      ...(event.year === undefined ? {} : { year: event.year }),
    },
    id: event.id,
    ...(event.name ? { name: event.name } : {}),
    ...(event.note ? { note: event.note } : {}),
    ...(event.typeId ? { typeId: event.typeId } : {}),
    ...(event.typeName ? { typeName: event.typeName } : {}),
    updatedAt: event.updatedAt,
  };
}

export function createLifeEventRoutes(
  services: LifeEventHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const create = routeAdmission(createPersonLifeEvent, tokens);
  const update = routeAdmission(updatePersonLifeEvent, tokens);
  const remove = routeAdmission(deletePersonLifeEvent, tokens);

  mount(
    routes,
    createPersonLifeEvent,
    create.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const input = await parseJsonBody(context, personLifeEventInput);
      if ("errors" in personId) return failure(context, "not-found");
      if ("errors" in input) return invalid(context, input.errors);
      const actor = await create.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.lifeEvents.create(
        actor,
        personId.data,
        lifeEventValue(input.data),
      );
      if (result.status !== "created") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(
        { event: presentLifeEvent(result.event), status: "created" },
        201,
      );
    },
  );

  mount(
    routes,
    updatePersonLifeEvent,
    update.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const lifeEventId = parseValue(uuid, context.req.param("lifeEventId"));
      const input = await parseJsonBody(context, personLifeEventUpdateInput);
      if ("errors" in personId || "errors" in lifeEventId) {
        return failure(context, "not-found");
      }
      if ("errors" in input) return invalid(context, input.errors);
      const actor = await update.actor(context);
      if (actor instanceof Response) return actor;
      const { expectedUpdatedAt, ...value } = input.data;
      const result = await services.lifeEvents.update(
        actor,
        personId.data,
        lifeEventId.data,
        { ...lifeEventValue(value), expectedUpdatedAt },
      );
      if (result.status !== "updated") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        event: presentLifeEvent(result.event),
        status: "updated",
      });
    },
  );

  mount(
    routes,
    deletePersonLifeEvent,
    remove.gate,
    session,
    async (context) => {
      const personId = parseValue(uuid, context.req.param("personId"));
      const lifeEventId = parseValue(uuid, context.req.param("lifeEventId"));
      const input = await parseJsonBody(context, personTransitionInput);
      if ("errors" in personId || "errors" in lifeEventId) {
        return failure(context, "not-found");
      }
      if ("errors" in input) return invalid(context, input.errors);
      const actor = await remove.actor(context);
      if (actor instanceof Response) return actor;
      const result = await services.lifeEvents.delete(
        actor,
        personId.data,
        lifeEventId.data,
        input.data,
      );
      if (result.status !== "deleted") return failure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json({
        lifeEventId: result.lifeEventId,
        status: "deleted",
      });
    },
  );

  return routes;
}
