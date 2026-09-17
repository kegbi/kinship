import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in gifts, table by table. */
export const PostgresGiftWorkspaceLifecycleImpact = workspaceLifecycleImpact({
  counts: { debts: "crm.debts", gifts: "crm.gifts" },
  revision: { gifts: "crm.gifts@id", debts: "crm.debts@id" },
});
