import type { Failure } from "../../../shared-kernel/result.ts";
import { isUuid } from "../../../shared-kernel/validation.ts";

export interface AuditHistoryActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface AuditDateDetail {
  readonly isYearApproximate: boolean;
  readonly precision:
    | "day"
    | "full"
    | "month"
    | "month_day"
    | "unknown"
    | "year"
    | "year_month";
}

export type AuditDetail =
  | boolean
  | string
  | null
  | readonly string[]
  | AuditDateDetail;

export interface AuditHistoryRepositoryItem {
  readonly action: string;
  readonly actor: { readonly id?: string; readonly name: string };
  readonly id: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly person?: { readonly id: string; readonly name: string };
  readonly subject: { readonly id?: string; readonly type?: string };
}

export interface AuditHistoryItem
  extends Omit<AuditHistoryRepositoryItem, "payload"> {
  readonly details: Readonly<Record<string, AuditDetail>>;
  readonly redacted: boolean;
}

export interface AuditHistoryRepository {
  list(
    command: AuditHistoryActor & {
      readonly action?: string;
      readonly actorMemberId?: string;
      readonly after?: { readonly id: string; readonly timestamp: string };
      readonly from?: string;
      readonly limit: number;
      readonly personId?: string;
      readonly to?: string;
    },
  ): Promise<
    | {
      readonly items: readonly AuditHistoryRepositoryItem[];
      readonly next?: { readonly id: string; readonly timestamp: string };
      readonly person?: { readonly id: string; readonly name: string };
      readonly status: "archived" | "ready";
    }
    | Failure<"forbidden" | "not-found", "stale-cursor">
  >;
}

const CHANGE_ACTION_VALUES = new Set([
  "create",
  "delete",
  "update",
]);
const COMMUNICATION_KIND_VALUES = new Set(["call", "conversation"]);
const INTERACTION_KIND_VALUES = new Set(["activity", "note"]);
/** What an edit or a removal of an interaction may name (MCP-D1). */
const INTERACTION_CHANGE_ACTION_VALUES = new Set(["delete", "update"]);
const INTERACTION_CHANGE_KIND_VALUES = new Set([
  "activity",
  "call",
  "conversation",
  "note",
]);
const INTERACTION_CHANGE_FIELD_VALUES = new Set([
  "activityTypeId",
  "body",
  "calledAt",
  "channelTypeId",
  "contactMethodId",
  "contactWasCaller",
  "content",
  "description",
  "emotionIds",
  "happenedAt",
  "isFavorited",
  "messages",
  "participantIds",
  "summary",
  "title",
]);
const LIFECYCLE_VALUES = new Set(["active", "archived", "deleted"]);
const PROFILE_ACTION_VALUES = new Set(["delete", "save"]);
const TASK_ACTION_VALUES = new Set([
  "changed",
  "completed",
  "created",
  "deleted",
  "reopened",
]);
const TASK_STATUS_VALUES = new Set(["cancelled", "completed", "open"]);
const PERSONALIZATION_SECTION_VALUES = new Set([
  "activity-types",
  "contact-labels",
  "contact-method-types",
  "emotion-options",
  "gender-options",
  "life-event-types",
  "pet-categories",
  "profile-modules",
  "relationship-types",
  "reminder-rules",
  "tags",
]);
const PRECISION_VALUES = new Set([
  "day",
  "full",
  "month",
  "month_day",
  "unknown",
  "year",
  "year_month",
]);
const SECTION_VALUES = new Set([
  "activity-types",
  "addresses",
  "contact-labels",
  "contact-method-types",
  "contact-methods",
  "emotion-options",
  "first-meeting",
  "food-preferences",
  "gender-options",
  "identity-summary",
  "life-event-types",
  "pet-categories",
  "pets",
  "profile-modules",
  "relationship-types",
  "reminder-rules",
  "security",
  "tags",
  "work",
]);
const STATUS_VALUES = new Set([
  "active",
  "suspended",
]);
const ROLE_VALUES = new Set(["admin", "member", "owner"]);
const RELATIONSHIP_UUID_KEYS = new Set([
  "fromPersonId",
  "relationshipTypeId",
  "toPersonId",
]);

type SanitizedDetail =
  | { readonly accepted: false; readonly redacted: boolean }
  | {
    readonly accepted: true;
    readonly redacted: boolean;
    readonly value: AuditDetail;
  };

function enumDetail(
  value: unknown,
  accepted: ReadonlySet<string>,
): SanitizedDetail {
  return typeof value === "string" && accepted.has(value)
    ? { accepted: true, redacted: false, value }
    : { accepted: false, redacted: true };
}

function transitionDetail(value: unknown): SanitizedDetail {
  if (value === null) return { accepted: true, redacted: false, value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { accepted: false, redacted: true };
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.isYearApproximate !== "boolean" ||
    typeof record.precision !== "string" ||
    !PRECISION_VALUES.has(record.precision)
  ) return { accepted: false, redacted: true };
  return {
    accepted: true,
    redacted: Object.keys(record).some((key) =>
      key !== "isYearApproximate" && key !== "precision"
    ),
    value: {
      isYearApproximate: record.isYearApproximate,
      precision: record.precision as AuditDateDetail["precision"],
    },
  };
}

