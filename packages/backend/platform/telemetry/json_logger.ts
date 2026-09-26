/**
 * The JSON-lines adapter for the kernel's `Logger` port.
 *
 * One event is one line of JSON on stdout, which is what the private
 * production profile collects locally (`telemetry.localStructuredLogs`) and
 * never exports to a third party. Before a line is written it is redacted
 * against the kernel's closed catalogue, `LOG_EVENT_SHAPES`:
 *
 * - an event the catalogue does not declare is refused and nothing is written;
 * - a field the event does not declare is stripped, whatever it holds, so an
 *   authorization header, a cookie, a query string, a person or workspace
 *   identifier, or an `error.message` smuggled in through a cast or a spread
 *   never reaches the stream;
 * - a declared field whose value is not of its declared class is stripped
 *   too: a route that carries a query string or an identifier, or a code that
 *   carries free-form text, is not a route or a code.
 *
 * Declared fields print in catalogue order, so the `api.request` line keeps
 * the byte-for-byte shape it had before the port existed.
 *
 * `forbiddenLogData` in `docs/planning/private-production-profile.json` names
 * the value classes this refuses; `observability.md` lists the catalogue.
 */

import {
  LOG_EVENT_SHAPES,
  type LogEvent,
  type LogEventName,
  type LogFieldClass,
  type Logger,
} from "../../shared-kernel/telemetry.ts";

/** A line as it is written: declared fields with safe values only. */
export type RedactedLogLine = Readonly<Record<string, string | number>>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODE = /^[a-z][a-z0-9_.-]{0,63}$/;
const METHOD = /^[A-Z]{1,16}$/;
const REQUEST_ID = /^[\w-]{1,128}$/;
const ROUTE = /^(?:\/[\w.:*-]*)+$/;
const UNMATCHED_ROUTE = "unmatched";

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) &&
    value >= 0;
}

/** Whether `value` belongs to the class its field declares. */
export function acceptsLogValue(
  fieldClass: LogFieldClass,
  value: unknown,
): value is string | number {
  switch (fieldClass) {
    case "count":
    case "milliseconds":
      return isNonNegativeInteger(value);
    case "status":
      return isNonNegativeInteger(value) && value >= 100 && value <= 599;
    case "method":
      return typeof value === "string" && METHOD.test(value);
    case "request-id":
      return typeof value === "string" && REQUEST_ID.test(value);
    case "code":
      return typeof value === "string" && CODE.test(value) && !UUID.test(value);
    case "route":
      return typeof value === "string" &&
        (value === UNMATCHED_ROUTE ||
          (value.length <= 256 && ROUTE.test(value) && !UUID.test(value)));
  }
}

function isDeclared(name: unknown): name is LogEventName {
  return typeof name === "string" && Object.hasOwn(LOG_EVENT_SHAPES, name);
}

/**
 * The line an event may be written as, or `undefined` when the catalogue does
 * not declare the event at all.
 */
export function redactLogEvent(
  candidate: LogEvent,
): RedactedLogLine | undefined {
  const source = candidate as unknown as Readonly<Record<string, unknown>>;
  const name = source.event;
  if (!isDeclared(name)) return undefined;
  const line: Record<string, string | number> = { event: name };
  const shape: Readonly<Record<string, LogFieldClass>> = LOG_EVENT_SHAPES[name];
  for (const [field, fieldClass] of Object.entries(shape)) {
    const value = source[field];
    if (acceptsLogValue(fieldClass, value)) line[field] = value;
  }
  return line;
}

/** Writes a line to this process's stdout. */
function stdoutWriter(): (line: string) => void {
  const encoder = new TextEncoder();
  return (line) => {
    Deno.stdout.writeSync(encoder.encode(line));
  };
}

/**
 * The deployment logger: one redacted JSON line per event. A test passes its
 * own `write` to read the exact bytes a deployment would print.
 */
export function jsonLogger(
  write: (line: string) => void = stdoutWriter(),
): Logger {
  return {
    log(event) {
      const line = redactLogEvent(event);
      if (line) write(`${JSON.stringify(line)}\n`);
    },
  };
}
