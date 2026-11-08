import {
  applyMonicaChoices,
  type MonicaChoices,
  validMonicaChoices,
} from "../domain/monica_choices.ts";
import { commitBusinessEntities } from "./business_import.ts";
/**
 * The commit: turn the staged rows into people, once.
 *
 * Two things make this idempotent rather than duplicating a workspace every
 * time somebody re-imports the same file. A staged contact that already has a
 * target person is only reused if that person is still there, which the people
 * boundary is asked inside the same transaction; and a reused contact is
 * retargeted in the staging table, so the next commit of the same run lands on
 * the same person again. An avatar is only represented for a contact that was
 * created, because a reused person already has whatever avatar they have.
 *
 * A person who is deleted (by a member, or already deleted in the Monica
 * source) stays deleted (REL-065): the contact is retargeted to them, as a
 * reused one is, so every later run lands on them again, but nothing is
 * created and nothing from the row — details, note, or avatar — is written
 * onto them, and the report counts them as skipped because deleted rather
 * than as reused. An archived person is reused.
 *
 * A vCard or CSV contact (GAP-050) brings more than the person: its contact
 * methods, addresses, dates, and work are written through the people
 * boundary and its note through the interactions boundary, all in the same
 * transaction, and only for a person this commit created — a reused person
 * is left exactly as the member has kept them.
 *
 * The confirmation is not a formality: committing writes people into a
 * workspace that already has some, so an unconfirmed request is answered with
 * `confirmation-required` before anything is read.
 */

import {
  type ContactTypeDecision,
  contactTypePlan,
  sourceContactTypes,
} from "../domain/contact_type_mapping.ts";
import { personDetails } from "../domain/contact_import.ts";
import {
  type ImportCommitResult,
  importedPerson,
  mayImport,
} from "../domain/import_rules.ts";
import type { ImportActor } from "../ports/context.ts";
import { active, type ImportManagementDependencies } from "./import_context.ts";