function booleanDetail(value: unknown): SanitizedDetail {
  return typeof value === "boolean"
    ? { accepted: true, redacted: false, value }
    : { accepted: false, redacted: true };
}

function uuidDetail(value: unknown): SanitizedDetail {
  return typeof value === "string" && isUuid(value)
    ? { accepted: true, redacted: false, value }
    : { accepted: false, redacted: true };
}

function sanitizeDetail(
  eventAction: string,
  key: string,
  value: unknown,
): SanitizedDetail {
  // The request or job run that caused the event (GAP-039) is operational
  // correlation the governance writer adds to every correlated payload. It is
  // not product history, so it is dropped without marking the event redacted.
  // So is the personal API token a change was made with (MCP-A1): it names a
  // credential for operators, not something that happened to a person.
  if (key === "requestId" || key === "apiTokenId") {
    return { accepted: false, redacted: false };
  }
  if (eventAction === "people.person-created" && key === "isPartial") {
    return booleanDetail(value);
  }
  if (eventAction === "people.person-date-updated") {
    if (key === "action") return enumDetail(value, CHANGE_ACTION_VALUES);
    if (key === "from" || key === "to") return transitionDetail(value);
  }
  if (eventAction === "people.person-profile-fact-updated") {
    if (key === "action") return enumDetail(value, PROFILE_ACTION_VALUES);
    if (key === "section") return enumDetail(value, SECTION_VALUES);
  }
  if (
    (eventAction === "people.person-archived" ||
      eventAction === "people.person-restored" ||
      eventAction === "people.person-deleted" ||
      eventAction === "people.person-updated") &&
    (key === "from" || key === "to")
  ) {
    return enumDetail(value, LIFECYCLE_VALUES);
  }
  if (eventAction === "interactions.communication-created") {
    if (key === "kind") {
      return enumDetail(value, COMMUNICATION_KIND_VALUES);
    }
    if (key === "personId") return uuidDetail(value);
  }
  if (eventAction === "interactions.interaction-changed") {
    if (key === "action") {
      return enumDetail(value, INTERACTION_CHANGE_ACTION_VALUES);
    }
    if (key === "kind") {
      return enumDetail(value, INTERACTION_CHANGE_KIND_VALUES);
    }
    if (key === "fields") {
      return Array.isArray(value) && value.length <= 20 &&
          value.every((entry) =>
            typeof entry === "string" &&
            INTERACTION_CHANGE_FIELD_VALUES.has(entry)
          )
        ? { accepted: true, redacted: false, value: [...value] as string[] }
        : { accepted: false, redacted: true };
    }
  }
  if (
    eventAction === "interactions.interaction-or-note-created" ||
    eventAction === "interactions.interaction-changed"
  ) {
    if (
      eventAction === "interactions.interaction-or-note-created" &&
      key === "kind"
    ) return enumDetail(value, INTERACTION_KIND_VALUES);
    if (key === "participantIds") {
      return Array.isArray(value) && value.length <= 50 &&
          value.every((entry) => typeof entry === "string" && isUuid(entry))
        ? {
          accepted: true,
          redacted: false,
          value: [...value] as string[],
        }
        : { accepted: false, redacted: true };
    }
  }
  if (eventAction === "relationships.relationship-changed") {
    if (key === "action") return enumDetail(value, CHANGE_ACTION_VALUES);
    if (RELATIONSHIP_UUID_KEYS.has(key)) return uuidDetail(value);
  }
  if (eventAction === "planning.task-created-or-state-changed") {
    if (key === "action") return enumDetail(value, TASK_ACTION_VALUES);
    if (key === "status") return enumDetail(value, TASK_STATUS_VALUES);
  }
  if (eventAction === "identity.session-revoked" && key === "current") {
    return booleanDetail(value);
  }
  if (eventAction === "workspace.member-updated") {
    if (key === "role") return enumDetail(value, ROLE_VALUES);
    if (key === "status") return enumDetail(value, STATUS_VALUES);
  }
  if (eventAction === "workspace-personalization-updated") {
    if (key === "action") return enumDetail(value, CHANGE_ACTION_VALUES);
    if (key === "section") {
      return enumDetail(value, PERSONALIZATION_SECTION_VALUES);
    }
  }
  return { accepted: false, redacted: true };
}

function redact(
  eventAction: string,
  payload: Readonly<Record<string, unknown>>,
): {
  readonly details: Readonly<Record<string, AuditDetail>>;
  readonly redacted: boolean;
} {
  const safe: Record<string, AuditDetail> = {};
  let redacted = false;
  for (const [key, value] of Object.entries(payload)) {
    const detail = sanitizeDetail(eventAction, key, value);
    redacted ||= detail.redacted;
    if (detail.accepted) safe[key] = detail.value;
  }
  return {
    details: safe,
    redacted,
  };
}

