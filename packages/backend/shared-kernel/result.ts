/**
 * Result primitives.
 *
 * Use cases report outcomes as `status`-discriminated unions, never as thrown
 * exceptions. Forty-eight of those unions had each spelled the same failure
 * literals out again, so the vocabulary lives here and a module composes its
 * own union from it instead of redeclaring the strings.
 *
 * A module selects the shared statuses it can actually raise rather than
 * inheriting all of them: the delivery layer narrows a result down to its
 * success case after handling each failure, and a status the use case never
 * returns would make that narrowing impossible.
 */

/** Every failure status the backend shares, in one place. */
export const SHARED_FAILURE_STATUSES = [
  "archived-write-rejected",
  "conflict",
  "forbidden",
  "not-found",
  "unavailable",
  "validation-error",
] as const;

export type SharedFailureStatus = typeof SHARED_FAILURE_STATUSES[number];

/** The shared statuses that carry nothing but themselves. */
export type SharedFailureCode = Exclude<
  SharedFailureStatus,
  "validation-error"
>;

/** Field name to the message shown against that field. */
export type ValidationErrors = Readonly<Record<string, string>>;

/** The one shape of a rejected input, carried by every module. */
export interface ValidationFailure {
  readonly errors: ValidationErrors;
  readonly status: "validation-error";
}

/**
 * One member per status, so the delivery layer can narrow a result down by
 * eliminating failures one `status` check at a time.
 */
type FailureMember<Status extends string> = Status extends string
  ? { readonly status: Status }
  : never;

/**
 * A failure union built from the shared vocabulary.
 *
 * `Shared` names the shared statuses this use case raises and `Extra` adds the
 * ones only it knows, such as `stale` or `confirmation-required`. A module that
 * also rejects input unions the result with `ValidationFailure`.
 */
export type Failure<
  Shared extends SharedFailureCode = SharedFailureCode,
  Extra extends string = never,
> = FailureMember<Shared | Extra>;
