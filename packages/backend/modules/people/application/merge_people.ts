/**
 * Merging two people into one (GAP-049, PEOPLE-008).
 *
 * `merge(actor, primaryId, { duplicateId })` keeps the primary and folds the
 * duplicate into it, in one people transaction:
 *
 * 1. revalidate the actor under lock, then lock both people and decide
 *    (`domain/merge_rules.ts`) whether the merge may happen at all;
 * 2. count, per reference, every row anywhere that names the duplicate;
 * 3. let each registered participant relink its own module's rows, in the
 *    order the composition root registered them, then relink people's own
 *    tables last — a date that is dropped is retired through planning first,
 *    and a date that moves has its reminder regenerated for the primary
 *    afterwards, exactly as editing the date would;
 * 4. fill the primary's empty identity fields from the duplicate and delete
 *    the duplicate the way a person delete does (`deleted_at`);
 * 5. count again, and throw — rolling everything back — unless every
 *    reference counted before was relinked or removed and none remains;
 * 6. audit `people.person-merged` with the per-table counts and read it back.
 *
 * Once the merge has committed, the duplicate's avatar image the primary does
 * not use is discarded through the files facade, as an avatar replacement
 * discards the image it replaced (REL-063). The object store is outside the
 * transaction, so this is best effort: a discard that fails leaves the image
 * as it was, is recorded as a `file.cleanup` log line (REL-083), and never
 * undoes the merge.
 *
 * There is no undo. The duplicate's rows now belong to the primary and cannot
 * be told apart from the primary's own, which is why the flow and the
 * confirmation both say so.
 *
 * ## Foreign-key inventory (canonical schema v10)
 *
 * Every column that references the people table, its owner, and its rule. The
 * `person_merge_postgres_test.ts` guard reads `pg_constraint` and fails when a
 * foreign key appears that no registered participant names.
 *
 * | Reference                                        | Owner         | Merge rule                                                                 |
 * | ------------------------------------------------ | ------------- | -------------------------------------------------------------------------- |
 * | `person_avatars.person_id`                       | people        | keep the primary's; take the duplicate's only over a default avatar        |
 * | `person_dates.person_id`                         | people        | relink; a birthday, death, or first-met date the primary has is dropped    |
 * | `person_first_meetings.person_id`                | people        | keep the primary's; take the duplicate's when the primary has none         |
 * | `person_first_meetings.introduced_by_person_id`  | people        | relink; cleared where it would name the person themselves                  |
 * | `person_contact_methods.person_id`               | people        | relink; exact duplicates (type and value) dropped                          |
 * | `person_addresses.person_id`                     | people        | relink; exact duplicates (name and place) dropped                          |
 * | `person_occupations.person_id`                   | people        | relink                                                                     |
 * | `person_tags.person_id`                          | people        | relink; a tag the primary has is dropped                                   |
 * | `pets.person_id`                                 | people        | relink                                                                     |
 * | `person_duplicate_dismissals.person_low_id`      | people        | rewrite in pair order; the merged pair and a pair the primary has dropped  |
 * | `person_duplicate_dismissals.person_high_id`     | people        | as `person_low_id`                                                         |
 * | `person_file_links.person_id`                    | files         | relink; a file already linked to the primary the same way is dropped       |
 * | `activity_participants.person_id`                | interactions  | relink; an activity the primary is already in is dropped                   |
 * | `calls.person_id`                                | interactions  | relink                                                                     |
 * | `conversation_threads.person_id`                 | interactions  | relink                                                                     |
 * | `notes.person_id`                                | interactions  | relink                                                                     |
 * | `life_events.person_id`                          | journal       | relink                                                                     |
 * | `tasks.person_id`                                | planning      | relink                                                                     |
 * | `reminders.person_id`                            | planning      | relink (occurrences follow their reminder)                                 |
 * | `stay_in_touch_cadences.person_id`               | planning      | keep the primary's interval; a later last contact moves its due date       |
 * | `relationships.from_person_id`                   | relationships | drop edges between the pair; drop one the primary has; else relink         |
 * | `relationships.to_person_id`                     | relationships | as `from_person_id`                                                        |
 * | `gifts.person_id`                                | gifts         | relink                                                                     |
 * | `gifts.recipient_person_id`                      | gifts         | relink                                                                     |
 * | `debts.person_id`                                | gifts         | relink                                                                     |
 * | `recurring_debts.person_id`                      | gifts         | relink                                                                     |
 * | `dav_objects.person_id`                          | integrations  | relink                                                                     |
 * | `audit_events.person_id`                         | governance    | relink, so the history stays on the surviving person; rows are not edited  |
 * | `workspace_members.self_person_id`               | workspaces    | relink; refused (409) when both people represent members                   |
 * | `data_import_entities.target_key` (people)       | import-export | relink (a text key, not a foreign key), so a re-import finds the primary   |
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  fileCleanupFailed,
  type Logger,
} from "../../../shared-kernel/telemetry.ts";
import {
  conflictsDigest,
  datePlan,
  type MergeCandidate,
  type MergeConflict,
  mergeDecision,
  mergedIdentity,
  type MergePeopleInput,
  type MergeRevisions,
  peopleConflicts,
  type PersonMergeFacts,
  reconcileReferences,
  type ReferenceCounts,
  type ReferenceOutcome,
  unusedAvatarFile,
} from "../domain/merge_rules.ts";
import type { PersonMergeAudit } from "../ports/audit.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  PeopleTransactionRunner,
} from "../ports/context.ts";
import type { PersonAvatarImages } from "../ports/avatar.ts";
import type { ImportantDatePublisher } from "../ports/important_date_repository.ts";
import type {
  PersonMergeParticipant,
  PersonMergeRepository,
} from "../ports/person_merge.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PersonMergeDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: PersonMergeAudit;
  readonly clock: Clock;
  /** The files facade's discard, for the duplicate's image nobody draws. */
  readonly images: Pick<PersonAvatarImages, "discard">;
  /** Where a discard that could not complete is recorded (REL-083). */
  readonly logger: Logger;
  /** Every other module's rows that name a person, in relink order. */
  readonly participants: readonly PersonMergeParticipant[];
  /** Planning's side of a date that moves or is dropped. */
  readonly publisher: ImportantDatePublisher;
  readonly repository: PersonMergeRepository;
  readonly transaction: PeopleTransactionRunner;
}