interface CursorBody {
  readonly action: string | null;
  readonly actorMemberId: string | null;
  readonly from: string | null;
  readonly id: string;
  readonly personId: string | null;
  readonly timestamp: string;
  readonly to: string | null;
  readonly version: 1;
  readonly workspaceId: string;
}

export interface AuditCursorKeyset {
  readonly activeVersion: number;
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  try {
    const decoded = Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
    return base64Url(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
}

async function hmacKey(
  bytes: Uint8Array,
  usage: "sign" | "verify",
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes).buffer,
    { hash: "SHA-256", name: "HMAC" },
    false,
    [usage],
  );
}

async function encodeCursor(
  body: CursorBody,
  keyset: AuditCursorKeyset,
): Promise<string> {
  const keyVersion = keyset.activeVersion;
  const keyBytes = keyset.keys.get(keyVersion);
  if (!keyBytes) throw new Error("Active audit cursor key is unavailable.");
  const encodedBody = base64Url(
    new TextEncoder().encode(JSON.stringify(body)),
  );
  const signed = `v1.v${keyVersion}.${encodedBody}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(keyBytes, "sign"),
    new TextEncoder().encode(`kinship.audit-history.cursor.v1\n${signed}`),
  );
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

async function decodeCursor(
  cursor: string,
  expected: Omit<CursorBody, "id" | "timestamp" | "version">,
  keyset: AuditCursorKeyset,
): Promise<{ readonly id: string; readonly timestamp: string } | undefined> {
  try {
    const [format, keyLabel, encodedBody, encodedSignature, extra] = cursor
      .split(".");
    const keyMatch = /^v([1-9][0-9]*)$/.exec(keyLabel ?? "");
    if (
      format !== "v1" || !keyMatch || !encodedBody || !encodedSignature || extra
    ) {
      return undefined;
    }
    const keyVersion = Number(keyMatch[1]);
    if (!Number.isSafeInteger(keyVersion) || `v${keyVersion}` !== keyLabel) {
      return undefined;
    }
    const keyBytes = keyset.keys.get(keyVersion);
    const bodyBytes = decodeBase64Url(encodedBody);
    const signature = decodeBase64Url(encodedSignature);
    if (!keyBytes || !bodyBytes || signature?.length !== 32) return undefined;
    const signed = `${format}.${keyLabel}.${encodedBody}`;
    const authentic = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(keyBytes, "verify"),
      new Uint8Array(signature).buffer,
      new TextEncoder().encode(`kinship.audit-history.cursor.v1\n${signed}`),
    );
    if (!authentic) return undefined;
    const decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes),
    ) as Record<string, unknown>;
    if (
      decoded.version !== 1 || decoded.workspaceId !== expected.workspaceId ||
      decoded.personId !== expected.personId ||
      decoded.actorMemberId !== expected.actorMemberId ||
      decoded.action !== expected.action || decoded.from !== expected.from ||
      decoded.to !== expected.to || typeof decoded.id !== "string" ||
      !isUuid(decoded.id) ||
      typeof decoded.timestamp !== "string" ||
      !Number.isFinite(Date.parse(decoded.timestamp))
    ) return undefined;
    return { id: decoded.id, timestamp: decoded.timestamp };
  } catch {
    return undefined;
  }
}

export function createAuditHistory(dependencies: {
  readonly cursorKeyset: AuditCursorKeyset;
  readonly repository: AuditHistoryRepository;
}) {
  return {
    async list(
      actor: AuditHistoryActor,
      input: {
        readonly action?: string;
        readonly actorMemberId?: string;
        readonly cursor?: string;
        readonly from?: string;
        readonly limit?: number;
        readonly personId?: string;
        readonly to?: string;
      } = {},
    ) {
      if (actor.role !== "owner" && actor.role !== "admin") {
        return { status: "forbidden" as const };
      }
      const cursorScope = {
        action: input.action ?? null,
        actorMemberId: input.actorMemberId ?? null,
        from: input.from ?? null,
        personId: input.personId ?? null,
        to: input.to ?? null,
        workspaceId: actor.workspaceId,
      };
      const after = input.cursor
        ? await decodeCursor(
          input.cursor,
          cursorScope,
          dependencies.cursorKeyset,
        )
        : undefined;
      if (input.cursor && !after) return { status: "stale-cursor" as const };
      const result = await dependencies.repository.list({
        ...actor,
        ...(input.action ? { action: input.action } : {}),
        ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
        ...(after ? { after } : {}),
        ...(input.from ? { from: input.from } : {}),
        limit: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
        ...(input.personId ? { personId: input.personId } : {}),
        ...(input.to ? { to: input.to } : {}),
      });
      if (!("items" in result)) return result;
      return {
        items: result.items.map(({ payload, ...item }) => ({
          ...item,
          ...redact(item.action, payload),
        })),
        ...(result.next
          ? {
            nextCursor: await encodeCursor(
              {
                ...cursorScope,
                ...result.next,
                version: 1,
              },
              dependencies.cursorKeyset,
            ),
          }
          : {}),
        ...(result.person ? { person: result.person } : {}),
        status: result.status,
      };
    },
  };
}

export type AuditHistory = ReturnType<typeof createAuditHistory>;
