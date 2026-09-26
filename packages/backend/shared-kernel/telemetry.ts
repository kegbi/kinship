/**
 * The telemetry port every layer may log through.
 *
 * A use case has to be able to say what happened to a request or a job, yet
 * the layer rule keeps `application/` away from `packages/backend/platform`,
 * where the adapter that writes the line lives. So the contract lives here, in
 * the kernel every layer may import, and the adapter implements it at a
 * composition root: the kernel declares what a line may contain, and never
 * writes one.
 *
 * The catalogue is closed. Each event names its fields and the class of value
 * each field holds, and nothing else is loggable: there is no free-form
 * message, no `error.message`, no header, no query string, and no field for a
 * person or a workspace. A failure is described by a stable code. The adapter
 * enforces the same catalogue at runtime, so a field a caller smuggles in
 * through a cast or a spread is stripped before it reaches the stream.
 */

/**
 * What ties one request or one job run together across the gateway, the API,
 * the use case it reaches, and the audit row it writes. It is an opaque
 * identifier the gateway or the process minted, never a person or a workspace.
 */
export interface Correlation {
  readonly requestId?: string | undefined;
}

/** The correlation a source carries, spelled as a member that may be absent. */
export function correlationOf(
  source: Correlation,
): { readonly requestId?: string } {
  return source.requestId ? { requestId: source.requestId } : {};
}

/** One API request, answered or failed, as the HTTP kit reports it. */
export interface ApiRequestEvent {
  readonly event: "api.request";
  readonly method: string;
  /** The registered route pattern, never the path that matched it. */
  readonly route: string;
  readonly status: number;
  readonly duration_ms: number;
  readonly request_id?: string;
}

/** One run of one worker job: a unit of durable work and how it ended. */
export interface WorkerJobEvent {
  readonly event: "worker.job";
  readonly job: string;
  readonly request_id: string;
  readonly attempt: number;
  /** A stable outcome code, never an error message. */
  readonly outcome: string;
  readonly duration_ms: number;
}

/** Every event a process may log. */
export type LogEvent = ApiRequestEvent | WorkerJobEvent;

/** The event names the catalogue declares. */
export type LogEventName = LogEvent["event"];

/**
 * The classes of value a declared field may hold.
 *
 * - `code`: a short, lower-case, stable token such as an outcome or a job name;
 * - `count`: a non-negative integer;
 * - `method`: an upper-case HTTP method;
 * - `milliseconds`: a non-negative integer duration;
 * - `request-id`: the correlation token the request-ID rule accepts;
 * - `route`: a registered route template, never a concrete path;
 * - `status`: an HTTP status code.
 */
export type LogFieldClass =
  | "code"
  | "count"
  | "method"
  | "milliseconds"
  | "request-id"
  | "route"
  | "status";

/** Each event's fields, in the order a line prints them, and their classes. */
export type LogEventShapes = {
  readonly [Name in LogEventName]: {
    readonly [
      Field in Exclude<keyof Extract<LogEvent, { event: Name }>, "event">
    ]-?: LogFieldClass;
  };
};

/** The catalogue itself, which the adapter enforces field by field. */
export const LOG_EVENT_SHAPES: LogEventShapes = {
  "api.request": {
    method: "method",
    route: "route",
    status: "status",
    duration_ms: "milliseconds",
    request_id: "request-id",
  },
  "worker.job": {
    job: "code",
    request_id: "request-id",
    attempt: "count",
    outcome: "code",
    duration_ms: "milliseconds",
  },
};

/** Where a structured event goes. */
export interface Logger {
  log(event: LogEvent): void;
}

/** A logger that drops everything, for a composition with no destination. */
export function silentLogger(): Logger {
  return { log: () => undefined };
}
