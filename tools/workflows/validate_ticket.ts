import {
  validateTicketBundle,
  type ValidationIssue,
} from "./ticket_contract.ts";

type JsonRecord = Record<string, unknown>;

const MAX_FILE_BYTES = 1_000_000;
const MAX_LEDGER_EVENTS = 1_000;

interface LoadedBundle {
  readonly bundle?: JsonRecord;
  readonly issues: readonly ValidationIssue[];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function readText(
  filePath: string,
  diagnosticPath: string,
  issues: ValidationIssue[],
): string | undefined {
  try {
    const info = Deno.statSync(filePath);
    if (!info.isFile) {
      issues.push(
        issue(diagnosticPath, "file_missing", "Required file is missing"),
      );
      return undefined;
    }
    if (info.size > MAX_FILE_BYTES) {
      issues.push(
        issue(
          diagnosticPath,
          "file_too_large",
          "File exceeds the validation limit",
        ),
      );
      return undefined;
    }
    return Deno.readTextFileSync(filePath);
  } catch (error) {
    const code = error instanceof Deno.errors.NotFound
      ? "file_missing"
      : "file_unreadable";
    issues.push(issue(diagnosticPath, code, "Required file cannot be read"));
    return undefined;
  }
}

function readJson(
  filePath: string,
  diagnosticPath: string,
  issues: ValidationIssue[],
): unknown {
  const text = readText(filePath, diagnosticPath, issues);
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    issues.push(
      issue(diagnosticPath, "malformed_json", "File is not valid JSON"),
    );
    return undefined;
  }
}

function isSafeReference(value: string, directory: string): boolean {
  return value.startsWith(`${directory}/`) && !value.includes("\\") &&
    !value.startsWith("/") && !/^[A-Za-z]:/.test(value) &&
    value.split("/").every((part) =>
      part !== "" && part !== "." && part !== ".."
    );
}

function referencedFiles(state: unknown, field: string): readonly string[] {
  if (!isRecord(state) || !Array.isArray(state[field])) {
    return [];
  }
  return state[field].filter((value): value is string =>
    typeof value === "string"
  );
}

function readReferencedJson(
  ticketDirectory: string,
  references: readonly string[],
  expectedDirectory: string,
  statePath: string,
  issues: ValidationIssue[],
): unknown[] {
  const values: unknown[] = [];
  references.forEach((reference, index) => {
    if (!isSafeReference(reference, expectedDirectory)) {
      return;
    }
    const value = readJson(
      `${ticketDirectory}/${reference}`,
      `${statePath}[${index}]`,
      issues,
    );
    if (value !== undefined) {
      values.push(value);
    }
  });
  return values;
}

function readEvents(
  ticketDirectory: string,
  issues: ValidationIssue[],
): unknown[] | undefined {
  const text = readText(
    `${ticketDirectory}/events.jsonl`,
    "events.jsonl",
    issues,
  );
  if (text === undefined) {
    return undefined;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > MAX_LEDGER_EVENTS) {
    issues.push(
      issue("events.jsonl", "file_too_large", "Ledger has too many events"),
    );
    return undefined;
  }
  const events: unknown[] = [];
  lines.forEach((line, index) => {
    try {
      events.push(JSON.parse(line));
    } catch {
      issues.push(
        issue(
          `events.jsonl:${index + 1}`,
          "malformed_json",
          "Ledger line is not valid JSON",
        ),
      );
    }
  });
  return events;
}

function availableTasks(issues: ValidationIssue[]): ReadonlySet<string> {
  const config = readJson(`${Deno.cwd()}/deno.json`, "deno.json", issues);
  if (!isRecord(config) || !isRecord(config.tasks)) {
    if (config !== undefined) {
      issues.push(
        issue("deno.json.tasks", "invalid_type", "Expected a tasks object"),
      );
    }
    return new Set();
  }
  return new Set(Object.keys(config.tasks));
}

function loadTicketDirectory(ticketDirectory: string): LoadedBundle {
  const issues: ValidationIssue[] = [];
  const ticket = readJson(
    `${ticketDirectory}/ticket.json`,
    "ticket.json",
    issues,
  );
  const state = readJson(
    `${ticketDirectory}/state.json`,
    "state.json",
    issues,
  );
  const events = readEvents(ticketDirectory, issues);
  const results = readReferencedJson(
    ticketDirectory,
    referencedFiles(state, "resultRefs"),
    "results",
    "$.state.resultRefs",
    issues,
  );
  const reviews = readReferencedJson(
    ticketDirectory,
    referencedFiles(state, "reviewRefs"),
    "reviews",
    "$.state.reviewRefs",
    issues,
  );
  if (
    issues.length > 0 || ticket === undefined || state === undefined ||
    events === undefined
  ) {
    return { issues };
  }
  return {
    bundle: { ticket, state, events, results, reviews },
    issues,
  };
}

function emit(ok: boolean, issues: readonly ValidationIssue[]): void {
  console.log(JSON.stringify({ ok, issues }));
}

export function runTicketValidator(args: readonly string[]): number {
  if (args.length !== 1) {
    emit(false, [
      issue(
        "$args",
        "usage",
        "Expected exactly one ticket-directory argument",
      ),
    ]);
    return 2;
  }

  try {
    const loadResult = loadTicketDirectory(args[0]!);
    if (loadResult.bundle === undefined) {
      emit(false, loadResult.issues);
      return 1;
    }
    const taskIssues: ValidationIssue[] = [];
    const tasks = availableTasks(taskIssues);
    if (taskIssues.length > 0) {
      emit(false, taskIssues);
      return 1;
    }
    const issues = validateTicketBundle(loadResult.bundle, tasks);
    emit(issues.length === 0, issues);
    return issues.length === 0 ? 0 : 1;
  } catch {
    emit(false, [
      issue("$", "io_error", "Ticket directory could not be validated"),
    ]);
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(runTicketValidator(Deno.args));
}
