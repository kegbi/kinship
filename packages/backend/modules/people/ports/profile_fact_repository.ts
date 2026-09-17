/**
 * How the module stores profile facts, and where their vocabulary comes from.
 *
 * Three ports meet here. The repository reads and writes the facts and the
 * person context they hang off, locking that context for a write and merely
 * inspecting it for a read. The workspace boundary answers whether the section
 * is even enabled and which vocabulary entries the workspace publishes, and
 * the organization boundary answers the same question for the one section
 * whose vocabulary the people module owns.
 *
 * Both boundaries take the identical command, so the use case can ask the
 * second one whatever the first one was asked, and the optional members of the
 * repository are the reads an adapter may not be able to answer — a fake in a
 * unit test simply leaves them out.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  ProfileFactOptionAnchor,
  ProfileFactPageAnchor,
} from "../domain/profile_facts/cursors.ts";
import type {
  ProfileFactOption,
  ProfileFactRecord,
  ProfileFactSection,
  ProfileFactValue,
} from "../domain/profile_facts/values.ts";
import type { PeopleActor, PeopleTransaction } from "./context.ts";

/** What one page of a section's vocabulary looks like. */
export interface ProfileFactWorkspaceInspection {
  readonly hasMore?: boolean;
  readonly nextOptionAnchor?: ProfileFactOptionAnchor;
  readonly options: readonly ProfileFactOption[];
  readonly status: "hidden" | "invalid-reference" | "ready" | "stale-cursor";
}

/** Everything a vocabulary boundary needs to answer one question. */
export type ProfileFactInspectionCommand = PeopleActor & {
  readonly includeOptions?: boolean;
  readonly section: ProfileFactSection;
  readonly lock?: boolean;
  readonly optionAfter?: ProfileFactOptionAnchor;
  readonly optionLimit?: number;
  readonly optionSearch?: string;
  readonly selectedOptionIds?: readonly string[];
  readonly selectedOnly?: boolean;
  readonly transaction: PeopleTransaction;
  readonly value?: ProfileFactValue;
};

/** The workspace vocabulary a fact is validated against. */
export interface ProfileFactWorkspaceBoundary {
  inspect(
    command: ProfileFactInspectionCommand,
  ): Promise<ProfileFactWorkspaceInspection>;
}

/** The organization vocabulary the work section is validated against. */
export interface ProfileFactOrganizationBoundary {
  inspect(
    command: ProfileFactInspectionCommand,
  ): Promise<ProfileFactWorkspaceInspection>;
}

/** The person a fact hangs off, with the revision a caller must match. */
export type ProfileFactContextLock =
  | Failure<"forbidden" | "not-found">
  | {
    readonly personUpdatedAt: string;
    readonly status: "archived" | "ready";
  };

export interface ProfileFactRepository {
  inspectContext(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactContextLock>;
  inspectPersonReference?(
    command: PeopleActor & {
      readonly personId: string;
      readonly referencedPersonId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<boolean>;
  lockContext(
    command: PeopleActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactContextLock>;
  inspectPageAnchor?(
    command: PeopleActor & {
      readonly after: ProfileFactPageAnchor;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<boolean>;
  list(
    command: PeopleActor & {
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
      readonly after?: ProfileFactPageAnchor;
      readonly factId?: string;
      readonly limit?: number;
    },
  ): Promise<readonly ProfileFactRecord[]>;
  listTagDescriptors?(
    command: PeopleActor & {
      readonly tagIds: readonly string[];
      readonly transaction: PeopleTransaction;
    },
  ): Promise<readonly ProfileFactOption[]>;
  lockFact(
    command: PeopleActor & {
      readonly factId: string;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<ProfileFactRecord | undefined>;
  save(
    command: PeopleActor & {
      readonly expectedUpdatedAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
      readonly value: ProfileFactValue;
    },
  ): Promise<
    {
      readonly personUpdatedAt: string;
      readonly record: ProfileFactRecord;
    } | undefined
  >;
  delete(
    command: PeopleActor & {
      readonly expectedUpdatedAt: string;
      readonly factId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly section: ProfileFactSection;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    {
      readonly before: ProfileFactRecord;
      readonly personUpdatedAt: string;
    } | undefined
  >;
  assertPostcondition(
    command: PeopleActor & {
      readonly action: "delete" | "save";
      readonly after?: ProfileFactRecord;
      readonly before?: ProfileFactRecord;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}
