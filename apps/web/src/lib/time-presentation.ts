import { resolveWorkspaceSession } from "./workspace-context.ts";

export interface TimePreferences {
  readonly locale: string;
  readonly effectiveTimezone: string;
}

/**
 * The member's time preferences in `workspaceId`, from the document's session
 * (AUD-F3), for an island handed its workspace rather than resolving it. A
 * session of another workspace answers nothing rather than its own member's.
 */
export async function loadTimePreferences(
  workspaceId: string,
): Promise<TimePreferences | undefined> {
  const resolution = await resolveWorkspaceSession().catch(() => undefined);
  return resolution?.status === "ready" &&
      resolution.session.workspace.id === workspaceId
    ? resolution.session.preferences
    : undefined;
}

/** Instants always use the selected membership's resolved display settings. */
export function formatInstant(
  value: string,
  preferences: TimePreferences | undefined,
): string {
  if (!preferences?.locale || !preferences.effectiveTimezone) {
    return "Time unavailable";
  }
  try {
    if (!Intl.DateTimeFormat.supportedLocalesOf(preferences.locale).length) {
      return "Time unavailable";
    }
    return new Intl.DateTimeFormat(preferences.locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: preferences.effectiveTimezone,
    }).format(new Date(value));
  } catch {
    return "Time unavailable";
  }
}

/** Recorded components stay Gregorian; UTC prevents a display timezone shift. */
export function formatCalendarDate(
  value: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  try {
    if (!Intl.DateTimeFormat.supportedLocalesOf(locale).length) {
      return "Date unavailable";
    }
    return new Intl.DateTimeFormat(locale, {
      ...options,
      calendar: "gregory",
      timeZone: "UTC",
    })
      .format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
  } catch {
    return "Date unavailable";
  }
}

export function formatPartialDate(
  value: {
    readonly year?: number;
    readonly month?: number;
    readonly day?: number;
  },
  precision:
    | "full"
    | "year_month"
    | "year"
    | "month_day"
    | "month"
    | "day"
    | "unknown",
  locale: string,
): string {
  if (precision === "unknown") return "Date unknown";
  const options: Record<
    Exclude<typeof precision, "unknown">,
    Intl.DateTimeFormatOptions
  > = {
    full: { year: "numeric", month: "long", day: "numeric" },
    year_month: { year: "numeric", month: "long" },
    year: { year: "numeric" },
    month_day: { month: "long", day: "numeric" },
    month: { month: "long" },
    day: { day: "numeric" },
  };
  const selected = { ...options[precision] };
  if (value.year === undefined) delete selected.year;
  if (value.month === undefined) delete selected.month;
  if (value.day === undefined) delete selected.day;
  if (!Object.keys(selected).length) return "Date unknown";
  const anchor = `${String(value.year ?? 2000).padStart(4, "0")}-${
    String(value.month ?? 1).padStart(2, "0")
  }-${String(value.day ?? 1).padStart(2, "0")}`;
  return formatCalendarDate(anchor, locale, selected);
}
