/**
 * What more than one settings concern needs.
 *
 * GAP-021 split the settings surface into one file per concern. Four things
 * could not follow a single concern: the service bundle `composition.ts`
 * builds once, the private-read helper every surface answers through, the
 * shape of a time zone and a locale — which the member's preferences and the
 * workspace's defaults both accept — and the two sentences a rejected zone or
 * currency is named with, which both of them print.
 *
 * Each concern narrows `SettingsHttpServices` with `Pick`, so a file can
 * reach only the services its own routes use.
 */

import { type Context } from "hono";
import { z } from "zod";
import type {
  createProtectedSessionCoordinator,
  MemberUiStateManagement,
  PersonalizationManagement,
  SettingsManagement,
} from "../../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "../security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface SettingsHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly memberUiState: MemberUiStateManagement;
  readonly personalization: PersonalizationManagement;
  readonly protectedSessions: ProtectedSessions;
  readonly settings: SettingsManagement;
}

/**
 * The shape of a time zone, not its meaning.
 *
 * Whether the calendar can actually schedule in it is the settings use case's
 * question, because a stored zone decides when every reminder a member or
 * workspace owns comes due.
 */
export const timezone = z.string().trim().min(1).max(100);
export const locale = z.string().trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  .max(35);

/** The message a time zone the calendar cannot resolve is refused with. */
export const INVALID_TIMEZONE_MESSAGE = "Enter a valid IANA time zone.";
/** The message an unsupported currency is refused with. */
export const INVALID_CURRENCY_MESSAGE = "Choose a supported currency.";

/** A private read, which is never cached anywhere. */
export function privateJson(context: Context, value: unknown): Response {
  context.header("Cache-Control", "private, no-store");
  return context.json(value);
}
