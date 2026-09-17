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
 * A member may not import: the role check is first, before the file is even
 * looked at, so an unauthorised caller learns nothing about what it contained.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { PERSON_FILE_MAX_BYTES } from "../../files/public.ts";
import { parseMonicaSource } from "../domain/formats/monica_source.ts";
import {
  type ImportReport,
  importReport,
  sourceFingerprint,
  stageContacts,
} from "../domain/import_rules.ts";
import type { ImportActor } from "../ports/context.ts";
import { active, type ImportManagementDependencies } from "./import_context.ts";

/** What a dry run answers with. */
export type DryRunResult =
  | {
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }
  | { readonly detail: string; readonly status: "invalid-source" }
  | Failure<"forbidden">;

export function createImportStaging(
  dependencies: ImportManagementDependencies,
) {
  return {
    dryRun: async (
      actor: ImportActor,
      source: unknown,
    ): Promise<DryRunResult> => {
      if (actor.role === "member") return { status: "forbidden" };
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
