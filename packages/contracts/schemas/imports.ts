/**
 * Workspace imports: the shapes this surface accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/imports` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

export const contactTypeDecision = z.strictObject({
  sourceKey: z.string().min(1).max(650),
  action: z.enum(["create", "map", "skip"]),
  typeId: z.uuid().optional(),
});
export const importCommit = z.strictObject({
  confirmed: z.literal(true),
  contactMethodTypes: z.array(contactTypeDecision).max(1000).optional(),
});

export const importReport = z.strictObject({
  contactMethodTypes: z.strictObject({
    proposals: z.array(z.strictObject({
      key: z.string(),
      name: z.string(),
      kind: z.enum([
        "email",
        "phone",
        "url",
        "social",
        "im",
        "username",
        "custom",
      ]),
      sourceKind: z.string().optional(),
      protocol: z.string().optional(),
      count: z.number().int().min(1),
      canCreate: z.boolean(),
    })),
    existingTypes: z.array(
      z.strictObject({ id: z.uuid(), name: z.string(), kind: z.string() }),
    ),
  }).optional(),
  counts: z.strictObject({
    contacts: z.number().int().min(0),
    legacyCredentialsDiscarded: z.number().int().min(0),
    missingFiles: z.number().int().min(0),
    orphans: z.number().int().min(0),
    unsupported: z.number().int().min(0),
  }),
  diagnostics: z.array(z.strictObject({
    code: z.string(),
    message: z.string(),
    severity: z.enum(["info", "skipped", "warning"]),
  })),
}).meta({ id: "ImportReport" });

/** Every field a CSV column can be mapped to (GAP-050). */
export const CSV_COLUMN_TARGETS = [
  "ignore",
  "givenName",
  "familyName",
  "middleName",
  "nickname",
  "email",
  "phone",
  "street",
  "city",
  "region",
  "postalCode",
  "country",
  "birthday",
  "note",
  "company",
  "jobTitle",
] as const;

export const csvColumnTarget = z.enum(CSV_COLUMN_TARGETS).meta({
  id: "CsvColumnTarget",
});

/** The header and first rows of a CSV file, and the mapping they suggest. */
export const csvPreview = z.strictObject({
  delimiter: z.enum([",", ";"]),
  headers: z.array(z.string()).max(100),
  rowCount: z.number().int().min(0),
  rows: z.array(z.array(z.string())).max(5),
  suggested: z.array(csvColumnTarget).max(100),
}).meta({ id: "CsvPreview" });

/** A CSV dry run that stopped at its column-mapping step. */
export const importMappingRequired = z.strictObject({
  importId: z.uuid(),
  preview: csvPreview,
  status: z.literal("mapping"),
}).meta({ id: "ImportMappingRequired" });

/** The member's mapping, one target per CSV column, in header order. */
export const csvColumnMapping = z.strictObject({
  columns: z.array(csvColumnTarget).min(1).max(100),
}).meta({ id: "CsvColumnMapping" });

export const importDryRun = z.strictObject({
  importId: z.uuid(),
  report: importReport,
  status: z.literal("dry_run"),
}).meta({ id: "ImportDryRun" });

export const importSummary = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  importId: z.uuid(),
  preview: csvPreview.optional().meta({
    description: "Present while a CSV import awaits its column mapping.",
  }),
  report: importReport,
  sourceProfile: z.enum(["csv", "json_export", "sql_export", "vcf"]),
  sourceSystem: z.enum(["csv", "monica", "vcard"]),
  status: z.enum(["completed", "dry_run", "failed", "pending"]),
}).meta({ id: "ImportSummary" });
