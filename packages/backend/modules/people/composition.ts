/**
 * People composition.
 *
 * Only a declared composition root imports this file. Besides the person use
 * cases (identity, dates, lifecycle, profile facts, and the avatar) it
 * returns the outbound ports other modules know people by — the person
 * boundary relationships, interactions, and planning read through, the
 * personalization reference counters, and the import and export boundaries.
 *
 * `peopleTransactionRunner` is separate because the transaction it builds is
 * part of the shared composition context every module receives, so a root must
 * be able to build it before it composes anything.
 */

import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../platform/postgres/database.ts";
import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPeopleExportBoundary } from "./adapters/postgres/export_people_boundary.ts";
import { PostgresPeopleImportBoundary } from "./adapters/postgres/import_people_boundary.ts";
import { PostgresImportantDateRepository } from "./adapters/postgres/important_date_repository.ts";
import {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "./adapters/postgres/people_repository.ts";
import { PostgresPeoplePersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresPersonAvatarRepository } from "./adapters/postgres/person_avatar_repository.ts";
import { PostgresPersonLifecycleRepository } from "./adapters/postgres/person_lifecycle_repository.ts";
import { PostgresPersonMergeRepository } from "./adapters/postgres/person_merge_repository.ts";
import { PostgresProfileFactOrganizations } from "./adapters/postgres/profile_fact_organizations.ts";
import { PostgresProfileFactRepository } from "./adapters/postgres/profile_fact_repository.ts";
import { PostgresRelationshipPersonBoundary } from "./adapters/postgres/relationship_person_boundary.ts";
import { PostgresTagPersonalization } from "./adapters/postgres/tag_personalization.ts";
import { PostgresPeopleWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createImportantDateManagement,
  createPeopleManagement,
  createPersonAvatarManagement,
  createPersonLifecycle,
  createPersonMerge,
  createProfileFactManagement,
  importantDateAuditFrom,
  type ImportantDatePublisher,
  personAvatarAuditFrom,
  type PersonAvatarImages,
  personCreatedAuditFrom,
  type PersonGenderOptions,
  personLifecycleAuditFrom,
  personMergeAuditFrom,
  type PersonMergeParticipant,
  profileFactAuditFrom,
  type ProfileFactWorkspaceBoundary,
} from "./public.ts";

/** The people-owned transaction the person-scoped modules all share. */
export function peopleTransactionRunner(
  database: Kysely<ApplicationDatabase>,
): PostgresPeopleTransaction {
  return new PostgresPeopleTransaction(database);
}

/**
 * The person boundary every neighbouring module reads a person through. It
 * takes no dependency of its own, so a root can build it before the modules
 * that consume it.
 */
export function personBoundary(): PostgresRelationshipPersonBoundary {
  return new PostgresRelationshipPersonBoundary();
}

export interface PeoplePorts {
  /** The files module's avatar uploads, which the avatar is stored with. */
  readonly avatarImages: PersonAvatarImages;
  /** The workspace gender vocabulary an edited identity refers to. */
  readonly genderOptions: PersonGenderOptions;
  /** Planning's publisher for the reminders a person's dates imply. */
  readonly importantDatePublisher: ImportantDatePublisher;
  /**
   * Every other module's rows that name a person, relinked in this order when
   * two people are merged (GAP-049).
   */
  readonly mergeParticipants: readonly PersonMergeParticipant[];
  /** The workspace vocabulary a profile fact is validated against. */
  readonly profileFactWorkspace: ProfileFactWorkspaceBoundary;
}

export function composePeople(shared: SharedComposition, ports: PeoplePorts) {
  const people = createPeopleManagement({
    actors: shared.actors,
    audit: personCreatedAuditFrom(shared.audit),
    clock: shared.clock,
    ids: shared.ids,
    repository: new PostgresPeopleRepository(),
    transaction: shared.peopleTransaction,
  });
  return {
    avatars: createPersonAvatarManagement({
      actors: shared.actors,
      audit: personAvatarAuditFrom(shared.audit),
      clock: shared.clock,
      images: ports.avatarImages,
      repository: new PostgresPersonAvatarRepository(),
      transaction: shared.peopleTransaction,
    }),
    exportBoundary: new PostgresPeopleExportBoundary(),
    importBoundary: new PostgresPeopleImportBoundary(
      ports.importantDatePublisher,
    ),
    importantDates: createImportantDateManagement({
      actors: shared.actors,
      audit: importantDateAuditFrom(shared.audit),
      clock: shared.clock,
      ids: shared.ids,
      publisher: ports.importantDatePublisher,
      repository: new PostgresImportantDateRepository(),
      transaction: shared.peopleTransaction,
    }),
    lifecycle: createPersonLifecycle({
      actors: shared.actors,
      audit: personLifecycleAuditFrom(shared.audit),
      clock: shared.clock,
      genders: ports.genderOptions,
      repository: new PostgresPersonLifecycleRepository(),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresPeopleWorkspaceLifecycleImpact,
    merge: createPersonMerge({
      actors: shared.actors,
      audit: personMergeAuditFrom(shared.audit),
      clock: shared.clock,
      participants: ports.mergeParticipants,
      publisher: ports.importantDatePublisher,
      repository: new PostgresPersonMergeRepository(),
      transaction: shared.peopleTransaction,
    }),
    people,
    personalizationReferences: PostgresPeoplePersonalizationReferences,
    profileFacts: createProfileFactManagement({
      actors: shared.actors,
      audit: profileFactAuditFrom(shared.audit),
      clock: shared.clock,
      ids: shared.ids,
      organizations: new PostgresProfileFactOrganizations(),
      repository: new PostgresProfileFactRepository(),
      transaction: shared.peopleTransaction,
      workspace: ports.profileFactWorkspace,
    }),
    tagPersonalization: new PostgresTagPersonalization(),
  };
}
