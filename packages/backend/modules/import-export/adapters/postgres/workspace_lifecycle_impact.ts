import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in import-export, table by table. */
export const PostgresImportExportWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: { exports: "crm.data_exports", imports: "crm.data_imports" },
    revision: {
      imports: "crm.data_imports@id",
      entities: "crm.data_import_entities@id via crm.data_imports.import_id",
      reports: "crm.data_import_reports@id via crm.data_imports.import_id",
      exports: "crm.data_exports@id",
    },
  });
