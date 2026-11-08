/**
 * Reading the workspace's relationship vocabulary, and one person's edges.
 *
 * Both listings page one more row than they will show, so "is there another
 * page" is answered without a second count, and both re-check their cursor
 * against the question it was minted for — a different workspace, person, or
 * search makes a cursor stale rather than silently answered.
 *
 * The edge listing is deliberately conservative about what it shows: an edge
 * whose type the workspace no longer publishes, or whose endpoints the person
 * boundary will not summarize, is dropped rather than rendered with a blank
 * label or a name the actor may not see. A workspace that hides the section
 * answers with an empty list and says so, so the caller can tell "nothing
 * here" from "not for you".
 */

import {
  decodeRelationshipCursor,
  decodeRelationshipTypeCursor,
  encodeRelationshipCursor,
  encodeRelationshipTypeCursor,
} from "../domain/cursors.ts";
import { decorate, displays } from "../domain/relationship_rules.ts";
import type { RelationshipActor } from "../ports/context.ts";
import {
  active,
  type RelationshipDependencies,
} from "./relationship_context.ts";

/** How many types one page shows, and how many are read to know there is more. */
const TYPE_PAGE_SIZE = 20;
/** How many relationships one page shows at most, as the contract publishes it. */
export const RELATIONSHIP_PAGE_LIMIT_MAXIMUM = 50;
/** How many it shows when the caller names no size. */
export const RELATIONSHIP_PAGE_LIMIT_DEFAULT = 20;

export interface ListRelationshipTypesInput {
  readonly cursor?: string;
  readonly search?: string;
  readonly selectedTypeIds?: readonly string[];
}

export interface ListRelationshipsInput {
  readonly cursor?: string;
  readonly limit?: number;
}

export function createRelationshipListing(
  dependencies: RelationshipDependencies,
) {
  return {
    listTypes: (
      actor: RelationshipActor,
      input: ListRelationshipTypesInput = {},
    ) =>
      dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const search = input.search?.trim() ?? "";
        const after = input.cursor
          ? decodeRelationshipTypeCursor(
            input.cursor,
            actor.workspaceId,
            search,
          )
          : undefined;
        if (input.cursor && !after) {
          return { status: "stale-cursor" as const };
        }
        const defaults = await dependencies.workspace
          .ensureDefaultRelationshipTypes({ ...actor, transaction });
        if (defaults.status === "hidden") {
          return { options: [], selected: [], status: "hidden" as const };
        }
        if (defaults.status === "forbidden") return defaults;
        const page = await dependencies.workspace.listTypes({
          ...actor,
          ...(after ? { after } : {}),
          limit: TYPE_PAGE_SIZE + 1,
          ...(search ? { search } : {}),
          transaction,
        });
        if (page.status === "hidden") {
          return { options: [], selected: [], status: "hidden" as const };
        }
        if (page.status !== "ready") return page;
        const visible = page.records.slice(0, TYPE_PAGE_SIZE);
        const hydration = await dependencies.workspace.hydrateTypes({
          ...actor,
          relationshipTypeIds: [...new Set(input.selectedTypeIds ?? [])].slice(
            0,
            TYPE_PAGE_SIZE,
          ),
          transaction,
        });
        if (hydration.status === "hidden") {
          return { options: [], selected: [], status: "hidden" as const };
        }
        if (hydration.status === "forbidden") return hydration;
        const final = visible.at(-1);
        return {
          ...(page.records.length > TYPE_PAGE_SIZE && final
            ? {
              nextCursor: encodeRelationshipTypeCursor(
                final.cursor,
                actor.workspaceId,
                search,
              ),
            }
            : {}),
          options: visible.map(({ cursor: _cursor, ...option }) => option),
          selected: hydration.records,
          status: "ready" as const,
        };
      }, { workspaceId: actor.workspaceId }),
    list: (
      actor: RelationshipActor,
      personId: string,
      input: ListRelationshipsInput = {},
    ) =>
      dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, actor, transaction, false)) {
          return { status: "forbidden" as const };
        }
        const workspace = await dependencies.workspace
          .ensureDefaultRelationshipTypes({ ...actor, transaction });
        if (workspace.status === "forbidden") {
          return { status: "forbidden" as const };
        }
        if (workspace.status === "hidden") {
          return { relationships: [], status: "hidden" as const };
        }
        const subject = await dependencies.people.inspect({
          ...actor,
          lock: false,
          personIds: [personId],
          transaction,
        });
        if (subject.status === "not-found") {
          return { status: "not-found" as const };
        }
        const limit = Math.max(
          1,
          Math.min(
            RELATIONSHIP_PAGE_LIMIT_MAXIMUM,
            Math.trunc(input.limit ?? RELATIONSHIP_PAGE_LIMIT_DEFAULT),
          ),
        );
        const after = input.cursor
          ? decodeRelationshipCursor(input.cursor, actor.workspaceId, personId)
          : undefined;
        if (input.cursor && !after) {
          return { status: "stale-cursor" as const };
        }
        const page = await dependencies.repository.list({
          ...actor,
          ...(after ? { after } : {}),
          limit: limit + 1,
          personId,
          transaction,
        });
        if (page.status !== "ready") return page;
        const visible = page.records.slice(0, limit);
        const typeHydration = await dependencies.workspace.hydrateTypes({
          ...actor,
          relationshipTypeIds: visible.map((record) =>
            record.relationshipTypeId
          ),
          transaction,
        });
        if (typeHydration.status === "hidden") {
          return { relationships: [], status: "hidden" as const };
        }
        if (typeHydration.status === "forbidden") return typeHydration;
        const byId = new Map(
          typeHydration.records.map((type) => [type.id, type]),
        );
        const endpointIds = [
          ...new Set(visible.flatMap((record) => [
            record.fromPersonId,
            record.toPersonId,
          ])),
        ];
        const summaries = await dependencies.people.summarize({
          ...actor,
          personIds: endpointIds,
          transaction,
        });
        const summaryById = new Map(summaries.map((summary) => [
          summary.id,
          summary,
        ]));
        const relationships = visible.flatMap((record) => {
          const type = byId.get(record.relationshipTypeId);
          if (
            !type || !summaryById.has(record.fromPersonId) ||
            !summaryById.has(record.toPersonId)
          ) return [];
          const hydrated = decorate(record, type);
          const displayed = displays(hydrated, personId);
          const summary = summaryById.get(displayed.personId);
          return [{
            ...hydrated,
            display: { ...displayed, name: summary!.name },
          }];
        });
        const final = visible.at(-1);
        return {
          ...(page.records.length > limit && final
            ? {
              nextCursor: encodeRelationshipCursor(
                final,
                actor.workspaceId,
                personId,
              ),
            }
            : {}),
          relationships,
          status: subject.status,
        };
      }, { workspaceId: actor.workspaceId }),
  };
}
