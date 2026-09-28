/**
 * The dry run: read the file, stage what it would do, and tell the member.
 *
 * Nothing about a person is written here. The source is parsed by the format
 * module, every contact is turned into a staging row by the domain, and the
 * fingerprint of the whole source is derived before a transaction is opened,
 * so a file that cannot be read costs one parse and no database work at all.
 * Only then does the run take the actor's lock, write the staging rows, and
 * record the two audit events that say an import started and what it found.
 *
 * A vCard or CSV envelope (`{ format, text }`, GAP-050) is handed to
 * `contact_staging.ts`, which stages it into the same tables; a CSV file
 * stops at its column-mapping step and resumes through `mapColumns`.
 *
 * A member may not import: the role check is first, before the file is even
 * looked at, so an unauthorised caller learns nothing about what it contained.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { PERSON_FILE_MAX_BYTES } from "../../files/public.ts";
import type {
  ContactSourceSystem,
  CsvPreview,
} from "../domain/contact_import.ts";
import { jsonObject } from "../domain/formats/canonical.ts";
import { parseMonicaSource } from "../domain/formats/monica_source.ts";
import {
  type ImportReport,
  importReport,
  mayImport,
  sourceFingerprint,
  stageContacts,
} from "../domain/import_rules.ts";
import type { ImportActor } from "../ports/context.ts";
import { createContactStaging } from "./contact_staging.ts";
import { active, type ImportManagementDependencies } from "./import_context.ts";

/** What a dry run answers with. */
export type DryRunResult =
  | {
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }
  | {
    readonly importId: string;
    readonly preview: CsvPreview;
    readonly status: "mapping";
  }
  | { readonly detail: string; readonly status: "invalid-source" }
  | Failure<"forbidden">;

/** What applying a CSV column mapping answers with. */
export type CsvMappingResult =
  | {
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }
  | { readonly detail: string; readonly status: "invalid-mapping" }
  | Failure<"forbidden" | "not-found">;

/** The contact format an envelope names, when it names one. */
function contactFormat(source: unknown): ContactSourceSystem | undefined {
  const format = jsonObject(source)?.format;
  return format === "vcard" || format === "csv" ? format : undefined;
}

export function createImportStaging(
  dependencies: ImportManagementDependencies,
) {
  const contactStaging = createContactStaging(dependencies);
  return {
    mapColumns: contactStaging.mapColumns,
    dryRun: async (
      actor: ImportActor,
      source: unknown,
    ): Promise<DryRunResult> => {
      if (!mayImport(actor.role)) return { status: "forbidden" };
      const format = contactFormat(source);
      if (format === "vcard") {
        return await contactStaging.stageVCard(actor, source);
      }
      if (format === "csv") return await contactStaging.stageCsv(actor, source);
      const parsed = parseMonicaSource(source, {
        maxAttachmentBytes: PERSON_FILE_MAX_BYTES,
      });
      if (typeof parsed === "string") {
        return { detail: parsed, status: "invalid-source" };
      }
      const staged = stageContacts(parsed, () => dependencies.ids.next());
      if (typeof staged === "string") {
        return { detail: staged, status: "invalid-source" };
      }
      const { contacts, missingFiles } = staged;
      const report = importReport({
        contacts: contacts.length,
        legacyCredentialsDiscarded: parsed.userCount,
        missingFiles,
        // Nothing this profile stages refers to a contact it did not also
        // stage, so an orphan is impossible today; the count is reported so a
        // profile that can produce one does not have to change the report.
        orphans: 0,
        unsupported: parsed.unsupported,
      });
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const run = await dependencies.repository.stage({
          actor,
          contacts,
          fingerprint: await sourceFingerprint(parsed, contacts),
          importId: dependencies.ids.next(),
          report,
          transaction,
        });
        const occurredAt = new Date();
        await dependencies.audit.record({
          action: "started",
          actor,
          importId: run.importId,
          occurredAt,
          payload: { sourceProfile: "json_export" },
          transaction,
        });
        await dependencies.audit.record({
          action: "validated",
          actor,
          importId: run.importId,
          occurredAt,
          payload: { ...run.report.counts },
          transaction,
        });
        return run;
      });
    },
  };
}
