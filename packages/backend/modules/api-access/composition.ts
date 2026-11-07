/**
 * API-access composition.
 *
 * Only a declared composition root imports this file. The throttle keyset
 * arrives as a port: which keyset a deployment runs with is a root's decision.
 * So do the issuers' names the workspace-wide token list shows, which identity
 * owns.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { WebCryptoApiTokenSecrets } from "./adapters/crypto/api_token_secrets.ts";
import {
  PostgresApiTokenRepository,
  PostgresApiTokenTransaction,
  PostgresCalendarFeedRepository,
} from "./adapters/postgres/api_token_repository.ts";
import { PostgresAuthenticationAttemptBudget } from "./adapters/postgres/authentication_attempt_budget.ts";
import {
  apiTokenAuditFrom,
  AuthenticationSubjectDigester,
  type AuthenticationSubjectKeyset,
  createApiTokenManagement,
  createCalendarFeedTokens,
  SignInDeviceTokens,
} from "./public.ts";
import type { ApiTokenIssuers } from "./ports/issuers.ts";

export interface ApiAccessPorts {
  /** Signs sign-in device tokens (AUD-A3); never the subject keyset. */
  readonly deviceKeyset: AuthenticationSubjectKeyset;
  readonly issuers: ApiTokenIssuers;
  readonly subjectKeyset: AuthenticationSubjectKeyset;
}

export function composeApiAccess(
  shared: SharedComposition,
  ports: ApiAccessPorts,
) {
  const digester = new AuthenticationSubjectDigester(ports.subjectKeyset);
  const signInDevices = new SignInDeviceTokens(ports.deviceKeyset, digester);
  const tokens = {
    actorContext: shared.actors,
    actors: shared.actors,
    audit: apiTokenAuditFrom(shared.audit),
    clock: shared.clock,
    ids: { next: () => shared.ids.create() },
    issuers: ports.issuers,
    repository: new PostgresApiTokenRepository(),
    secrets: new WebCryptoApiTokenSecrets(),
    transaction: new PostgresApiTokenTransaction(shared.database),
  };
  return {
    apiTokens: createApiTokenManagement(tokens),
    /** Each member's calendar feed secret (GAP-052, `INTEGRATION-002`). */
    calendarFeeds: createCalendarFeedTokens({
      ...tokens,
      calendarFeeds: new PostgresCalendarFeedRepository(),
    }),
    /** The shared sign-in throttle, which workspaces' session flows consume. */
    attemptBudget: new PostgresAuthenticationAttemptBudget(
      shared.database,
      digester,
      signInDevices,
    ),
    /** The device tokens the budget recognizes, issued after a sign-in. */
    signInDevices,
  };
}