type PairFailure =
  | Failure<"archived-write-rejected" | "forbidden" | "not-found", "stale">
  | { readonly status: "both-members" }
  | { readonly status: "self-merge" };

export type MergePeopleResult =
  | PairFailure
  /** What the merge would discard is not what the confirmation showed. */
  | { readonly status: "conflicts-changed" }
  | {
    readonly duplicateId: string;
    /** How many rows now name the primary instead of the duplicate. */
    readonly moved: number;
    readonly person: MergeCandidate;
    readonly status: "merged";
  };

/** What merging the pair would do, read without changing anything. */
export type PreviewPeopleMergeResult =
  | PairFailure
  | {
    /** Every fact only the primary keeps, with what is discarded. */
    readonly conflicts: readonly MergeConflict[];
    /** `conflictsDigest(conflicts)`, which the merge is confirmed against. */
    readonly conflictsDigest: string;
    readonly duplicate: MergeCandidate;
    /** How many rows name the duplicate and would name the primary. */
    readonly moves: number;
    readonly primary: MergeCandidate;
    readonly status: "ready";
  };

function sum(counts: readonly ReferenceCounts[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const entry of counts) {
    for (const [name, value] of Object.entries(entry)) {
      total[name] = (total[name] ?? 0) + value;
    }
  }
  return total;
}

function total(counts: ReferenceCounts): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

