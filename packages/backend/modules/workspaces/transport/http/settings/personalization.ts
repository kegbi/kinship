/**
 * The vocabularies a workspace configures for itself.
 *
 * Four routes over nine sections: tags, contact labels, relationship types,
 * reminder rules, and the rest. A section is a path parameter the
 * personalization use case validates, not an enum this file keeps, so the
 * route refuses an unknown one with a 404 on the link rather than a 400 on a
 * field. The descriptor publishes the accepted sections as an enum, which is
 * what a reader of the document needs; the route still asks the use case, so
 * an unknown section is still a link that leads nowhere.
 *
 * Deleting an option that records still point at is the one refusal that
 * counts: it names how many, so the page can offer a replacement rather than
 * a dead end.
 */

import { type Context, Hono } from "hono";
import type {
  ContactMethodKind,
  PersonalizationSection,
} from "../../../public.ts";
import {
  createPersonalizationEntry,
  deletePersonalizationEntry,
  deletePersonalizationEntryQuery,
  listPersonalizationEntries,
  updatePersonalizationEntry,
} from "../../../../../../contracts/routes/settings.ts";
import { uuid } from "../../../../../../contracts/schemas/shared.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../../http-kit/failures.ts";
import { requireMatchingOrigin } from "../../../../../../http-kit/origin.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../../http-kit/problem.ts";
import { mount } from "../../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  sessionActor,
} from "../../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseValue,
} from "../../../../../../http-kit/validate.ts";
import {
  personalizationCreateSchema,
  personalizationUpdateSchema,
} from "./personalization_schemas.ts";
import { privateJson, type SettingsHttpServices } from "./shared.ts";

/** What a workspace's configurable vocabularies are served from. */
export type PersonalizationHttpServices = Pick<
  SettingsHttpServices,
  "browserSecurity" | "personalization" | "protectedSessions"
>;

/** What a refused personalization change says. */
export const PERSONALIZATION_FAILURES: FailureTable = {
  fallback: {
    code: "personalization_unavailable",
    detail: "Personalization could not be updated.",
    status: 503,
    title: "Personalization unavailable",
  },
  statuses: {
    conflict: {
      code: "personalization_duplicate",
      detail: "Choose a unique name in this workspace.",
      title: "Name already used",
    },
    forbidden: {
      code: "personalization_forbidden",
      detail:
        "Only an active workspace owner or admin may manage personalization.",
      title: "Personalization forbidden",
    },
    invalid: {
      code: "validation_failed",
      detail: "That change is not supported by this section.",
      status: 400,
      title: "Invalid personalization change",
    },
    "not-found": {
      code: "personalization_not_found",
      detail: "That option does not belong to this active workspace.",
      title: "Option unavailable",
    },
    "replacement-conflict": {
      code: "personalization_replacement_conflict",
      detail:
        "Some records already use both the source and replacement options. Resolve the duplicate primary or relationship history before replacing this option.",
      status: 409,
      title: "Replacement conflicts with existing history",
    },
    "required-default": {
      code: "personalization_required_default",
      detail:
        "This required or seeded option can be disabled where supported, but cannot be deleted.",
      status: 409,
      title: "Required option",
    },
    stale: {
      code: "personalization_stale",
      detail: "Reload this section before applying another change.",
      status: 409,
      title: "Option changed",
    },
  },
};

export const personalizationFailure = failureResponder(
  PERSONALIZATION_FAILURES,
);

/** The conflict that names how many records still point at an option. */
export function replacementRequired(
  referenceCount: number,
): ProblemDefinition {
  return {
    code: "personalization_replacement_required",
    detail:
      `${referenceCount} references must be moved before this option can be deleted.`,
    status: 409,
    title: "Replacement required",
  };
}

export const SECTION_NOT_FOUND: ProblemDefinition = {
  code: "personalization_section_not_found",
  detail: "Use an accepted personalization section link.",
  status: 404,
  title: "Section unavailable",
};
export const PERSONALIZATION_CREATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Provide an accepted section, unique name, and valid order.",
  status: 400,
  title: "Invalid personalization option",
};
export const PERSONALIZATION_UPDATE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Reload the option and provide valid values.",
  status: 400,
  title: "Invalid personalization option",
};
export const PERSONALIZATION_DELETE_INVALID: ProblemDefinition = {
  code: "validation_failed",
  detail: "Reload the option and choose a valid replacement when required.",
  status: 400,
  title: "Invalid personalization deletion",
};

