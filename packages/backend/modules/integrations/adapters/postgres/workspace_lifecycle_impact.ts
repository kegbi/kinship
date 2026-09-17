import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/**
 * What a workspace cascade destroys in integrations, table by table. The
 * reported number is books and subscriptions together, as the operator sees
 * one "integrations" figure.
 */
export const PostgresIntegrationWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: {
      integrations: [
        "crm.dav_address_books",
        "crm.dav_address_book_subscriptions",
      ],
    },
    revision: {
      books: "crm.dav_address_books@id",
      subscriptions: "crm.dav_address_book_subscriptions@id",
      objects: "crm.dav_objects@id",
      tokens: "crm.dav_sync_tokens@id",
      weather: "crm.location_weather_cache@id via crm.locations.location_id",
    },
  });
