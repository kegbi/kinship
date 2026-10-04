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
        const occurredAt = new Date();
        // A vCard or CSV run files its contact methods under the workspace's
        // types, asked once, and only when a contact is actually created.
        let types:
          | Awaited<ReturnType<typeof dependencies.contactTypes.byKind>>
          | undefined;
        const committedContacts = new Map<string, {
          readonly outcome: "created" | "deleted" | "reused";
          readonly targetPersonId: string;
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
            const { details, note } = personDetails(contact.contact, types);
            await dependencies.people.addDetails({
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
          payload: counts,
          transaction,
        });
        await dependencies.repository.complete(
          actor,
          importId,
          counts,
          transaction,
        );
        return { importId, ...counts, status: "completed" as const };
      });
    },
  };
}