export function createPersonalizationRoutes(
  services: PersonalizationHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  const section = (context: Context): PersonalizationSection | undefined => {
    const value = context.req.param("section");
    return value && services.personalization.isSection(value)
      ? value
      : undefined;
  };
  const refusedPersonalization = (
    context: Context,
    result: { readonly referenceCount?: number; readonly status: string },
  ): Response =>
    result.status === "replacement-required"
      ? definedProblem(
        context,
        replacementRequired(result.referenceCount ?? 0),
      )
      : personalizationFailure(context, result);

  mount(
    routes,
    listPersonalizationEntries,
    session,
    async (context) => {
      const selected = section(context);
      if (!selected) return definedProblem(context, SECTION_NOT_FOUND);
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalization.list(actor, selected)
        .catch(() => undefined);
      return result?.status === "ready"
        ? privateJson(context, {
          capabilities: result.capabilities,
          entries: result.entries,
          readOnly: result.readOnly,
          section: selected,
          status: "ready",
        })
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  mount(
    routes,
    createPersonalizationEntry,
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const parsed = selected
        ? await parseJsonBody(context, personalizationCreateSchema(selected))
        : undefined;
      if (!selected || !parsed || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_CREATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const data = parsed.data as {
        readonly contactKind?: ContactMethodKind;
        readonly daysBefore?: number;
        readonly forwardLabel?: string;
        readonly name?: string;
        readonly reverseLabel?: string;
        readonly sortOrder?: number;
      };
      const result = await services.personalization.mutate(actor, selected, {
        action: "create",
        ...(data.contactKind === undefined
          ? {}
          : { contactKind: data.contactKind }),
        ...(data.daysBefore === undefined
          ? {}
          : { daysBefore: data.daysBefore }),
        ...(data.forwardLabel === undefined
          ? {}
          : { forwardLabel: data.forwardLabel }),
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.reverseLabel === undefined
          ? {}
          : { reverseLabel: data.reverseLabel }),
        sortOrder: data.sortOrder ?? 0,
      }).catch(() => undefined);
      return result?.status === "saved"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  mount(
    routes,
    updatePersonalizationEntry,
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const id = parseValue(uuid, context.req.param("id"));
      const parsed = selected
        ? await parseJsonBody(context, personalizationUpdateSchema(selected))
        : undefined;
      if (!selected || "errors" in id || !parsed || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_UPDATE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const data = parsed.data as {
        readonly contactKind?: ContactMethodKind;
        readonly daysBefore?: number;
        readonly expectedUpdatedAt: string;
        readonly forwardLabel?: string;
        readonly isActive?: boolean;
        readonly isDefault?: true;
        readonly name?: string;
        readonly reverseLabel?: string;
        readonly sortOrder?: number;
      };
      const result = await services.personalization.mutate(actor, selected, {
        action: "update",
        expectedUpdatedAt: data.expectedUpdatedAt,
        id: id.data,
        ...(data.contactKind === undefined
          ? {}
          : { contactKind: data.contactKind }),
        ...(data.isActive === undefined ? {} : { isActive: data.isActive }),
        ...(data.isDefault === undefined ? {} : { isDefault: data.isDefault }),
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.daysBefore === undefined
          ? {}
          : { daysBefore: data.daysBefore }),
        ...(data.forwardLabel === undefined
          ? {}
          : { forwardLabel: data.forwardLabel }),
        ...(data.reverseLabel === undefined
          ? {}
          : { reverseLabel: data.reverseLabel }),
        ...(data.sortOrder === undefined ? {} : { sortOrder: data.sortOrder }),
      }).catch(() => undefined);
      return result?.status === "saved"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );

  mount(
    routes,
    deletePersonalizationEntry,
    origin,
    session,
    async (context) => {
      const selected = section(context);
      const id = parseValue(uuid, context.req.param("id"));
      const parsed = parseValue(deletePersonalizationEntryQuery, {
        expectedUpdatedAt: context.req.query("expectedUpdatedAt"),
        replacementId: context.req.query("replacementId"),
      });
      if (!selected || "errors" in id || "errors" in parsed) {
        return definedProblem(context, PERSONALIZATION_DELETE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.personalization.mutate(actor, selected, {
        action: "delete",
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        id: id.data,
        ...(parsed.data.replacementId
          ? { replacementId: parsed.data.replacementId }
          : {}),
      }).catch(() => undefined);
      return result?.status === "deleted"
        ? privateJson(context, result)
        : refusedPersonalization(context, result ?? { status: "unavailable" });
    },
  );
  return routes;
}
