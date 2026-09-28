/**
 * Listing runs, handing out a download link, and spending one.
 *
 * A download link is a one-shot credential with a short life. The token itself
 * is only ever in the response: what is stored is its digest, so a database
 * reader cannot download anybody's export, and spending it is a single
 * repository call that either consumes it or explains why it will not.
 *
 * The person vCard sits here because it is the other thing a member downloads,
 * and it is the one export path that takes no lock: it reads one person the
 * caller can already see, renders the card, and records that the person was
 * downloaded, all inside one transaction so the record cannot outlive a read
 * that failed.
 *
 * The directory's selection vCard (GAP-051) is the same path over up to a
 * hundred people: each one is read as the single card reads them, audited as
 * that one download is, and joined into one file with the all-people
 * export's joiner. Somebody missing from the workspace is left out and
 * counted, never named.
 */

import { displayName } from "../../people/public.ts";
import { EXPORT_WINDOWS } from "../domain/export_rules.ts";
import { sha256Hex } from "../domain/formats/canonical.ts";
import { joinVCards } from "../domain/formats/contacts_export.ts";
import {
  VCARD_MIME_TYPE,
  vcardFilename,
  vcardText,
} from "../domain/formats/vcard.ts";
import type { ExportActor } from "../ports/context.ts";
import { active, type ExportManagementDependencies } from "./export_context.ts";

const ENCODER = new TextEncoder();

export function createExportDownloads(
  dependencies: ExportManagementDependencies,
) {
  return {
    exportVCard: async (actor: ExportActor, personId: string) => {
      const prepared = await dependencies.transaction.run(
        async (transaction) => {
          // The people boundary no longer carries its own actor join, so the
          // actor's standing is established here, in the same transaction.
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: false,
            transaction,
          });
          if (standing === "revoked") return undefined;
          const person = await dependencies.people.getPerson({
            actor,
            personId,
            transaction,
          });
          if (!person) return undefined;
          const bytes = ENCODER.encode(
            vcardText(person, displayName(person)),
          );
          await dependencies.audit.recordPersonDownload({
            actor,
            occurredAt: dependencies.clock.now(),
            personId,
            transaction,
          });
          return { bytes, person };
        },
      );
      if (!prepared) return { status: "not-found" as const };
      return {
        bytes: prepared.bytes,
        filename: vcardFilename(prepared.person),
        mimeType: VCARD_MIME_TYPE,
        status: "ready" as const,
      };
    },
    exportVCards: async (actor: ExportActor, personIds: readonly string[]) => {
      const prepared = await dependencies.transaction.run(
        async (transaction) => {
          const standing = await dependencies.actors.revalidate({
            ...actor,
            lock: false,
            transaction,
          });
          if (standing === "revoked") return undefined;
          const people = [];
          for (const personId of personIds) {
            const person = await dependencies.people.getPerson({
              actor,
              personId,
              transaction,
            });
            if (!person) continue;
            people.push(person);
            await dependencies.audit.recordPersonDownload({
              actor,
              occurredAt: dependencies.clock.now(),
              personId,
              transaction,
            });
          }
          return people;
        },
      );
      if (!prepared) return { status: "forbidden" as const };
      if (prepared.length === 0) return { status: "not-found" as const };
      return {
        bytes: ENCODER.encode(joinVCards(prepared, displayName)),
        filename: `kinship-people-${prepared.length}.vcf`,
        mimeType: VCARD_MIME_TYPE,
        skipped: personIds.length - prepared.length,
        status: "ready" as const,
      };
    },
    list: async (actor: ExportActor) => {
      if (actor.role === "member") return { status: "forbidden" as const };
      return await dependencies.transaction.run(async (transaction) =>
        (await active(dependencies, actor, transaction))
          ? {
            exports: await dependencies.repository.list(actor, transaction),
            status: "ready" as const,
          }
          : { status: "forbidden" as const }
      );
    },
    createDownload: async (actor: ExportActor, exportId: string) => {
      if (actor.role === "member") return { status: "forbidden" as const };
      const token = dependencies.tokens.next();
      const expiresAt = new Date(
        dependencies.clock.now().getTime() + EXPORT_WINDOWS.downloadMs,
      );
      const digest = await sha256Hex(token);
      const issued = await dependencies.transaction.run(async (transaction) =>
        await active(dependencies, actor, transaction) &&
        await dependencies.repository.issueDownload({
          actor,
          digest,
          expiresAt,
          exportId,
          transaction,
        })
      );
      return issued
        ? {
          expiresAt: expiresAt.toISOString(),
          href: `/api/v1/exports/${exportId}/download?token=${
            encodeURIComponent(token)
          }&workspaceId=${encodeURIComponent(actor.workspaceId)}`,
          status: "ready" as const,
        }
        : { status: "not-found" as const };
    },
    download: async (actor: ExportActor, exportId: string, token: string) => {
      if (actor.role === "member") return { status: "forbidden" as const };
      const now = dependencies.clock.now();
      const digest = await sha256Hex(token);
      const attempt = await dependencies.transaction.run(
        async (transaction) => {
          if (!(await active(dependencies, actor, transaction))) {
            return { authorized: false as const };
          }
          return {
            authorized: true as const,
            consumed: await dependencies.repository.consumeDownload({
              actor,
              digest,
              exportId,
              now,
              transaction,
            }),
          };
        },
      );
      if (!attempt.authorized) return { status: "not-found" as const };
      if (attempt.consumed.status !== "consumed") return attempt.consumed;
      const file = await dependencies.files.read({
        ...actor,
        fileId: attempt.consumed.fileId,
      });
      if (file.status !== "ready") return file;
      await dependencies.transaction.run((transaction) =>
        dependencies.audit.record({
          action: "downloaded",
          actor,
          exportId,
          occurredAt: now,
          payload: {},
          transaction,
        })
      );
      return file;
    },
  };
}
