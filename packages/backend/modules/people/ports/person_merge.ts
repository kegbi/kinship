/**
 * How a person merge reaches every record that points at a person (GAP-049).
 *
 * Almost every module keeps rows that name a person, and people depends on
 * none of them — they depend on people. So people declares the one port a
 * merge needs from each of them, `PersonMergeParticipant`, and the API
 * composition root registers one participant per owning module, the way the
 * workspace-cascade impact map is assembled. A participant rewrites only its
 * own module's tables, inside the one people transaction the merge runs in,
 * and reports what it did, so the merge can prove before it commits that
 * nothing still points at the duplicate.
 *
 * A reference is named `crm.<table>.<column>`, the foreign key (or, for the
 * import identity map, the text key) it rewrites. `references` lists every
 * reference the participant owns, so a guard can compare the registered
 * participants with the foreign keys the canonical schema really has.
 *
 * `PersonMergeRepository` is the people module's own half: the pair locked,
 * the primary's identity filled in, people's own tables relinked, and the
 * duplicate deleted.
 */

import type {
  MergeCandidate,
  MergeConflict,
  MergedIdentity,
  PersonMergeFacts,
  ReferenceCounts,
  ReferenceOutcome,
} from "../domain/merge_rules.ts";
import type { PeopleTransaction } from "./context.ts";

/** The two people a merge is about, in the transaction it runs in. */
export interface PersonMergePairScope {
  readonly duplicateId: string;
  readonly primaryId: string;
  readonly transaction: PeopleTransaction;
  readonly workspaceId: string;
}

/** The two people being merged, when, and by which member. */
export interface PersonMergeCommand extends PersonMergePairScope {
  /** The acting member, whose time zone a recomputed due date is read in. */
  readonly memberId: string;
  readonly occurredAt: Date;
}

/**
 * What a participant says about a pair before anything moves: the
 * single-valued facts of its own that only the primary keeps, and whether it
 * refuses the merge outright.
 */
export interface PersonMergeInspection {
  /** Both people represent a workspace member, and one of them would stop. */
  readonly blocked?: "both-members";
  readonly conflicts?: readonly MergeConflict[];
}

/** One module's rows that name a person. */
export interface PersonMergeParticipant {
  /** The module that owns the references, for the audit payload. */
  readonly module: string;
  /** Every `crm.<table>.<column>` this participant rewrites. */
  readonly references: readonly string[];
  /** How many rows name the person, per reference. */
  countReferences(command: {
    readonly personId: string;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<ReferenceCounts>;
  /**
   * Points every row that names the duplicate at the primary, removing the
   * rows that would then collide with one the primary already has.
   */
  relinkPerson(command: PersonMergeCommand): Promise<ReferenceOutcome>;
  /** Looks at the pair before a preview or a merge; answers nothing when it has no say. */
  inspect?(scope: PersonMergePairScope): Promise<PersonMergeInspection>;
}

/** The pair as it was locked: either may be absent from the workspace. */
export interface LockedMergePair {
  readonly duplicate?: MergeCandidate;
  readonly primary?: MergeCandidate;
}

export interface PersonMergeRepository {
  /**
   * Reads both people within the workspace; a merge locks them, in
   * identifier order, and a preview only reads.
   */
  lockPair(
    command: PersonMergePairScope & {
      readonly forUpdate: boolean;
    },
  ): Promise<LockedMergePair>;
  /** The single-valued facts a person has now: dates, first meeting, avatar. */
  listFacts(command: {
    readonly personId: string;
    readonly transaction: PeopleTransaction;
  }): Promise<PersonMergeFacts>;
  /** People's own tables, as a participant sees them. */
  readonly ownTables: Omit<PersonMergeParticipant, "relinkPerson"> & {
    relinkPerson(
      command: PersonMergeCommand & {
        /** The duplicate's dates the primary already has one of. */
        readonly removedDateIds: readonly string[];
      },
    ): Promise<ReferenceOutcome>;
  };
  /** Writes the primary's merged identity and returns it re-read. */
  applyIdentity(command: {
    readonly identity: MergedIdentity;
    readonly occurredAt: Date;
    readonly primaryId: string;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<MergeCandidate>;
  /** Deletes the duplicate the way a person delete does. */
  removeDuplicate(command: {
    readonly duplicateId: string;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<boolean>;
}
