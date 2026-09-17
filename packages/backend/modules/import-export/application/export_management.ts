/**
 * The export facade.
 *
 * Exporting is two separate pieces of work — producing a workspace's portable
 * artifact, and handing out what has been produced — which share only the
 * context they each establish first. They are assembled here so a composition
 * root still builds one object with `createWorkspace`, `exportVCard`, `list`,
 * `createDownload`, and `download` on it, and so the split stays an internal
 * matter rather than something every caller has to know about.
 */

import { createExportArtifact } from "./export_artifact.ts";
import type { ExportManagementDependencies } from "./export_context.ts";
import { createExportDownloads } from "./export_downloads.ts";

export function createExportManagement(
  dependencies: ExportManagementDependencies,
) {
  const artifact = createExportArtifact(dependencies);
  const downloads = createExportDownloads(dependencies);
  return {
    createWorkspace: artifact.createWorkspace,
    exportVCard: downloads.exportVCard,
    list: downloads.list,
    createDownload: downloads.createDownload,
    download: downloads.download,
  };
}

export type ExportManagement = ReturnType<typeof createExportManagement>;
