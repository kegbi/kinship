/**
 * Creating, updating, and deleting one profile fact.
 *
 * All three writes share one order and one set of guards. The caller has to
 * name the person revision it composed against and, for an update, the fact
 * revision too; the value is normalized and validated before a transaction is
 * opened; the person context is locked and checked against that revision; the
 * section's vocabulary is re-read under lock so a reference retired mid-request
 * cannot be stored; and the row and its audit event are both read back before
 * the transaction may commit.
 *
 * Three sections hold at most one fact per person — where two people met, what
 * somebody will not eat, and their tags — so creating one uses the person's own
 * identifier as the fact identifier and a second create simply finds it taken.
 */

import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { isInstant } from "../../../shared-kernel/validation.ts";
import { normalizeProfileFact } from "../domain/profile_facts/normalize.ts";
import { validateProfileFact } from "../domain/profile_facts/validate.ts";
import type {
  FirstMeetingFact,
  ProfileFactRecord,
  ProfileFactSection,
  ProfileFactValue,
} from "../domain/profile_facts/values.ts";
import type { PeopleActor } from "../ports/context.ts";
import type { ProfileFactContextLock } from "../ports/profile_fact_repository.ts";
import {
  inspectConfiguration,
  profileFactContext,
  type ProfileFactDependencies,
} from "./profile_fact_context.ts";

/** The sections that hold at most one fact per person. */
const SINGLETON_SECTIONS: readonly ProfileFactSection[] = [
  "first-meeting",
  "food-preferences",
  "tags",
];

export type ProfileFactFailureResult =
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found",
    "hidden" | "invalid-reference" | "stale"
  >
  | ValidationFailure;

export type ProfileFactMutationResult =
  | ProfileFactFailureResult
  | {
    readonly personUpdatedAt: string;
    readonly record: ProfileFactRecord;
    readonly status: "saved";
  }
  | {
    readonly factId: string;
    readonly personUpdatedAt: string;
    readonly status: "deleted";
  };

export type ProfileFactCreateInput = ProfileFactValue & {
  readonly expectedPersonUpdatedAt: string;
};

export type ProfileFactUpdateInput = ProfileFactValue & {
  readonly expectedPersonUpdatedAt: string;
  readonly expectedUpdatedAt: string;
  readonly id: string;
};

function contextFailure(
  status: ProfileFactContextLock["status"],
): ProfileFactFailureResult {
  if (status === "archived") return { status: "archived-write-rejected" };
  return { status: status === "forbidden" ? "forbidden" : "not-found" };
}

