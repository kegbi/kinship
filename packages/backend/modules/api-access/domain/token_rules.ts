/**
 * What a personal access token is, and when one still works.
 *
 * A token is a credential a member pastes into somebody else's program, so
 * three of the rules here exist to make it safe to lose. Its text carries the
 * row's identifier in front of the secret, so a presented token can be looked
 * up in one indexed read rather than compared against every hash in the table.
 * Its scopes are a closed vocabulary, so a token cannot be minted for a
 * permission that does not exist yet. And it expires, if the member said it
 * should, in the future — a token that expired the moment it was created would
 * be a silently useless one.
 *
 * `usable` is the read side of the same decision, and what it deliberately
 * does not do is check the secret. Comparing a secret against its hash costs
 * real work, and everything cheap that could refuse the token — revoked,
 * expired, the wrong scope, the wrong workspace — is decided here first so the
 * caller only pays that cost for a token that is otherwise good.
 */

/** Every permission a personal access token may carry. */
export const API_TOKEN_SCOPES = ["people:read"] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

/**
 * The one permission a calendar feed's secret carries (GAP-052,
 * `INTEGRATION-002`). It is never offered to a personal access token: a feed
 * is minted by its own use case, one per member and workspace, and read by a
 * calendar application that can only put the secret in a URL.
 */
export const CALENDAR_FEED_SCOPE = "calendar.read" as const;

/** Every scope a stored token row may carry. */
export type StoredTokenScope = ApiTokenScope | typeof CALENDAR_FEED_SCOPE;

/** The name a calendar feed's token row is stored under. */
export const CALENDAR_FEED_TOKEN_NAME = "Calendar feed";

/**
 * How stale a token's recorded last use may grow before an accepted use writes
 * it again (REL-067). A calendar application polls its feed every few minutes,
 * and writing the row on every fetch would cost an update and a dead tuple
 * each time; the owner only needs to know roughly when the token was last
 * used, so its "last used" is at most this far behind.
 */
export const TOKEN_USE_RECORD_INTERVAL_MS = 15 * 60_000;

/** The standing a token is created and listed under. */
export type ApiTokenRole = "owner" | "admin" | "member";

/** One token, as its owner sees it listed; the secret is never in here. */
export interface ApiTokenRecord {
  readonly createdAt: string;
  readonly expiresAt?: string;
  readonly id: string;
  readonly lastUsedAt?: string;
  readonly name: string;
  readonly revokedAt?: string;
  readonly scopes: readonly StoredTokenScope[];
}

/** A member's calendar feed, as its settings section shows it. */
export interface CalendarFeedRecord {
  readonly createdAt: string;
  readonly id: string;
  readonly lastUsedAt?: string;
}

/** What a member asks for when they mint a token. */
export interface ApiTokenInput {
  readonly expiresAt?: string;
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
}

/** The canonical token a write proceeds with. */
export interface ApiTokenValues {
  readonly expiresAt?: Date;
  readonly name: string;
  readonly scopes: readonly ApiTokenScope[];
}

/**
 * The text of a presented token: a prefix, the row's identifier, and the
 * secret. The identifier must be a random version 4 one, because that is the
 * only kind this module mints.
 */
const TOKEN_PATTERN =
  /^kin_pat_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,128})$/i;

/** The same shape for a calendar feed, under its own prefix. */
const FEED_TOKEN_PATTERN =
  /^kin_cal_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,128})$/i;

/** Tokens are an administrative facility; a member neither mints nor sees one. */
export function privileged(actor: { readonly role: ApiTokenRole }): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/** The identifier and the secret inside a presented token, or nothing. */
export function parseToken(
  rawToken: string,
): { readonly id: string; readonly secret: string } | undefined {
  const matched = TOKEN_PATTERN.exec(rawToken);
  if (!matched?.[1] || !matched[2]) return undefined;
  return { id: matched[1], secret: matched[2] };
}

/** The one text a member is ever shown, at the moment the token is minted. */
export function renderToken(id: string, secret: string): string {
  return `kin_pat_${id}.${secret}`;
}

/** The identifier and the secret inside a presented feed secret, or nothing. */
export function parseCalendarFeedToken(
  rawToken: string,
): { readonly id: string; readonly secret: string } | undefined {
  const matched = FEED_TOKEN_PATTERN.exec(rawToken);
  if (!matched?.[1] || !matched[2]) return undefined;
  return { id: matched[1], secret: matched[2] };
}

/** A calendar feed's secret, as its URL carries it. */
export function renderCalendarFeedToken(id: string, secret: string): string {
  return `kin_cal_${id}.${secret}`;
}

/**
 * The canonical token, or nothing when the member has to fix something.
 *
 * Scopes are de-duplicated and a repeated scope is refused rather than
 * quietly collapsed: a caller that sent the same permission twice did not
 * describe what it meant, and a token is not the place to guess.
 */
export function validateApiToken(
  input: ApiTokenInput,
  now: Date,
): ApiTokenValues | undefined {
  const name = input.name.trim();
  const scopes = [...new Set(input.scopes)];
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
  if (
    name.length < 1 || name.length > 100 || scopes.length < 1 ||
    scopes.length !== input.scopes.length ||
    scopes.some((scope) => !API_TOKEN_SCOPES.includes(scope)) ||
    (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now))
  ) return undefined;
  return { ...(expiresAt ? { expiresAt } : {}), name, scopes };
}

/** Everything about a presented token that can be decided without hashing. */
export function usable(command: {
  readonly now: Date;
  readonly record: ApiTokenRecord;
  readonly requestedWorkspaceId?: string;
  readonly requiredScope: StoredTokenScope;
  readonly workspaceId: string;
}): boolean {
  const { now, record, requestedWorkspaceId, requiredScope } = command;
  return !record.revokedAt &&
    (!record.expiresAt || Date.parse(record.expiresAt) > now.getTime()) &&
    record.scopes.includes(requiredScope) &&
    (!requestedWorkspaceId || command.workspaceId === requestedWorkspaceId);
}