export function createPersonMerge(dependencies: PersonMergeDependencies) {
  const own = dependencies.repository.ownTables;
  const everyone = [...dependencies.participants, own];

  const count = async (
    personId: string,
    transaction: PeopleTransaction,
    workspaceId: string,
  ): Promise<Record<string, number>> => {
    const counts: ReferenceCounts[] = [];
    for (const participant of everyone) {
      counts.push(
        await participant.countReferences({
          personId,
          transaction,
          workspaceId,
        }),
      );
    }
    return sum(counts);
  };

  /**
   * The decision a preview and a merge share: the actor, the pair, the
   * revisions, every participant's say, and every fact only the primary
   * keeps. A merge locks the pair; a preview only reads it.
   */
  const inspectPair = async (
    actor: PeopleActor,
    primaryId: string,
    duplicateId: string,
    revisions: MergeRevisions,
    transaction: PeopleTransaction,
    forUpdate: boolean,
  ): Promise<
    | PairFailure
    | {
      readonly conflicts: readonly MergeConflict[];
      readonly duplicate: MergeCandidate;
      readonly duplicateFacts: PersonMergeFacts;
      readonly primary: MergeCandidate;
      readonly primaryFacts: PersonMergeFacts;
      readonly status: "proceed";
    }
  > => {
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: forUpdate,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
    const workspaceId = actor.workspaceId;
    const scope = { duplicateId, primaryId, transaction, workspaceId };
    const pair = await dependencies.repository.lockPair({
      ...scope,
      forUpdate,
    });
    const decision = mergeDecision(pair.primary, pair.duplicate, revisions);
    if (decision.status !== "proceed") return decision;
    const inspections = [];
    for (const participant of dependencies.participants) {
      if (participant.inspect) {
        inspections.push(await participant.inspect(scope));
      }
    }
    if (inspections.some((entry) => entry.blocked === "both-members")) {
      return { status: "both-members" };
    }
    const primaryFacts = await dependencies.repository.listFacts({
      personId: primaryId,
      transaction,
    });
    const duplicateFacts = await dependencies.repository.listFacts({
      personId: duplicateId,
      transaction,
    });
    return {
      conflicts: [
        ...peopleConflicts(primaryFacts, duplicateFacts),
        ...inspections.flatMap((entry) => entry.conflicts ?? []),
      ],
      duplicate: pair.duplicate!,
      duplicateFacts,
      primary: pair.primary!,
      primaryFacts,
      status: "proceed",
    };
  };

  const mergeInTransaction = async (
    actor: PeopleActor,
    primaryId: string,
    input: MergePeopleInput,
    transaction: PeopleTransaction,
  ): Promise<
    MergePeopleResult | {
      readonly merged: Extract<MergePeopleResult, { status: "merged" }>;
      /** The duplicate's image to discard once the merge commits. */
      readonly unusedAvatar?: string;
      readonly status: "committing";
    }
  > => {
    const { duplicateId } = input;
    const inspected = await inspectPair(
      actor,
      primaryId,
      duplicateId,
      input,
      transaction,
      true,
    );
    if (inspected.status !== "proceed") return inspected;
    // Dates, photos, and cadences change without moving either revision, so
    // the list the member confirmed is checked against the locked pair.
    if (
      await conflictsDigest(inspected.conflicts) !== input.conflictsDigest
    ) {
      return { status: "conflicts-changed" };
    }
    const { primary, duplicate } = inspected;
    const workspaceId = actor.workspaceId;
    const occurredAt = dependencies.clock.now();
    const command = {
      duplicateId,
      memberId: actor.memberId,
      occurredAt,
      primaryId,
      transaction,
      workspaceId,
    };

    const before = await count(duplicateId, transaction, workspaceId);
    const dates = datePlan(
      inspected.primaryFacts.dates,
      inspected.duplicateFacts.dates,
    );
    const outcomes: ReferenceOutcome[] = [];
    for (const participant of dependencies.participants) {
      outcomes.push(await participant.relinkPerson(command));
    }
    for (const retired of dates.remove) {
      await dependencies.publisher.regenerate({
        ...actor,
        before: retired,
        occurredAt,
        transaction,
      });
    }
    outcomes.push(
      await own.relinkPerson({
        ...command,
        removedDateIds: dates.remove.map((entry) => entry.id),
      }),
    );
    // A moved date keeps its reminder as the member left it, paused or not.
    for (const moved of dates.relink) {
      await dependencies.publisher.regenerate({
        ...actor,
        after: { ...moved, personId: primaryId },
        before: moved,
        keepActive: true,
        occurredAt,
        transaction,
      });
    }
    const person = await dependencies.repository.applyIdentity({
      identity: mergedIdentity(primary, duplicate),
      occurredAt,
      primaryId,
      transaction,
      workspaceId,
    });
    const removed = await dependencies.repository.removeDuplicate({
      duplicateId,
      occurredAt,
      transaction,
      workspaceId,
    });
    if (!removed || person.lifecycle !== "active") {
      throw new Error("Person merge postcondition failed: the pair changed.");
    }

    const outcome = {
      relinked: sum(outcomes.map((entry) => entry.relinked)),
      removed: sum(outcomes.map((entry) => entry.removed)),
    };
    const after = await count(duplicateId, transaction, workspaceId);
    const problems = reconcileReferences(before, outcome, after);
    if (problems.length > 0) {
      throw new Error(
        `Person merge postcondition failed: ${problems.join("; ")}`,
      );
    }

    const tables: Record<string, { relinked: number; removed: number }> = {};
    for (const name of Object.keys(before).sort()) {
      const relinked = outcome.relinked[name] ?? 0;
      const dropped = outcome.removed[name] ?? 0;
      if (relinked + dropped > 0) {
        tables[name] = { relinked, removed: dropped };
      }
    }
    const auditCommand = {
      actor,
      discarded: inspected.conflicts.map((conflict) => ({
        fact: conflict.fact,
        ...conflict.snapshot,
      })),
      duplicateId,
      occurredAt,
      primaryId,
      tables,
      transaction,
    };
    const auditId = await dependencies.audit.record(auditCommand);
    await dependencies.audit.assertPostcondition({ ...auditCommand, auditId });
    const unusedAvatar = unusedAvatarFile(
      inspected.primaryFacts,
      inspected.duplicateFacts,
    );
    return {
      merged: {
        duplicateId,
        moved: total(outcome.relinked),
        person,
        status: "merged",
      },
      ...(unusedAvatar ? { unusedAvatar } : {}),
      status: "committing",
    };
  };

  return {
    merge: async (
      actor: PeopleActor,
      primaryId: string,
      input: MergePeopleInput,
    ): Promise<MergePeopleResult> => {
      if (primaryId === input.duplicateId) return { status: "self-merge" };
      const result = await dependencies.transaction.run((transaction) =>
        mergeInTransaction(actor, primaryId, input, transaction)
      );
      if (result.status !== "committing") return result;
      if (result.unusedAvatar) {
        const discarded = await dependencies.images.discard({
          actor,
          fileId: result.unusedAvatar,
          personId: primaryId,
        }).catch(() => ({ status: "unavailable" as const }));
        if (discarded.status !== "discarded") {
          dependencies.logger.log(
            fileCleanupFailed("merge-duplicate-avatar", actor),
          );
        }
      }
      return result.merged;
    },
    /**
     * What the merge would keep, discard, and move, from the same decision
     * the merge takes, and the revisions it would be confirmed against.
     */
    preview: (
      actor: PeopleActor,
      primaryId: string,
      duplicateId: string,
    ): Promise<PreviewPeopleMergeResult> => {
      if (primaryId === duplicateId) {
        return Promise.resolve({ status: "self-merge" });
      }
      return dependencies.transaction.run(async (transaction) => {
        const inspected = await inspectPair(
          actor,
          primaryId,
          duplicateId,
          {},
          transaction,
          false,
        );
        if (inspected.status !== "proceed") return inspected;
        return {
          conflicts: inspected.conflicts,
          conflictsDigest: await conflictsDigest(inspected.conflicts),
          duplicate: inspected.duplicate,
          moves: total(
            await count(duplicateId, transaction, actor.workspaceId),
          ),
          primary: inspected.primary,
          status: "ready",
        };
      });
    },
  };
}

export type PersonMerge = ReturnType<typeof createPersonMerge>;
