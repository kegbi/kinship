/**
 * The dry run of a vCard or CSV import (GAP-050).
 *
 * The file is read and every contact staged before a transaction is opened,
 * as the Monica dry run does, so a file that cannot be read costs one parse
 * and no database work. Inside the transaction the run asks the two things
 * only the workspace knows — which contact-method types it has, and which of
 * these contacts an earlier import already brought in — and then writes the
 * staging rows and the report together with the two audit events.
 *
 * A CSV file takes one more step. Its rows are stored raw in a `pending` run
 * and the member is shown the header and the first rows; `mapColumns` then
 * applies the member's mapping to those stored rows, so the file is uploaded
 * once and the mapping is kept on the run.
 */

import {
  contactImportReport,
  contactLosses,
  type ContactSourceSystem,
  credentialName,
  CSV_PREVIEW_ROWS,
  csvMappingProblem,
  type CsvTarget,
  mappedCsvContact,
  type StagedSourceContact,
  stageSourceContacts,
  suggestedCsvMapping,
} from "../domain/contact_import.ts";
import { jsonObject, sha256Hex } from "../domain/formats/canonical.ts";
import { sourceText } from "../domain/formats/contact_source.ts";
import { parseCsv } from "../domain/formats/csv.ts";
import { parseVCardSource } from "../domain/formats/vcard_parse.ts";
import { mayImport } from "../domain/import_rules.ts";
import type { ImportActor, ImportTransaction } from "../ports/context.ts";
import { active, type ImportManagementDependencies } from "./import_context.ts";
import type { CsvMappingResult, DryRunResult } from "./import_staging.ts";

const CREDENTIAL_COLUMN =
  "This file contains a password or secret column; remove it and upload again.";

/** The text an envelope carries, or the sentence that refuses it. */
function envelopeText(source: unknown): string | { readonly problem: string } {
  return sourceText(jsonObject(source)?.text);
}

