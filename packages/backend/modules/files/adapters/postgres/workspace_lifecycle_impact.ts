import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/**
 * What a workspace cascade destroys in files, table by table. Files is the one
 * module that also names stored objects, so the cleanup can remove them once
 * the transaction commits.
 */
export const PostgresFileWorkspaceLifecycleImpact = workspaceLifecycleImpact({
  counts: { files: "crm.files" },
  objectKeys: "crm.files@storage_key",
  revision: {
    files: "crm.files@id",
    personLinks:
      "crm.person_file_links@person_id,file_id via crm.files.file_id",
    giftLinks: "crm.gift_file_links@gift_id,file_id via crm.files.file_id",
  },
});
