/**
 * The personalization use case.
 *
 * Two methods, and almost all of what they do is guard the mutation before it
 * reaches a section that would apply it. The role check is first, the
 * section's own rules are next in `domain/personalization_rules.ts`, and only
 * a mutation that survives both opens a transaction.
 *
 * The delete path is the one with a step in it. Deleting an entry nothing
 * refers to is a delete; deleting one that is still in use needs somewhere for
 * those references to go, so a delete with no replacement inspects first and
 * answers `replacement-required` with the count — which is what lets the page
 * ask the question rather than refuse. The inspection happens inside the same
 * transaction as the delete, so the count cannot go stale between them.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  isSection,
  normalizedMutation,
  type PersonalizationMutation,
  type PersonalizationMutationResult,
  type PersonalizationSection,
} from "../domain/personalization_rules.ts";
import { privileged } from "../domain/roles.ts";
import type {
  PersonalizationTransactionRunner,
  SettingsActor,
} from "../ports/context.ts";
import type { PersonalizationRepository } from "../ports/personalization_repository.ts";
import type { SettingsAudit } from "../ports/settings_repository.ts";

export interface PersonalizationDependencies {
  readonly audit: SettingsAudit;
  readonly clock: Clock;
  readonly repository: PersonalizationRepository;
  readonly transaction: PersonalizationTransactionRunner;
}

export function createPersonalizationManagement(
  dependencies: PersonalizationDependencies,
) {
  return {
    isSection,
    list(actor: SettingsActor, section: PersonalizationSection) {
      if (!privileged(actor)) {
        return Promise.resolve({ status: "forbidden" as const });
      }
      return dependencies.transaction.run((transaction) =>
        dependencies.repository.list({ ...actor, section, transaction })
      );
    },
    mutate(
      actor: SettingsActor,
      section: PersonalizationSection,
      input: PersonalizationMutation,
    ): Promise<PersonalizationMutationResult> {
      if (!privileged(actor)) {
        return Promise.resolve({ status: "forbidden" });
      }
      const normalized = normalizedMutation(section, input);
      if (!normalized) return Promise.resolve({ status: "invalid" });
      return dependencies.transaction.run(async (transaction) => {
        if (
          normalized.action === "delete" && !normalized.replacementId
        ) {
          const preview = await dependencies.repository.inspect({
            ...actor,
            id: normalized.id,
            section,
            transaction,
          });
          if (preview.status !== "ready") return preview;
          if (!preview.entry.canDelete) return { status: "required-default" };
          if (preview.entry.referenceCount > 0) {
            return {
              referenceCount: preview.entry.referenceCount,
              status: "replacement-required",
            };
          }
        }
        const result = await dependencies.repository.mutate({
          ...actor,
          ...normalized,
          section,
          transaction,
        });
        if (result.status !== "saved" && result.status !== "deleted") {
          return result;
        }
        await dependencies.audit.record({
          action: "workspace-personalization-updated",
          actor,
          occurredAt: dependencies.clock.now(),
          payload: { action: normalized.action, section },
          subjectId: actor.workspaceId,
          subjectType: "workspace",
          transaction,
        });
        return result;
      });
    },
  };
}

export type PersonalizationManagement = ReturnType<
  typeof createPersonalizationManagement
>;
