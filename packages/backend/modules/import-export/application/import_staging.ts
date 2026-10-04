import { monicaChoiceReport } from "../domain/monica_choices.ts";
import { businessTargetId } from "../domain/business_entities.ts";
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
import {
  contactImportReport,
  contactLosses,
  type ContactSourceSystem,
  type CsvPreview,
  type StagedSourceContact,
} from "../domain/contact_import.ts";
import {
  matchingContactType,
  sourceContactTypes,
} from "../domain/contact_type_mapping.ts";
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
      const compatibleFingerprints: string[] = [];
      for (
        const source of parsed.compatibleSources ??
          (parsed.legacySource ? [parsed.legacySource] : [])
      ) {
        const legacy = stageContacts(source, () => "");
        if (typeof legacy !== "string") {
          compatibleFingerprints.push(
            await sourceFingerprint(source, legacy.contacts),
          );
        }
      }
      const report = importReport({
        contacts: contacts.length,
        legacyCredentialsDiscarded: parsed.userCount,
        missingFiles: missingFiles +
          (parsed.businessEntities ?? []).filter((e) =>
            e.owner === "files" && e.data.kind === "photo"
          ).length,
        // Related rows must resolve to contacts in their source account.
        orphans: parsed.orphans ?? 0,
        unsupported: parsed.unsupported,
      });
      return await dependencies.transaction.run(async (transaction) => {
        if (!(await active(dependencies, actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const detailRows: StagedSourceContact[] = contacts.flatMap((
          row,
          index,
        ) =>
          row.contact
            ? [{
              contact: row.contact,
              fingerprint: "",
              row: index + 1,
              status: "mapped" as const,
              targetPersonId: row.targetPersonId,
            }]
            : []
        );
        const types = await dependencies.contactTypes.byKind({
          transaction,
          workspaceId: actor.workspaceId,
        });
        const sourceTypes = sourceContactTypes(
          contacts,
          parsed.contactTypeCatalog,
        );
        const workspaceTypes = sourceTypes.length
          ? await dependencies.contactTypes.forImport({
            transaction,
            workspaceId: actor.workspaceId,
            lock: false,
          })
          : [];
        const proposals = sourceTypes.filter((type) =>
          !matchingContactType(type, workspaceTypes)
        ).map((type) => ({
          key: type.key,
          name: type.name,
          kind: type.kind,
          count: type.count,
          ...(type.sourceKind ? { sourceKind: type.sourceKind } : {}),
          ...(type.protocol ? { protocol: type.protocol } : {}),
          canCreate: !workspaceTypes.some((existing) =>
            existing.name.trim().toLowerCase() ===
              type.name.trim().toLowerCase()
          ),
        }));
        // Monica methods have a separate explicit vocabulary decision, rather
        // than the portable formats' skip-when-kind-is-missing rule.
        const losses = contactLosses(
          detailRows.map((row) =>
            row.status === "mapped" && row.contact.contactMethods
              ? {
                ...row,
                contact: { ...row.contact, emails: [], phones: [], urls: [] },
              }
              : row
          ),
          types,
          {},
        );
        const detailsReport = contactImportReport("csv", detailRows, losses, {
          reused: 0,
          conflicts: 0,
        });
        const unsupportedDetails =
          Object.values(losses.missingTypes).reduce((sum, count) =>
            sum + count, 0) + losses.organizationsWithoutTitle;
        const choiceOptions = await dependencies.choices?.options({
          workspaceId: actor.workspaceId,
          transaction,
        });
        const businessEntities = (parsed.businessEntities ?? []).map((e) => {
          if (
            e.data.kind !== "debt" || e.data.unresolvedCurrency ||
            !choiceOptions ||
            choiceOptions.currencies.includes(String(e.data.currencyCode))
          ) {
            return e;
          }
          const source = e.data.source as Readonly<Record<string, unknown>>;
          return {
            ...e,
            data: {
              ...e.data,
              unresolvedCurrency: true,
              currencyCode: null,
              rawAmount: String(source.amount),
              minorUnits: parsed.sourceProfile === "sql_export",
            },
          };
        });
        const detailedReport: ImportReport = {
          monicaChoices: monicaChoiceReport(
            businessEntities,
            contacts,
            choiceOptions ?? { currencies: [], genders: [] },
          ),
          ...(proposals.length
            ? {
              contactMethodTypes: {
                proposals,
                existingTypes: workspaceTypes.filter((type) =>
                  !type.archived
                )
                  .map(({ id, name, kind }) => ({ id, name, kind })),
              },
            }
            : {}),
          counts: {
            ...report.counts,
            unsupported: report.counts.unsupported + unsupportedDetails,
          },
          diagnostics: [
            ...importReport({
              ...report.counts,
              unsupported: report.counts.unsupported + unsupportedDetails,
            }).diagnostics,
            ...Object.entries(parsed.excludedRows ?? {}).map((
              [table, count],
            ) => ({
              code: "excluded-table",
              message:
                `${table}: ${count} source row(s) excluded; credentials, cached counters and historical deliveries are not activated.`,
              severity: "warning" as const,
            })),
            ...Object.entries(parsed.unsupportedRows ?? {}).map((
              [table, count],
            ) => ({
              code: "unsupported-table",
              message: `${table}: ${count} row(s) are not imported.`,
              severity: "skipped" as const,
            })),
            ...Object.entries(parsed.unsupportedFields ?? {}).map((
              [field, count],
            ) => ({
              code: "unsupported-field",
              message: `${field}: ${count} field value(s) are not imported.`,
              severity: "skipped" as const,
            })),
            ...detailsReport.diagnostics,
            ...Object.entries(
              (parsed.businessEntities ?? []).reduce<Record<string, number>>(
                (counts, e) => {
                  counts[e.sourceTable] = (counts[e.sourceTable] ?? 0) + 1;
                  return counts;
                },
                {},
              ),
            ).map(([table, count]) => ({
              code: "business-records",
              message:
                `${table}: ${count} business record(s) staged for import.`,
              severity: "info" as const,
            })),
            ...(proposals.length
              ? [{
                code: "contact-type-decisions",
                message: `${
                  proposals.reduce((sum, type) => sum + type.count, 0)
                } contact method(s) across ${proposals.length} type(s) need a choice below, including unused catalog types. Create a type, map to an existing type, or explicitly skip. No types are created by validation.`,
                severity: "warning" as const,
              }]
              : []),

            ...(detailRows.some((row) =>
                row.status === "mapped" &&
                row.contact.dates.some((date) => date.isYearApproximate)
              )
              ? [{
                code: "age-based-date",
                message:
                  "Age-based dates are imported as approximate years without an invented month or day.",
                severity: "warning" as const,
              }]
              : []),
          ],
        };
        const run = await dependencies.repository.stage({
          actor,
          contacts,
          ...(parsed.contactTypeCatalog
            ? { contactTypeCatalog: parsed.contactTypeCatalog }
            : {}),
          compatibleFingerprints,
          businessEntities: await Promise.all(
            businessEntities.map(async (entity) => ({
              ...entity,
              targetId: await businessTargetId(
                actor.workspaceId,
                entity,
                parsed.businessNamespace ?? "",
              ),
            })),
          ),
          fingerprint: await sourceFingerprint(parsed, contacts),
          importId: dependencies.ids.next(),
          report: detailedReport,
          sourceProfile: parsed.sourceProfile ?? "json_export",
          transaction,
        });
        const occurredAt = new Date();
        await dependencies.audit.record({
          action: "started",
          actor,
          importId: run.importId,
          occurredAt,
          payload: { sourceProfile: parsed.sourceProfile ?? "json_export" },
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
