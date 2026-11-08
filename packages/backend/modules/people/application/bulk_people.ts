/**
 * Acting on several people at once (GAP-051, PEOPLE-009).
 *
 * A bulk action adds no write path of its own. Each person is run through the
 * single-person use case a member would have used on their page, in its own
 * transaction: archive and restore through the lifecycle, tagging through the
 * tags profile fact. So each person gets the same checks, the same audit
 * event, and the same postconditions, and one refused person never rolls
 * another back. Partial success is the expected answer, reported per person
 * in request order.
 *
 * Only what concerns the whole request is refused as a whole: a malformed
 * request, an actor who may no longer act in the workspace, or a tag that is
 * not the workspace's. If the actor loses access part-way through, the person
 * that found out fails as `forbidden` and everybody after them is `skipped`,
 * because nothing more could have succeeded.
 */

import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import {
  bulkFailureCode,
  bulkInputErrors,
  type BulkItemResult,
  type BulkPeopleAction,
  type BulkPeopleInput,
  type BulkSummary,
  bulkSummary,
  tagChange,
  transitionPlan,
} from "../domain/bulk_rules.ts";
import type { PersonTransition } from "../domain/lifecycle_rules.ts";
import type { TagsFact } from "../domain/profile_facts/values.ts";
import type { PeopleBulkTagLookup } from "../ports/bulk.ts";
import type { PeopleActor, PeopleTransactionRunner } from "../ports/context.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";
import type { createPersonLifecycle } from "./lifecycle_person.ts";
import type { ProfileFactManagement } from "./profile_facts.ts";

export interface BulkPeopleDependencies {
  readonly actors: ActorRevalidation;
  readonly lifecycle: Pick<
    ReturnType<typeof createPersonLifecycle>,
    "archiveInTransaction" | "inspectInTransaction" | "restoreInTransaction"
  >;
  readonly profileFacts: Pick<
    ProfileFactManagement,
    "create" | "list" | "update"
  >;
  readonly tags: PeopleBulkTagLookup;
  readonly transaction: PeopleTransactionRunner;
}

export type BulkPeopleResult =
  | Failure<"forbidden", "tag-unavailable">
  | ValidationFailure
  | {
    readonly action: BulkPeopleAction;
    readonly results: readonly BulkItemResult[];
    readonly status: "ready";
    readonly summary: BulkSummary;
  };

type ItemResult = Omit<BulkItemResult, "personId">;

const DONE: ItemResult = { outcome: "done" };
const UNCHANGED: ItemResult = { outcome: "unchanged" };

function failed(status: string): ItemResult {
  return { code: bulkFailureCode(status), outcome: "failed" };
}

export function createBulkPeopleActions(dependencies: BulkPeopleDependencies) {
  const transition = (
    actor: PeopleActor,
    action: PersonTransition,
    personId: string,
  ): Promise<ItemResult> =>
    dependencies.transaction.run(async (transaction) => {
      const locked = await dependencies.lifecycle.inspectInTransaction(
        actor,
        personId,
        transaction,
      );
      if (locked.status !== "ready") return failed(locked.status);
      const plan = transitionPlan(action, locked.person.lifecycle);
      if (plan === "unchanged") return UNCHANGED;
      if (plan !== "proceed") return failed(plan);
      const input = { expectedUpdatedAt: locked.person.updatedAt };
      const result = action === "archive"
        ? await dependencies.lifecycle.archiveInTransaction(
          actor,
          personId,
          input,
          transaction,
        )
        : await dependencies.lifecycle.restoreInTransaction(
          actor,
          personId,
          input,
          transaction,
        );
      return result.status === "archived" || result.status === "restored"
        ? DONE
        : failed(result.status);
    }, { workspaceId: actor.workspaceId });

  const tag = async (
    actor: PeopleActor,
    action: "tag" | "untag",
    personId: string,
    tagId: string,
  ): Promise<ItemResult> => {
    const page = await dependencies.profileFacts.list(actor, personId, "tags");
    if (page.status === "archived") return failed("archived-write-rejected");
    if (page.status !== "ready") return failed(page.status);
    const record = page.records.find((entry) => entry.section === "tags");
    const current = record ? (record.value as TagsFact).tagIds : [];
    const change = tagChange(action, current, tagId);
    if (change.status === "unchanged") return UNCHANGED;
    const value = { tagIds: change.tagIds };
    const saved = record
      ? await dependencies.profileFacts.update(actor, personId, "tags", {
        ...value,
        expectedPersonUpdatedAt: page.personUpdatedAt,
        expectedUpdatedAt: record.updatedAt,
        id: record.id,
      })
      : await dependencies.profileFacts.create(actor, personId, "tags", {
        ...value,
        expectedPersonUpdatedAt: page.personUpdatedAt,
      });
    return saved.status === "saved" ? DONE : failed(saved.status);
  };

  const item = (
    actor: PeopleActor,
    input: BulkPeopleInput,
    personId: string,
  ): Promise<ItemResult> =>
    input.action === "tag" || input.action === "untag"
      ? tag(actor, input.action, personId, input.tagId!)
      : transition(actor, input.action, personId);

  return {
    run: async (
      actor: PeopleActor,
      input: BulkPeopleInput,
    ): Promise<BulkPeopleResult> => {
      const errors = bulkInputErrors(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      // The standing check and the tag lookup share one read transaction.
      const refusal = await dependencies.transaction.run(
        async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: false,
            transaction,
          });
          if (standing === "revoked") return "forbidden" as const;
          if (
            input.tagId &&
            !await dependencies.tags.exists({
              tagId: input.tagId,
              transaction,
              workspaceId: actor.workspaceId,
            })
          ) return "tag-unavailable" as const;
          return undefined;
        },
        { workspaceId: actor.workspaceId },
      );
      if (refusal) return { status: refusal };
      const results: BulkItemResult[] = [];
      let skipping = false;
      for (const personId of input.personIds) {
        if (skipping) {
          results.push({ outcome: "skipped", personId });
          continue;
        }
        const result = await item(actor, input, personId).catch(() =>
          failed("unavailable")
        );
        if (result.code === "forbidden") skipping = true;
        results.push({ ...result, personId });
      }
      return {
        action: input.action,
        results,
        status: "ready",
        summary: bulkSummary(results),
      };
    },
  };
}

export type BulkPeopleActions = ReturnType<typeof createBulkPeopleActions>;
