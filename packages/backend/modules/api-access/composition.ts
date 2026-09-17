/**
 * API-access composition.
 *
 * Only a declared composition root imports this file. The throttle keyset
 * arrives as a port: which keyset a deployment runs with is a root's decision.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { WebCryptoApiTokenSecrets } from "./adapters/crypto/api_token_secrets.ts";
import {
  PostgresApiTokenRepository,
  PostgresApiTokenTransaction,
} from "./adapters/postgres/api_token_repository.ts";
import { PostgresAuthenticationAttemptBudget } from "./adapters/postgres/authentication_attempt_budget.ts";
import {
  apiTokenAuditFrom,
  AuthenticationSubjectDigester,
  type AuthenticationSubjectKeyset,
  createApiTokenManagement,
} from "./public.ts";

export interface ApiAccessPorts {
  readonly subjectKeyset: AuthenticationSubjectKeyset;
}

export function composeApiAccess(
  shared: SharedComposition,
  ports: ApiAccessPorts,
) {
  return {
    apiTokens: createApiTokenManagement({
      actorContext: shared.actors,
      actors: shared.actors,
      audit: apiTokenAuditFrom(shared.audit),
      clock: shared.clock,
      ids: { next: () => shared.ids.create() },
      repository: new PostgresApiTokenRepository(),
      secrets: new WebCryptoApiTokenSecrets(),
      transaction: new PostgresApiTokenTransaction(shared.database),
    }),
    /** The shared sign-in throttle, which workspaces' session flows consume. */
    attemptBudget: new PostgresAuthenticationAttemptBudget(
      shared.database,
      new AuthenticationSubjectDigester(ports.subjectKeyset),
    ),
  };
}