export function createProfileFactWrites(dependencies: ProfileFactDependencies) {
  const mutate = async (
    actor: PeopleActor,
    personId: string,
    section: ProfileFactSection,
    input: ProfileFactCreateInput | ProfileFactUpdateInput,
    operation: "create" | "update",
  ): Promise<Exclude<ProfileFactMutationResult, { status: "deleted" }>> => {
    const { expectedPersonUpdatedAt, ...mutationInput } = input;
    const expectedUpdatedAt = "expectedUpdatedAt" in mutationInput
      ? mutationInput.expectedUpdatedAt
      : undefined;
    const id = "id" in mutationInput ? mutationInput.id : undefined;
    const { expectedUpdatedAt: _expected, id: _id, ...raw } = mutationInput as
      & ProfileFactValue
      & { readonly expectedUpdatedAt?: string; readonly id?: string };
    if (
      !isInstant(expectedPersonUpdatedAt) ||
      (operation === "update" &&
        (!id || !expectedUpdatedAt || !isInstant(expectedUpdatedAt)))
    ) {
      return {
        errors: {
          expectedPersonUpdatedAt: "Refresh this profile before saving.",
        },
        status: "validation-error",
      };
    }
    const value = normalizeProfileFact(section, raw as ProfileFactValue);
    const errors = validateProfileFact(section, value, personId);
    if (Object.keys(errors).length) {
      return { errors, status: "validation-error" };
    }
    return await dependencies.transaction.run(async (transaction) => {
      const context = await profileFactContext(
        dependencies,
        actor,
        personId,
        transaction,
        true,
      );
      if (context.status !== "ready") return contextFailure(context.status);
      if (context.personUpdatedAt !== expectedPersonUpdatedAt) {
        return { status: "stale" };
      }
      let targetId = dependencies.ids.create();
      if (operation === "create" && SINGLETON_SECTIONS.includes(section)) {
        const existing = await dependencies.repository.lockFact({
          ...actor,
          factId: personId,
          personId,
          section,
          transaction,
        });
        if (existing) return { status: "stale" };
        targetId = personId;
      } else if (operation === "update") {
        const target = await dependencies.repository.lockFact({
          ...actor,
          factId: id!,
          personId,
          section,
          transaction,
        });
        if (!target) return { status: "not-found" };
        if (target.updatedAt !== expectedUpdatedAt) return { status: "stale" };
        targetId = target.id;
      }
      const introducedByPersonId = section === "first-meeting"
        ? (value as FirstMeetingFact).introducedByPersonId
        : undefined;
      if (
        introducedByPersonId &&
        (!dependencies.repository.inspectPersonReference ||
          !await dependencies.repository.inspectPersonReference({
            ...actor,
            personId,
            referencedPersonId: introducedByPersonId,
            transaction,
          }))
      ) return { status: "invalid-reference" };
      const configuration = await inspectConfiguration(dependencies, {
        ...actor,
        lock: true,
        section,
        transaction,
        value,
      });
      if (configuration.status !== "ready") {
        return {
          status: configuration.status === "stale-cursor"
            ? "invalid-reference"
            : configuration.status,
        };
      }
      const occurredAt = dependencies.clock.now();
      const saved = await dependencies.repository.save({
        ...actor,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        id: targetId,
        occurredAt,
        personId,
        section,
        transaction,
        value,
      });
      if (!saved) return { status: "stale" };
      const { personUpdatedAt, record } = saved;
      const auditCommand = {
        action: "save" as const,
        actor,
        after: record,
        occurredAt,
        personId,
        transaction,
      };
      const auditId = await dependencies.audit.record(auditCommand);
      await dependencies.repository.assertPostcondition({
        action: "save",
        ...actor,
        after: record,
        personId,
        transaction,
      });
      await dependencies.audit.assertPostcondition({
        ...auditCommand,
        auditId,
      });
      return { personUpdatedAt, record, status: "saved" };
    });
  };

  return {
    create: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      input: ProfileFactCreateInput,
    ) => mutate(actor, personId, section, input, "create"),
    update: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      input: ProfileFactUpdateInput,
    ) => mutate(actor, personId, section, input, "update"),
    delete: (
      actor: PeopleActor,
      personId: string,
      section: ProfileFactSection,
      factId: string,
      expectedUpdatedAt: string,
      expectedPersonUpdatedAt: string,
    ): Promise<Exclude<ProfileFactMutationResult, { status: "saved" }>> =>
      dependencies.transaction.run(async (transaction) => {
        const context = await profileFactContext(
          dependencies,
          actor,
          personId,
          transaction,
          true,
        );
        if (context.status !== "ready") return contextFailure(context.status);
        if (context.personUpdatedAt !== expectedPersonUpdatedAt) {
          return { status: "stale" };
        }
        const configuration = await inspectConfiguration(dependencies, {
          ...actor,
          lock: true,
          section,
          transaction,
        });
        if (configuration.status !== "ready") {
          return {
            status: configuration.status === "stale-cursor"
              ? "invalid-reference"
              : configuration.status,
          };
        }
        const occurredAt = dependencies.clock.now();
        const deleted = await dependencies.repository.delete({
          ...actor,
          expectedUpdatedAt,
          factId,
          occurredAt,
          personId,
          section,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        const { before, personUpdatedAt } = deleted;
        const auditCommand = {
          action: "delete" as const,
          actor,
          before,
          occurredAt,
          personId,
          transaction,
        };
        const auditId = await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertPostcondition({
          action: "delete",
          ...actor,
          before,
          personId,
          transaction,
        });
        await dependencies.audit.assertPostcondition({
          ...auditCommand,
          auditId,
        });
        return { factId, personUpdatedAt, status: "deleted" };
      }),
  };
}
