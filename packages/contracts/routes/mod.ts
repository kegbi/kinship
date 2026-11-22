/**
 * Every route this API serves, in one list.
 *
 * `apps/api/composition.ts` mounts the surfaces this gathers, and
 * `tools/contracts/build.ts` documents them, so `contracts:check` can put the
 * two side by side: a route that is mounted and missing here, or listed here
 * and never mounted, fails the gate. The order is the order the surfaces
 * appear in the composition root, which is also the order the document lists
 * their paths in.
 *
 * `collectRoutes` refuses a duplicated operation id or a second route on the
 * same method and path, so the registry cannot describe two operations the
 * document would have to give one name.
 */

import {
  checkTokenScopes,
  collectRoutes,
  type RouteDescriptor,
} from "../registry.ts";
import { apiTokenScope } from "../schemas/api_tokens.ts";
import { HEALTH_ROUTES } from "./health.ts";
import { REGISTRATION_ROUTES } from "./registration.ts";
import { AUTHENTICATION_ROUTES } from "./authentication.ts";
import { INVITATIONS_ROUTES } from "./invitations.ts";
import { SETTINGS_ROUTES } from "./settings.ts";
import { API_TOKENS_ROUTES } from "./api_tokens.ts";
import { CALENDAR_FEEDS_ROUTES } from "./calendar_feeds.ts";
import { INTEGRATIONS_ROUTES } from "./integrations.ts";
import { PERSONAL_LIFECYCLE_ROUTES } from "./personal_lifecycle.ts";
import { WORKSPACE_LIFECYCLE_ROUTES } from "./workspace_lifecycle.ts";
import { FILES_ROUTES } from "./files.ts";
import { GIFTS_ROUTES } from "./gifts.ts";
import { JOURNAL_ROUTES } from "./journal.ts";
import { IMPORTS_ROUTES } from "./imports.ts";
import { EXPORTS_ROUTES } from "./exports.ts";
import { PEOPLE_ROUTES } from "./people.ts";
import { SEARCH_ROUTES } from "./search.ts";
import { RELATIONSHIPS_ROUTES } from "./relationships.ts";
import { INTERACTIONS_ROUTES } from "./interactions.ts";
import { GOVERNANCE_ROUTES } from "./governance.ts";
import { PLANNING_ROUTES } from "./planning.ts";
import { MCP_ROUTES } from "./mcp.ts";

/**
 * The routes that accept any valid personal API token and so name no
 * `tokenScope` (MCP-A1): what a token may do is the question they answer.
 * Each is token-only. Adding one is adding its operation id here.
 */
export const ANY_TOKEN_OPERATIONS: readonly string[] = [
  "getTokenContext",
  "mcp",
];

/** The whole mounted surface, probes included. */
export const API_ROUTES: readonly RouteDescriptor[] = checkTokenScopes(
  collectRoutes([
    HEALTH_ROUTES,
    REGISTRATION_ROUTES,
    AUTHENTICATION_ROUTES,
    INVITATIONS_ROUTES,
    SETTINGS_ROUTES,
    API_TOKENS_ROUTES,
    CALENDAR_FEEDS_ROUTES,
    INTEGRATIONS_ROUTES,
    PERSONAL_LIFECYCLE_ROUTES,
    WORKSPACE_LIFECYCLE_ROUTES,
    FILES_ROUTES,
    GIFTS_ROUTES,
    JOURNAL_ROUTES,
    IMPORTS_ROUTES,
    EXPORTS_ROUTES,
    PEOPLE_ROUTES,
    SEARCH_ROUTES,
    RELATIONSHIPS_ROUTES,
    INTERACTIONS_ROUTES,
    GOVERNANCE_ROUTES,
    PLANNING_ROUTES,
    MCP_ROUTES,
  ]),
  { anyToken: ANY_TOKEN_OPERATIONS, scopes: apiTokenScope.options },
);

/** The part of it the published document describes. */
export const DOCUMENTED_ROUTES: readonly RouteDescriptor[] = API_ROUTES.filter(
  (route) => route.undocumented === undefined,
);