export function createImportCommit(dependencies: ImportManagementDependencies) {
  return {
    commit: async (
      actor: ImportActor,
      importId: string,
      confirmed: boolean,
      contactMethodTypes: readonly ContactTypeDecision[] = [],
      choices?: MonicaChoices,
    ): Promise<ImportCommitResult> => {
      if (!confirmed) return { status: "confirmation-required" };
      if (!mayImport(actor.role)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const prepared = await dependencies.repository.prepareCommit(
          actor,
          importId,
          transaction,
        );
        if (prepared.status !== "ready") return prepared;
        const sourceTypes = sourceContactTypes(
          prepared.contacts,
          prepared.contactTypeCatalog,
        );
        const workspaceTypes = sourceTypes.length
          ? await dependencies.contactTypes.forImport({
            transaction,
            workspaceId: actor.workspaceId,
            lock: true,
          })
          : [];
        const plan = contactTypePlan(
          sourceTypes,
          workspaceTypes,
          contactMethodTypes,
        );
        if (plan.status !== "ready") {
          return { status: "contact-type-decision-required" as const };
        }
        let businessEntities = prepared.businessEntities;
        if (businessEntities !== undefined) {
          const options = await dependencies.choices?.options({
            workspaceId: actor.workspaceId,
            transaction,
          }) ?? { currencies: [], genders: [] };
          if (!validMonicaChoices(businessEntities, options, choices)) {
            return { status: "monica-choice-required" as const };
          }
          if (!dependencies.choices) {
            throw new Error("Missing workspace import choices boundary.");
          }
          const created: Record<string, string> = {};
          for (
            const choice of choices.genders.filter((c) => c.action === "create")
          ) {
            const id = dependencies.ids.next();
            const owner = dependencies.business?.workspaces;
            if (!owner) throw new Error("Missing workspace import boundary.");
            const result = await owner.importRecords({
              actor,
              transaction,
              records: [{
                id,
                data: { kind: "gender", name: choice.name!.trim() },
                references: {},
              }],
            });
            created[choice.sourceKey] = result?.[id] ?? id;
          }
          businessEntities = applyMonicaChoices(
            businessEntities,
            choices,
            created,
          );
          await dependencies.choices.setTimezone({
            workspaceId: actor.workspaceId,
            memberId: actor.memberId,
            timezone: choices.timezone,
            transaction,
          });
          await dependencies.planning?.timezoneChanged(actor, transaction);
        } else if (choices !== undefined) {
          return { status: "monica-choice-required" as const };
        }
        for (const type of plan.create) {
          plan.mapping[type.key] = await dependencies.contactTypes
            .createForImport({
              transaction,
              workspaceId: actor.workspaceId,
              name: type.name,
              kind: type.kind,
              ...(type.protocol ? { protocol: type.protocol } : {}),
              ...(type.icon !== undefined ? { icon: type.icon } : {}),
              ...(type.canDelete !== undefined
                ? { canDelete: type.canDelete }
                : {}),
              ...(type.createdAt ? { createdAt: type.createdAt } : {}),
              ...(type.updatedAt ? { updatedAt: type.updatedAt } : {}),
            });
        }
        const occurredAt = new Date();
        // A vCard or CSV run files its contact methods under the workspace's
        // types, asked once, and only when a contact is actually created.
        let types:
          | Awaited<ReturnType<typeof dependencies.contactTypes.byKind>>
          | undefined;
        const committedContacts = new Map<string, {
          readonly outcome: "created" | "deleted" | "reused";
          readonly targetPersonId: string;
          readonly repairBefore?: string;
          readonly legacyNotes?: readonly string[];
          readonly legacyStartedAt?: string;
          readonly legacyCompletedAt?: string;
        }>();
        for (const contact of prepared.contacts) {
          const presence = contact.previousTargetPersonId
            ? await dependencies.people.presence({
              actor,
              personId: contact.previousTargetPersonId,
              transaction,
            })
            : "absent";
          if (presence !== "absent") {
            const targetPersonId = contact.previousTargetPersonId!;
            await dependencies.repository.retargetContact(
              importId,
              contact.entityId,
              targetPersonId,
              transaction,
            );
            committedContacts.set(contact.sourcePrimaryKey, {
              ...(contact.repairBefore
                ? { repairBefore: contact.repairBefore }
                : {}),
              ...(contact.legacyCompletedAt
                ? {
                  ...(contact.legacyNotes
                    ? { legacyNotes: contact.legacyNotes }
                    : {}),
                  legacyStartedAt: contact.legacyStartedAt!,
                  legacyCompletedAt: contact.legacyCompletedAt!,
                }
                : {}),
              outcome: presence === "active" ? "reused" : "deleted",
              targetPersonId,
            });
            continue;
          }
          const targetPersonId = contact.targetPersonId;
          await dependencies.people.create({
            actor,
            occurredAt,
            person: importedPerson(contact, targetPersonId),
            transaction,
          });
          if (contact.contact) {
            types ??= await dependencies.contactTypes.byKind({
              transaction,
              workspaceId: actor.workspaceId,
            });
            const { details, note } = personDetails(
              contact.contact,
              types,
              plan.mapping,
            );
            await dependencies.people.addDetails({
              suppressDateReminders: prepared.businessEntities !== undefined,
              actor,
              details,
              occurredAt,
              personId: targetPersonId,
              transaction,
            });
            if (note) {
              await dependencies.notes.addNote({
                actor,
                body: note,
                noteId: dependencies.ids.next(),
                occurredAt,
                personId: targetPersonId,
                transaction,
              });
            }
          }
          for (const body of contact.notes ?? []) {
            await dependencies.notes.addNote({
              actor,
              body,
              noteId: dependencies.ids.next(),
              occurredAt,
              personId: targetPersonId,
              transaction,
            });
          }
          committedContacts.set(contact.sourcePrimaryKey, {
            outcome: "created",
            targetPersonId,
          });
        }
        for (const avatar of prepared.avatars) {
          const person = committedContacts.get(avatar.personSourcePrimaryKey);
          if (person?.outcome !== "created") continue;
          await dependencies.files.representMissing({
            actor,
            byteSize: avatar.byteSize,
            fileId: avatar.fileId,
            importId,
            originalFilename: avatar.originalFilename,
            transaction,
          });
          await dependencies.people.linkAvatar({
            actor,
            fileId: avatar.fileId,
            personId: person.targetPersonId,
            transaction,
          });
        }
        if (businessEntities?.length) {
          await commitBusinessEntities({
            actor,
            transaction,
            entities: businessEntities,
            contacts: committedContacts,
            boundaries: dependencies.business ?? {},
            retarget: async (entity, id) => {
              await dependencies.repository.retargetBusinessEntity?.(
                importId,
                entity,
                id,
                transaction,
              );
            },
          });
        }
        // Repair unresolved profile fields before additive contact methods can touch a person's update timestamp.
        for (const contact of prepared.contacts) {
          const person = committedContacts.get(contact.sourcePrimaryKey);
          if (person?.outcome === "reused" && contact.contact?.contactMethods) {
            await dependencies.people.addContactMethods({
              actor,
              personId: person.targetPersonId,
              occurredAt,
              transaction,
              methods: personDetails(contact.contact, {}, plan.mapping).details
                .contactMethods,
            });
          }
        }
        const outcomes = [...committedContacts.values()].map((contact) =>
          contact.outcome
        );
        const count = (outcome: "created" | "deleted" | "reused") =>
          outcomes.filter((item) => item === outcome).length;
        const counts = {
          peopleCreated: count("created"),
          peopleReused: count("reused"),
          peopleSkippedDeleted: count("deleted"),
        };
        await dependencies.audit.record({
          action: "committed",
          actor,
          importId,
          occurredAt,
          payload: { ...counts, contactMethodTypesCreated: plan.create.length },
          transaction,
        });
        await dependencies.repository.complete(
          actor,
          importId,
          counts,
          transaction,
          sourceTypes.length
            ? {
              createdTypes: new Set(plan.create.map((type) =>
                type.name.trim().toLowerCase()
              )).size,
              mappedMethods: sourceTypes.filter((type) =>
                plan.mapping[type.key]
              ).reduce((sum, type) =>
                sum + type.count, 0),
              skippedMethods: sourceTypes.filter((type) =>
                !plan.mapping[type.key]
              ).reduce((sum, type) => sum + type.count, 0),
            }
            : undefined,
          choices,
        );
        return { importId, ...counts, status: "completed" as const };
      }, { workspaceId: actor.workspaceId });
    },
  };
}
