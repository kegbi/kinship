/**
 * People composition.
 *
 * Only a declared composition root imports this file. Besides the person use
 * cases (identity, dates, lifecycle, profile facts, the avatar, bulk
 * actions, the star, and dismissing a false duplicate pair) it
 * returns the outbound ports other modules know people by — the person
 * boundary relationships, interactions, and planning read through, the
 * personalization reference counters, and the import and export boundaries.
 *
 * `peopleTransactionRunner` is separate because the transaction it builds is
 * part of the shared composition context every module receives, so a root must
 * be able to build it before it composes anything.
 */

import type { ContactMethodTypeCatalog } from "../workspaces/public.ts";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../platform/postgres/database.ts";
import type { SharedComposition } from "../../platform/composition.ts";
import { type Logger, silentLogger } from "../../shared-kernel/telemetry.ts";
import { PostgresBulkTagLookup } from "./adapters/postgres/bulk_tag_lookup.ts";
import { PostgresPeopleExportBoundary } from "./adapters/postgres/export_people_boundary.ts";
import { PostgresPeopleImportBoundary } from "./adapters/postgres/import_people_boundary.ts";
import { PostgresImportantDateRepository } from "./adapters/postgres/important_date_repository.ts";
import {
  PostgresPeopleRepository,
  PostgresPeopleTransaction,
} from "./adapters/postgres/people_repository.ts";
import { PostgresPersonDuplicateDismissalRepository } from "./adapters/postgres/person_duplicate_dismissal_repository.ts";
import { PostgresPeoplePersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresPersonAvatarRepository } from "./adapters/postgres/person_avatar_repository.ts";
import { PostgresPersonLifecycleRepository } from "./adapters/postgres/person_lifecycle_repository.ts";
import { PostgresPersonMergeRepository } from "./adapters/postgres/person_merge_repository.ts";
import { PostgresPersonStarRepository } from "./adapters/postgres/person_star_repository.ts";
import { PostgresProfileFactOrganizations } from "./adapters/postgres/profile_fact_organizations.ts";
import { PostgresProfileFactRepository } from "./adapters/postgres/profile_fact_repository.ts";
import { PostgresRelationshipPersonBoundary } from "./adapters/postgres/relationship_person_boundary.ts";
import { PostgresTagPersonalization } from "./adapters/postgres/tag_personalization.ts";
import { PostgresPeopleWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createBulkPeopleActions,
  createImportantDateManagement,
  createPeopleManagement,
  createPersonAvatarManagement,
  createPersonDuplicateDismissals,
  createPersonLifecycle,
  createPersonMerge,
  createPersonStarManagement,
  createProfileFactManagement,
  importantDateAuditFrom,
  type ImportantDatePublisher,
  personAvatarAuditFrom,
  type PersonAvatarImages,
  personCreatedAuditFrom,
  personDuplicateDismissalAuditFrom,
  type PersonGenderOptions,
  personLifecycleAuditFrom,
  personMergeAuditFrom,
  type PersonMergeParticipant,
  personStarAuditFrom,
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
  /**
   * Where an avatar image that could not be discarded is recorded (REL-083).
   * A composition that passes none records nothing.
   */
  readonly logger?: Logger;
  /** The workspace vocabulary a profile fact is validated against. */
  readonly profileFactWorkspace: ProfileFactWorkspaceBoundary;
  readonly importContactTypes: ContactMethodTypeCatalog;
}

export function composePeople(shared: SharedComposition, ports: PeoplePorts) {
  const logger = ports.logger ?? silentLogger();
  const people = createPeopleManagement({
    actors: shared.actors,
    audit: personCreatedAuditFrom(shared.audit),
    clock: shared.clock,
    ids: shared.ids,
    repository: new PostgresPeopleRepository(),
    transaction: shared.peopleTransaction,
  });
  const lifecycle = createPersonLifecycle({
    actors: shared.actors,
    audit: personLifecycleAuditFrom(shared.audit),
    clock: shared.clock,
    genders: ports.genderOptions,
    repository: new PostgresPersonLifecycleRepository(),
    transaction: shared.peopleTransaction,
  });
  const profileFacts = createProfileFactManagement({
    actors: shared.actors,
    audit: profileFactAuditFrom(shared.audit),
    clock: shared.clock,
    ids: shared.ids,
    organizations: new PostgresProfileFactOrganizations(),
    repository: new PostgresProfileFactRepository(),
    transaction: shared.peopleTransaction,
    workspace: ports.profileFactWorkspace,
  });
  return {
    avatars: createPersonAvatarManagement({
      actors: shared.actors,
      audit: personAvatarAuditFrom(shared.audit),
      clock: shared.clock,
      images: ports.avatarImages,
      logger,
      repository: new PostgresPersonAvatarRepository(),
      transaction: shared.peopleTransaction,
    }),
    // Acting on several people at once (GAP-051) through the lifecycle and
    // profile-fact use cases above, one transaction per person.
    bulk: createBulkPeopleActions({
      actors: shared.actors,
      lifecycle,
      profileFacts,
      tags: new PostgresBulkTagLookup(),
      transaction: shared.peopleTransaction,
    }),
    // Marking a possible duplicate pair as two people (REL-064, PEOPLE-008).
    duplicateDismissals: createPersonDuplicateDismissals({
      actors: shared.actors,
      audit: personDuplicateDismissalAuditFrom(shared.audit),
      clock: shared.clock,
      repository: new PostgresPersonDuplicateDismissalRepository(),
      transaction: shared.peopleTransaction,
    }),
    exportBoundary: new PostgresPeopleExportBoundary(),
    importBoundary: new PostgresPeopleImportBoundary(
      ports.importantDatePublisher,
      ports.importContactTypes,
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
    lifecycle,
    lifecycleImpact: PostgresPeopleWorkspaceLifecycleImpact,
    merge: createPersonMerge({
      actors: shared.actors,
      audit: personMergeAuditFrom(shared.audit),
      clock: shared.clock,
      images: ports.avatarImages,
      logger,
      participants: ports.mergeParticipants,
      publisher: ports.importantDatePublisher,
      repository: new PostgresPersonMergeRepository(),
      transaction: shared.peopleTransaction,
    }),
    people,
    personalizationReferences: PostgresPeoplePersonalizationReferences,
    profileFacts,
    // Starring a person for the workspace (GAP-053, PEOPLE-010).
    stars: createPersonStarManagement({
      actors: shared.actors,
      audit: personStarAuditFrom(shared.audit),
      clock: shared.clock,
      repository: new PostgresPersonStarRepository(),
      transaction: shared.peopleTransaction,
    }),
    tagPersonalization: new PostgresTagPersonalization(),
  };
}
