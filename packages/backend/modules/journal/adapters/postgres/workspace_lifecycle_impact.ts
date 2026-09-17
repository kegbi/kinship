import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in the journal, table by table. */
export const PostgresJournalWorkspaceLifecycleImpact = workspaceLifecycleImpact(
  {
    counts: {
      journalPosts: "crm.journal_posts",
      lifeEvents: "crm.life_events",
    },
    revision: {
      posts: "crm.journal_posts@id",
      ratings: "crm.journal_day_ratings@id",
      items: "crm.journal_items@id",
      events: "crm.life_events@id",
    },
  },
);
