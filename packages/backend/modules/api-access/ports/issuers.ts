/**
 * The names behind the workspace-wide token list (SECT-07).
 *
 * `identity` owns users and `api-access` may not read its tables, so the one
 * question the list asks — who are these issuers — is declared here and the
 * composition root answers it with identity's display summaries. Nothing here
 * hands back a credential or an identity the caller did not already name.
 */

import type { ApiTokenIssuer } from "../domain/token_rules.ts";
import type { ApiTokenTransaction } from "./context.ts";

export interface ApiTokenIssuers {
  listIdentityDisplaySummaries(command: {
    readonly transaction: ApiTokenTransaction;
    readonly userIds: readonly string[];
  }): Promise<readonly (ApiTokenIssuer & { readonly userId: string })[]>;
}
