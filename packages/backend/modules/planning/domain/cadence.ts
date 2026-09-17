/**
 * How often a member wants to stay in touch with somebody.
 *
 * A cadence is an interval — every so many days, weeks, months, or years —
 * and a next-due instant derived from the last contact. Both the interval
 * arithmetic and the fingerprint that makes a cadence request idempotent are
 * pure, so they live here rather than in the use case that stores the result.
 *
 * The due instant is computed in the workspace's zone, not in UTC: "in one
 * month" means the same wall-clock moment a month later, which is a calendar
 * question even though the answer is an instant.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import type { RecurrenceUnit } from "./recurrence.ts";
import { MAXIMUM_RECURRENCE_INTERVAL } from "./recurrence.ts";

/** A cadence always repeats, so it cannot be `none`. */
export type CadenceUnit = Exclude<RecurrenceUnit, "none">;

/** The namespace that makes a cadence creation idempotent across retries. */
export const CADENCE_ID_NAMESPACE = "kinship.planning.cadence-id.v1";
/** The namespace the request fingerprint is derived under. */
export const CADENCE_REQUEST_NAMESPACE = "kinship.planning.cadence-request.v1";

/** A stored cadence, as the rules read it. */
export interface StayInTouchCadenceRecord {
  readonly id: string;
  readonly intervalCount: number;
  readonly intervalUnit: CadenceUnit;
  readonly isActive: boolean;
  readonly lastContactedAt?: string;
  readonly nextDueAt: string;
  readonly personId: string;
  readonly updatedAt: string;
}

/** What a member proposes when they ask to stay in touch with somebody. */
export interface CreateCadenceInput {
  readonly intervalCount: number;
  readonly intervalUnit: CadenceUnit;
  readonly personId: string;
  readonly requestId: string;
}

/** The field errors a proposed cadence carries. */
export function validateCreateCadence(
  input: CreateCadenceInput,
): ValidationErrors {
  const errors: Record<string, string> = {};
  if (uuid(input.personId) === undefined) {
    errors.personId = "Choose a person from this workspace.";
  }
  if (uuid(input.requestId) === undefined) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (
    !Number.isInteger(input.intervalCount) || input.intervalCount < 1 ||
    input.intervalCount > MAXIMUM_RECURRENCE_INTERVAL
  ) {
    errors.intervalCount = "Choose an interval from 1 to 100.";
  }
  return errors;
}

/** The instant a cadence falls due, one interval after the last contact. */
export function cadenceDueAt(
  contactedAt: string,
  intervalCount: number,
  intervalUnit: CadenceUnit,
  timezone: string,
): string {
  const contacted = Temporal.Instant.from(contactedAt).toZonedDateTimeISO(
    timezone,
  );
  return contacted.add(
    intervalUnit === "day"
      ? { days: intervalCount }
      : intervalUnit === "week"
      ? { weeks: intervalCount }
      : intervalUnit === "month"
      ? { months: intervalCount }
      : { years: intervalCount },
  ).toInstant().toString();
}

/**
 * What a cadence request asked for, as one comparable string.
 *
 * A replayed request identifier is only the same request when it proposes the
 * same cadence for the same person, so the stored fingerprint is what decides
 * between a replay and a conflict.
 */
export async function cadenceFingerprint(
  input: Pick<
    CreateCadenceInput,
    "intervalCount" | "intervalUnit" | "personId"
  >,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${CADENCE_REQUEST_NAMESPACE}\u0000${input.personId.toLowerCase()}\u0000${input.intervalCount}\u0000${input.intervalUnit}`,
    ),
  );
  return [...new Uint8Array(digest)].map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
