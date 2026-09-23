/**
 * What more than one settings concern needs.
 *
 * GAP-021 split the settings surface into one file per concern. Three things
 * could not follow a single concern: the service bundle `composition.ts`
 * builds once, the private-read helper every surface answers through, and the
 * two sentences a rejected zone or currency is named with, which the member's
 * preferences and the workspace's defaults both print. The shape of a zone
 * and of a locale used to be here too; GAP-022 moved both to
 * `packages/contracts/schemas/settings.ts`, beside the bodies that carry
 * them.
 *
 * Each concern narrows `SettingsHttpServices` with `Pick`, so a file can
 * reach only the services its own routes use.
 */

import { type Context } from "hono";
import type {
  createProtectedSessionCoordinator,
  MemberUiStateManagement,
  PersonalizationManagement,
  SettingsManagement,
} from "../../../public.ts";
import type { BrowserSecurityPolicy } from "../../../../../../http-kit/security_policy.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface SettingsHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly memberUiState: MemberUiStateManagement;
  readonly personalization: PersonalizationManagement;
  readonly protectedSessions: ProtectedSessions;
  readonly settings: SettingsManagement;
}

/** The message a time zone the calendar cannot resolve is refused with. */
export const INVALID_TIMEZONE_MESSAGE = "Enter a valid IANA time zone.";
/** The message an unsupported currency is refused with. */
export const INVALID_CURRENCY_MESSAGE = "Choose a supported currency.";

/** A private read, which is never cached anywhere. */
export function privateJson(context: Context, value: unknown): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json(value);
}