export function createContactStaging(
  dependencies: ImportManagementDependencies,
) {
  /** The report, written only once the workspace has been asked. */
  const reportFor = async (
    actor: ImportActor,
    format: ContactSourceSystem,
    rows: readonly StagedSourceContact[],
    skipped: Readonly<Record<string, number>>,
    fingerprint: string,
    transaction: ImportTransaction,
  ) => {
    const types = await dependencies.contactTypes.byKind({
      transaction,
      workspaceId: actor.workspaceId,
    });
    // An earlier person is reused while they are still there, exactly as the
    // commit decides; one deleted since is skipped and stays deleted
    // (REL-065), and one removed altogether is imported again.
    const earlier = await dependencies.contacts.history({
      actor,
      fingerprint,
      rows,
      sourceSystem: format,
      transaction,
    });
    const history = {
      conflicts: 0,
      deleted: 0,
      fileImportedBefore: earlier.fileImportedBefore,
      reused: 0,
    };
    for (const match of earlier.matches) {
      const presence = await dependencies.people.presence({
        actor,
        personId: match.targetPersonId,
        transaction,
      });
      if (presence === "absent") continue;
      if (presence === "deleted") history.deleted++;
      else if (match.changed) history.conflicts++;
      else history.reused++;
    }
    return contactImportReport(
      format,
      rows,
      contactLosses(rows, types, skipped),
      history,
    );
  };

  const audit = async (
    actor: ImportActor,
    importId: string,
    action: "started" | "validated",
    payload: Readonly<Record<string, unknown>>,
    transaction: ImportTransaction,
  ) =>
    await dependencies.audit.record({
      action,
      actor,
      importId,
      occurredAt: new Date(),
      payload,
      transaction,
    });

  return {
    stageVCard: async (
      actor: ImportActor,
      source: unknown,
    ): Promise<DryRunResult> => {
      const text = envelopeText(source);
      if (typeof text !== "string") {
        return { detail: text.problem, status: "invalid-source" };
      }
      const parsed = parseVCardSource(text);
      if (typeof parsed === "string") {
        return { detail: parsed, status: "invalid-source" };
      }
      const rows = await stageSourceContacts(
        parsed.cards.map((contact) => ({
          contact,
          ...(contact.uid ? { sourcePrimaryKey: contact.uid } : {}),
        })),
        () => dependencies.ids.next(),
      );
      const fingerprint = await sha256Hex(text);
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const report = await reportFor(
          actor,
          "vcard",
          rows,
          parsed.skipped,
          fingerprint,
          transaction,
        );
        const importId = dependencies.ids.next();
        await dependencies.contacts.stageContacts({
          actor,
          fingerprint,
          importId,
          report,
          rows,
          sourceSystem: "vcard",
          transaction,
        });
        await audit(actor, importId, "started", {
          sourceProfile: "vcf",
        }, transaction);
        await audit(
          actor,
          importId,
          "validated",
          { ...report.counts },
          transaction,
        );
        return { importId, report, status: "dry_run" as const };
      }, { workspaceId: actor.workspaceId });
    },

    stageCsv: async (
      actor: ImportActor,
      source: unknown,
    ): Promise<DryRunResult> => {
      const text = envelopeText(source);
      if (typeof text !== "string") {
        return { detail: text.problem, status: "invalid-source" };
      }
      const parsed = parseCsv(text);
      if (typeof parsed === "string") {
        return { detail: parsed, status: "invalid-source" };
      }
      // A credential column is refused before anything is stored: its cells
      // would otherwise sit in the pending run until the member mapped it.
      if (parsed.headers.some(credentialName)) {
        return { detail: CREDENTIAL_COLUMN, status: "invalid-source" };
      }
      const preview = {
        delimiter: parsed.delimiter,
        headers: parsed.headers,
        rowCount: parsed.rows.length,
        rows: parsed.rows.slice(0, CSV_PREVIEW_ROWS),
        suggested: suggestedCsvMapping(parsed.headers),
      };
      const fingerprint = await sha256Hex(text);
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const importId = dependencies.ids.next();
        await dependencies.contacts.stagePendingCsv({
          actor,
          fingerprint,
          importId,
          preview,
          rows: parsed.rows,
          transaction,
        });
        await audit(actor, importId, "started", {
          sourceProfile: "csv",
        }, transaction);
        return { importId, preview, status: "mapping" as const };
      }, { workspaceId: actor.workspaceId });
    },

    mapColumns: async (
      actor: ImportActor,
      importId: string,
      mapping: readonly string[],
    ): Promise<CsvMappingResult> => {
      if (!mayImport(actor.role)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const pending = await dependencies.contacts.lockPendingCsv(
          actor,
          importId,
          transaction,
        );
        if (!pending) return { status: "not-found" as const };
        const problem = csvMappingProblem(pending.headers, mapping);
        if (problem) {
          return { detail: problem, status: "invalid-mapping" as const };
        }
        const targets = mapping as readonly CsvTarget[];
        const skipped: Record<string, number> = {};
        const sources = pending.rows.map((row) => {
          const mapped = mappedCsvContact(pending.headers, row, targets);
          for (const header of mapped.unreadable) {
            skipped[header] = (skipped[header] ?? 0) + 1;
          }
          return { contact: mapped.contact };
        });
        const rows = await stageSourceContacts(
          sources,
          () => dependencies.ids.next(),
        );
        const report = await reportFor(
          actor,
          "csv",
          rows,
          skipped,
          pending.fingerprint,
          transaction,
        );
        await dependencies.contacts.mapCsv({
          actor,
          importId,
          mapping: targets,
          report,
          rows,
          transaction,
        });
        await audit(
          actor,
          importId,
          "validated",
          { ...report.counts },
          transaction,
        );
        return { importId, report, status: "dry_run" as const };
      }, { workspaceId: actor.workspaceId });
    },
  };
}
