import {
  validateTicketBundle,
  type ValidationIssue,
  WORKFLOW_POLICY,
  type WorkflowPhase,
} from "./ticket_contract.ts";

type JsonRecord = Record<string, unknown>;

const MAX_FILE_BYTES = 1_000_000;
const MAX_LEDGER_EVENTS = 1_000;
const MAX_REFERENCES = 100;
const MAX_AGGREGATE_BYTES = 5_000_000;
const MAX_GIT_OUTPUT_BYTES = 10_000;
const MAX_GIT_BLOB_BYTES = 5_000_000;
const MAX_CHANGED_PATHS = 100;

interface ReadBudget {
  bytes: number;
}

interface LoadedBundle {
  readonly bundle?: JsonRecord;
  readonly issues: readonly ValidationIssue[];
  readonly budget: ReadBudget;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

interface GitResult {
  readonly success: boolean;
  readonly output: Uint8Array;
  readonly limited: boolean;
}

interface GitBlobBudget {
  remaining: number;
}

type GitBlobValidation = "valid" | "invalid";

async function runGit(
  ticketDirectory: string,
  args: readonly string[],
  outputLimitBytes = MAX_GIT_OUTPUT_BYTES,
): Promise<GitResult> {
  const process = new Deno.Command("git", {
    args: [...args],
    cwd: ticketDirectory,
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const reader = process.stdout.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let limited = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = outputLimitBytes - byteLength;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        byteLength = outputLimitBytes;
        limited = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      byteLength += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const status = await process.status;
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    success: status.success && !limited,
    output,
    limited,
  };
}

function gitText(result: GitResult): string {
  return new TextDecoder().decode(result.output).trim();
}

function normalizedFsPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function sameFsPath(left: string, right: string): boolean {
  return normalizedFsPath(left) === normalizedFsPath(right);
}

function pathContainsLink(root: string, path: string): boolean {
  const components = [root];
  let current = root.replace(/[\\/]$/, "");
  for (const part of path.slice(root.length).split(/[\\/]+/)) {
    if (part === "") continue;
    current = `${current}/${part}`;
    components.push(current);
  }
  return components.some((component) => Deno.lstatSync(component).isSymlink);
}

function isAllowedWrite(
  path: string,
  allowedWrites: readonly string[],
): boolean {
  return allowedWrites.some((allowed) =>
    allowed.endsWith("/") ? path.startsWith(allowed) : path === allowed
  );
}

function isApprovedRedTestPath(path: string): boolean {
  return /(?:^|\/)[^/]*(?:_test|\.test|\.spec|_check)\.[cm]?[jt]sx?$/.test(
    path,
  );
}

async function changedPaths(
  ticketDirectory: string,
  fromRevision: string,
  toRevision: string,
  diagnosticPath: string,
  issues: ValidationIssue[],
): Promise<readonly string[] | undefined> {
  const result = await runGit(ticketDirectory, [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=ACDMRTUXB",
    "-z",
    fromRevision,
    toRevision,
    "--",
  ]);
  if (!result.success || result.limited) {
    issues.push(
      issue(
        diagnosticPath,
        "git_output_limit",
        "Git path evidence could not be read within limits",
      ),
    );
    return undefined;
  }
  const fields = new TextDecoder().decode(result.output).split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (status === undefined || status === "") break;
    const firstPath = fields[index++]!;
    paths.push(firstPath);
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = fields[index++];
      if (secondPath !== undefined && secondPath !== "") {
        paths.push(secondPath);
      }
    }
  }
  if (paths.length > MAX_CHANGED_PATHS) {
    issues.push(
      issue(
        diagnosticPath,
        "git_output_limit",
        "Git path evidence contains too many changed paths",
      ),
    );
    return undefined;
  }
  return paths;
}

async function readGitJsonRecord(
  ticketDirectory: string,
  revision: string,
  repositoryPath: string,
): Promise<JsonRecord | undefined> {
  const result = await runGit(
    ticketDirectory,
    ["show", `${revision}:${repositoryPath}`],
    MAX_FILE_BYTES,
  );
  if (!result.success || result.limited) return undefined;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(result.output));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function taskDefinitionsAtRevision(
  ticketDirectory: string,
  revision: string,
): Promise<ReadonlyMap<string, string> | undefined> {
  const config = await readGitJsonRecord(
    ticketDirectory,
    revision,
    "deno.json",
  );
  if (config === undefined || !isRecord(config.tasks)) return undefined;
  const definitions = new Map<string, string>();
  for (const [name, definition] of Object.entries(config.tasks)) {
    if (typeof definition === "string") definitions.set(name, definition);
  }
  return definitions;
}

function isObviousNoopTaskDefinition(definition: string): boolean {
  return /^deno\s+eval\s+(?:["']?true["']?);?$/i.test(definition.trim());
}

async function sha256(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function validateGitBlob(
  ticketDirectory: string,
  blobSpec: string,
  outputLimitBytes: number,
  expectedSha256: string,
  readFailures: readonly [ValidationIssue, ValidationIssue],
  hashMismatch: ValidationIssue,
  aggregateLimit: ValidationIssue,
  issues: ValidationIssue[],
  budget: GitBlobBudget,
): Promise<GitBlobValidation> {
  if (outputLimitBytes > budget.remaining) {
    issues.push(aggregateLimit);
    budget.remaining = -1;
    return "invalid";
  }
  budget.remaining -= outputLimitBytes;
  const blob = await runGit(
    ticketDirectory,
    ["show", blobSpec],
    outputLimitBytes,
  );
  if (!blob.success) {
    issues.push(readFailures[Number(blob.limited)]!);
    return "invalid";
  }
  if (await sha256(blob.output) !== expectedSha256) {
    issues.push(hashMismatch);
    return "invalid";
  }
  return "valid";
}

function readText(
  filePath: string,
  diagnosticPath: string,
  issues: ValidationIssue[],
  budget?: ReadBudget,
  containmentRoot?: string,
): string | undefined {
  try {
    const info = Deno.statSync(filePath);
    if (!info.isFile) {
      issues.push(
        issue(diagnosticPath, "file_missing", "Required file is missing"),
      );
      return undefined;
    }
    if (
      containmentRoot !== undefined &&
      pathContainsLink(containmentRoot, filePath)
    ) {
      issues.push(
        issue(
          diagnosticPath,
          "path_escape",
          "Ticket evidence must not traverse filesystem links",
        ),
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
    if (
      budget !== undefined && budget.bytes + info.size > MAX_AGGREGATE_BYTES
    ) {
      issues.push(
        issue(
          diagnosticPath,
          "aggregate_too_large",
          "Ticket evidence exceeds the aggregate validation limit",
        ),
      );
      return undefined;
    }
    const text = Deno.readTextFileSync(filePath);
    if (budget !== undefined) budget.bytes += info.size;
    return text;
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
  budget?: ReadBudget,
  containmentRoot?: string,
): unknown {
  const text = readText(
    filePath,
    diagnosticPath,
    issues,
    budget,
    containmentRoot,
  );
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

function referencedFiles(
  state: unknown,
  field: string,
  expectedDirectory: string,
  statePath: string,
  issues: ValidationIssue[],
): readonly string[] {
  if (!isRecord(state) || !Array.isArray(state[field])) {
    return [];
  }
  const references = state[field];
  if (references.length > MAX_REFERENCES) {
    issues.push(
      issue(
        statePath,
        "reference_limit",
        "Reference collection exceeds the validation limit",
      ),
    );
    return [];
  }
  const seen = new Set<string>();
  const safeReferences: string[] = [];
  references.forEach((reference, index) => {
    if (typeof reference !== "string") return;
    if (!isSafeReference(reference, expectedDirectory)) {
      const traverses = reference.includes("\\") || reference.startsWith("/") ||
        /^[A-Za-z]:/.test(reference) || reference.split("/").some((part) =>
          part === "" || part === "." || part === ".."
        );
      issues.push(
        issue(
          `${statePath}[${index}]`,
          traverses ? "path_traversal" : "invalid_reference",
          "Evidence reference is outside its required directory",
        ),
      );
      return;
    }
    if (seen.has(reference)) {
      issues.push(
        issue(
          `${statePath}[${index}]`,
          "duplicate_reference",
          "Evidence references must be unique",
        ),
      );
      return;
    }
    seen.add(reference);
    safeReferences.push(reference);
  });
  return safeReferences;
}

function readReferencedJson(
  ticketDirectory: string,
  references: readonly string[],
  statePath: string,
  issues: ValidationIssue[],
  budget: ReadBudget,
): unknown[] {
  const values: unknown[] = [];
  references.forEach((reference, index) => {
    const value = readJson(
      `${ticketDirectory}/${reference}`,
      `${statePath}[${index}]`,
      issues,
      budget,
      ticketDirectory,
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
  budget: ReadBudget,
): unknown[] | undefined {
  const text = readText(
    `${ticketDirectory}/events.jsonl`,
    "events.jsonl",
    issues,
    budget,
    ticketDirectory,
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
  const budget: ReadBudget = { bytes: 0 };
  const ticket = readJson(
    `${ticketDirectory}/ticket.json`,
    "ticket.json",
    issues,
    budget,
    ticketDirectory,
  );
  const state = readJson(
    `${ticketDirectory}/state.json`,
    "state.json",
    issues,
    budget,
    ticketDirectory,
  );
  const events = readEvents(ticketDirectory, issues, budget);
  const results = readReferencedJson(
    ticketDirectory,
    referencedFiles(
      state,
      "resultRefs",
      "results",
      "$.state.resultRefs",
      issues,
    ),
    "$.state.resultRefs",
    issues,
    budget,
  );
  const reviews = readReferencedJson(
    ticketDirectory,
    referencedFiles(
      state,
      "reviewRefs",
      "reviews",
      "$.state.reviewRefs",
      issues,
    ),
    "$.state.reviewRefs",
    issues,
    budget,
  );
  if (
    issues.length > 0 || ticket === undefined || state === undefined ||
    events === undefined
  ) {
    return { issues, budget };
  }
  return {
    bundle: { ticket, state, events, results, reviews },
    issues,
    budget,
  };
}

function roundReference(
  directory: string,
  round: number,
  extension: string,
): string {
  return `${directory}/round-${String(round).padStart(2, "0")}.${extension}`;
}

function validateEvidenceFiles(
  ticketDirectory: string,
  bundle: JsonRecord,
  budget: ReadBudget,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  // This helper runs only after the structural contract has returned no issues.
  const ticket = bundle.ticket as JsonRecord;
  const state = bundle.state as JsonRecord;
  const results = bundle.results as unknown[];
  const reviews = bundle.reviews as unknown[];
  const events = bundle.events as unknown[];
  const resultRefs = state.resultRefs as unknown[];
  const reviewRefs = state.reviewRefs as unknown[];
  const loadedReferences = new Set<string>([
    "ticket.json",
    "state.json",
    "events.jsonl",
    ...resultRefs.filter((value): value is string => typeof value === "string"),
    ...reviewRefs.filter((value): value is string => typeof value === "string"),
  ]);
  const checkedReferences = new Set(loadedReferences);
  const requireFile = (reference: string, diagnosticPath: string): void => {
    if (checkedReferences.has(reference)) return;
    checkedReferences.add(reference);
    readText(
      `${ticketDirectory}/${reference}`,
      diagnosticPath,
      issues,
      budget,
      ticketDirectory,
    );
  };
  const resultsByRound = new Map<number, JsonRecord>();

  results.forEach((value, index) => {
    const resultRecord = value as JsonRecord;
    const round = resultRecord.round as number;
    resultsByRound.set(round, resultRecord);
    const resultPath = `$.results[${index}]`;
    const expectedResultRef = roundReference("results", round, "json");
    if (resultRefs[index] !== expectedResultRef) {
      issues.push(
        issue(
          `$.state.resultRefs[${index}]`,
          "reference_mismatch",
          "Result reference must exactly match its round record",
        ),
      );
    }
    const expectedDispatchRef = roundReference(
      "dispatch",
      round,
      "md",
    );
    if (resultRecord.dispatchRef !== expectedDispatchRef) {
      issues.push(
        issue(
          `${resultPath}.dispatchRef`,
          "reference_mismatch",
          "Dispatch reference must exactly match the result round",
        ),
      );
    }
    requireFile(
      resultRecord.dispatchRef as string,
      `${resultPath}.dispatchRef`,
    );
    for (
      const [phase, evidence] of [
        ["red", resultRecord.red],
        ["green", resultRecord.green],
        ["refactor", resultRecord.refactor],
      ] as const
    ) {
      const evidenceRecord = evidence as JsonRecord;
      const expectedLogRef = `evidence/round-${
        String(round).padStart(2, "0")
      }-${phase}.log`;
      if (evidenceRecord.logRef !== expectedLogRef) {
        issues.push(
          issue(
            `${resultPath}.${phase}.logRef`,
            "reference_mismatch",
            "Phase log reference must exactly match the result round",
          ),
        );
      }
      requireFile(
        evidenceRecord.logRef as string,
        `${resultPath}.${phase}.logRef`,
      );
    }
  });

  reviews.forEach((value, index) => {
    const round = (value as JsonRecord).round as number;
    const expectedReviewRef = roundReference("reviews", round, "json");
    if (reviewRefs[index] !== expectedReviewRef) {
      issues.push(
        issue(
          `$.state.reviewRefs[${index}]`,
          "reference_mismatch",
          "Review reference must exactly match its round record",
        ),
      );
    }
  });

  events.forEach((value, index) => {
    const event = value as JsonRecord;
    const eventPath = `$.events[${index}].evidenceRef`;
    const round = event.round as number;
    const result = resultsByRound.get(round);
    let expectedReference: string | undefined;
    const transition = WORKFLOW_POLICY.transitions.find((candidate) =>
      candidate.from === event.from && candidate.to === event.to
    )!;
    const recordDirectory =
      WORKFLOW_POLICY.evidence.roundRecords[transition.evidence];
    if (transition.evidence === "ticket") {
      expectedReference = WORKFLOW_POLICY.evidence.ticket;
    } else if (transition.evidence === "red" && isRecord(result?.red)) {
      expectedReference = result.red.logRef as string;
    } else if (
      transition.evidence === "green" && isRecord(result?.green)
    ) {
      expectedReference = result.green.logRef as string;
    } else if (
      transition.evidence === "refactor" && isRecord(result?.refactor)
    ) {
      expectedReference = result.refactor.logRef as string;
    } else if (recordDirectory !== undefined) {
      expectedReference = roundReference(recordDirectory, round, "json");
    } else if (transition.evidence === "acceptance") {
      expectedReference = WORKFLOW_POLICY.evidence.acceptance;
    } else if (transition.evidence === "integration") {
      expectedReference = ticket.schemaVersion === 1
        ? WORKFLOW_POLICY.evidence.acceptance
        : WORKFLOW_POLICY.evidence.integration;
    }
    if (
      expectedReference !== undefined && event.evidenceRef !== expectedReference
    ) {
      issues.push(
        issue(
          eventPath,
          "reference_mismatch",
          "Event evidence must exactly match its lifecycle transition",
        ),
      );
    }
    requireFile(event.evidenceRef as string, eventPath);
  });

  if (
    WORKFLOW_POLICY.phases[state.phase as WorkflowPhase]
      .requiresAcceptanceClosure
  ) {
    requireFile("acceptance.md", "acceptance.md");
  }
  if (state.phase === "integrated" && ticket.schemaVersion === 2) {
    requireFile("integration.md", "integration.md");
  }
  return issues;
}

async function validateTaskDefinitions(
  ticketDirectory: string,
  ticket: JsonRecord,
  state: JsonRecord,
  issues: ValidationIssue[],
): Promise<void> {
  if (ticket.schemaVersion !== 2 || state.candidateRevision === null) return;
  const requiredTasks = ticket.requiredTasks as JsonRecord;
  const baseline = requiredTasks.baseline as JsonRecord[];
  const candidate = requiredTasks.candidate as JsonRecord[];
  const baselineDefinitions = await taskDefinitionsAtRevision(
    ticketDirectory,
    ticket.baseRevision as string,
  );
  const candidateDefinitions = await taskDefinitionsAtRevision(
    ticketDirectory,
    state.candidateRevision as string,
  );
  if (baselineDefinitions === undefined || candidateDefinitions === undefined) {
    issues.push(
      issue(
        "$.ticket.requiredTasks",
        "task_definition_mismatch",
        "Deno task definitions could not be read at the declared revisions",
      ),
    );
    return;
  }
  const requiredNames = new Set<string>();
  baseline.forEach((entry, index) => {
    const name = entry.name as string;
    requiredNames.add(name);
    if (baselineDefinitions.get(name) !== entry.definition) {
      issues.push(
        issue(
          `$.ticket.requiredTasks.baseline[${index}].definition`,
          "task_definition_mismatch",
          "Recorded task definition must match the exact base revision",
        ),
      );
    }
  });
  candidate.forEach((entry, index) => {
    const name = entry.name as string;
    const definition = entry.definition as string;
    if (candidateDefinitions.get(name) !== definition) {
      issues.push(
        issue(
          `$.ticket.requiredTasks.candidate[${index}].definition`,
          "task_definition_mismatch",
          "Recorded task definition must match the exact candidate revision",
        ),
      );
    }
    if (isObviousNoopTaskDefinition(definition)) {
      issues.push(
        issue(
          `$.ticket.requiredTasks.candidate[${index}].definition`,
          "task_definition_noop",
          "A no-op task cannot certify delivery evidence",
        ),
      );
    }
    if (baselineDefinitions.get(name) === candidateDefinitions.get(name)) {
      return;
    }
    if (entry.guardedBy === null) {
      issues.push(
        issue(
          `$.ticket.requiredTasks.candidate[${index}].guardedBy`,
          "task_guard_required",
          "A changed task requires an unchanged independent guard",
        ),
      );
      return;
    }
    const guard = entry.guardedBy as string;
    if (
      guard === name || !requiredNames.has(guard) ||
      baselineDefinitions.get(guard) === undefined ||
      baselineDefinitions.get(guard) !== candidateDefinitions.get(guard)
    ) {
      issues.push(
        issue(
          `$.ticket.requiredTasks.candidate[${index}].guardedBy`,
          "task_guard_invalid",
          "Task guard must name a distinct unchanged required task",
        ),
      );
    }
  });
}

async function validateDependenciesAtBase(
  ticketDirectory: string,
  ticket: JsonRecord,
  state: JsonRecord,
  issues: ValidationIssue[],
): Promise<void> {
  const dependencies = ticket.dependencies as string[];
  const dependencyRevisions = state.dependencyRevisions as JsonRecord;
  for (const dependency of dependencies) {
    const path = `$.state.dependencyRevisions.${dependency}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(dependency)) {
      issues.push(
        issue(
          path,
          "dependency_not_integrated_at_base",
          "Invalid dependency ID",
        ),
      );
      continue;
    }
    const dependencyState = await readGitJsonRecord(
      ticketDirectory,
      ticket.baseRevision as string,
      `docs/planning/tickets/${dependency}/state.json`,
    );
    if (
      dependencyState?.phase !== "integrated" ||
      typeof dependencyState.integrationRevision !== "string"
    ) {
      issues.push(
        issue(
          path,
          "dependency_not_integrated_at_base",
          "Dependency was not integrated at the dependent ticket base",
        ),
      );
      continue;
    }
    if (
      dependencyRevisions[dependency] !== dependencyState.integrationRevision
    ) {
      issues.push(
        issue(
          path,
          "dependency_revision_mismatch",
          "Dependency pin must match its base-state integration revision",
        ),
      );
    }
  }
}

async function validateIntegrationGitEvidence(
  ticketDirectory: string,
  ticket: JsonRecord,
  state: JsonRecord,
  headRevision: string,
  ticketEvidencePrefix: string,
  revisionExists: (revision: string) => Promise<boolean>,
  issues: ValidationIssue[],
): Promise<void> {
  const integrationRevision = state.integrationRevision as string;
  const candidateRevision = state.candidateRevision as string;
  const diagnosticPath = "$.state.integrationRevision";
  if (!await revisionExists(integrationRevision)) {
    issues.push(
      issue(
        diagnosticPath,
        "revision_not_found",
        "Git integration revision does not exist",
      ),
    );
    return;
  }
  const candidateAncestry = await runGit(ticketDirectory, [
    "merge-base",
    "--is-ancestor",
    candidateRevision,
    integrationRevision,
  ]);
  if (!candidateAncestry.success) {
    issues.push(
      issue(
        diagnosticPath,
        "integration_ancestry_mismatch",
        "Integration revision must descend from the reviewed candidate",
      ),
    );
  }
  const metadataAncestry = await runGit(ticketDirectory, [
    "merge-base",
    "--is-ancestor",
    integrationRevision,
    headRevision,
  ]);
  if (!metadataAncestry.success) {
    issues.push(
      issue(
        diagnosticPath,
        "integration_metadata_ancestry_mismatch",
        "Integrated metadata must descend from the integration anchor",
      ),
    );
    return;
  }
  const integrationPaths = await changedPaths(
    ticketDirectory,
    candidateRevision,
    integrationRevision,
    diagnosticPath,
    issues,
  );
  const allowedWrites = ticket.allowedWrites as string[];
  if (
    integrationPaths?.some((path) =>
      !path.startsWith(ticketEvidencePrefix) &&
      isAllowedWrite(path, allowedWrites)
    )
  ) {
    issues.push(
      issue(
        diagnosticPath,
        "integration_content_mismatch",
        "Integration changed content from the reviewed candidate",
      ),
    );
  }
  const metadataCommits = await runGit(ticketDirectory, [
    "rev-list",
    "--reverse",
    "--ancestry-path",
    `${integrationRevision}..${headRevision}`,
  ]);
  let firstMetadataRevision: string | undefined;
  if (metadataCommits.success) {
    for (const revision of gitText(metadataCommits).split(/\r?\n/)) {
      if (revision === "") continue;
      const snapshot = await readGitJsonRecord(
        ticketDirectory,
        revision,
        `${ticketEvidencePrefix}state.json`,
      );
      if (
        snapshot?.phase === "integrated" &&
        snapshot.integrationRevision === integrationRevision
      ) {
        firstMetadataRevision = revision;
        break;
      }
    }
  }
  if (firstMetadataRevision === undefined) {
    issues.push(
      issue(
        diagnosticPath,
        "integration_metadata_mutated",
        "Durable integrated ticket metadata is missing",
      ),
    );
    return;
  }
  const laterTicketPaths = await changedPaths(
    ticketDirectory,
    firstMetadataRevision,
    headRevision,
    diagnosticPath,
    issues,
  );
  if (
    laterTicketPaths?.some((path) => path.startsWith(ticketEvidencePrefix))
  ) {
    issues.push(
      issue(
        diagnosticPath,
        "integration_metadata_mutated",
        "Integrated ticket metadata changed after its durable record",
      ),
    );
  }
}

async function validateGitEvidence(
  ticketDirectory: string,
  bundle: JsonRecord,
): Promise<readonly ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const repository = await runGit(ticketDirectory, [
    "rev-parse",
    "--show-toplevel",
  ]);
  if (!repository.success || repository.limited || gitText(repository) === "") {
    return [
      issue(
        "$",
        "repository_unavailable",
        "Ticket evidence must be validated inside a Git repository",
      ),
    ];
  }
  // This helper runs only after structural and filesystem evidence is valid.
  const ticket = bundle.ticket as JsonRecord;
  const state = bundle.state as JsonRecord;
  const results = bundle.results as unknown[];
  const ticketId = ticket.ticketId as string;
  const allowedWrites = ticket.allowedWrites as string[];
  const ticketEvidencePrefix = `docs/planning/tickets/${ticketId}/`;
  const repositoryRoot = Deno.realPathSync(gitText(repository));
  const invocationRepository = await runGit(Deno.cwd(), [
    "rev-parse",
    "--show-toplevel",
  ]);
  if (
    !invocationRepository.success || invocationRepository.limited ||
    gitText(invocationRepository) === "" ||
    !sameFsPath(
      repositoryRoot,
      Deno.realPathSync(gitText(invocationRepository)),
    )
  ) {
    issues.push(
      issue(
        "$",
        "repository_mismatch",
        "Ticket evidence must belong to the repository being validated",
      ),
    );
  }

  const expectedTicketDirectory = `${repositoryRoot}/${ticketEvidencePrefix}`
    .replace(/\/$/, "");
  const physicalTicketDirectory = Deno.realPathSync(ticketDirectory);
  if (!sameFsPath(physicalTicketDirectory, expectedTicketDirectory)) {
    issues.push(
      issue(
        "$",
        "ticket_path_mismatch",
        "Ticket evidence must use its canonical repository path",
      ),
    );
  }
  if (issues.length > 0) return issues;

  const metadataStatus = await runGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ticketEvidencePrefix,
  ]);
  if (
    !metadataStatus.success || metadataStatus.limited ||
    metadataStatus.output.byteLength > 0
  ) {
    issues.push(
      issue(
        "$",
        "metadata_dirty",
        "Ticket metadata must be clean and committed at HEAD",
      ),
    );
  }

  const checkedRevisions = new Map<string, Promise<boolean>>();
  const revisionExists = (revision: string): Promise<boolean> => {
    const known = checkedRevisions.get(revision);
    if (known !== undefined) return known;
    const check = runGit(ticketDirectory, [
      "cat-file",
      "-e",
      `${revision}^{commit}`,
    ]).then((result) => result.success);
    checkedRevisions.set(revision, check);
    return check;
  };
  const ticketBaseRevision = ticket.baseRevision as string;
  const ticketBaseExists = await revisionExists(ticketBaseRevision);
  if (!ticketBaseExists) {
    issues.push(
      issue(
        "$.ticket.baseRevision",
        "revision_not_found",
        "Git commit evidence does not exist",
      ),
    );
  }

  if (ticketBaseExists && ticket.schemaVersion === 2) {
    await validateDependenciesAtBase(
      ticketDirectory,
      ticket,
      state,
      issues,
    );
  }

  const head = await runGit(ticketDirectory, ["rev-parse", "HEAD"]);
  if (state.candidateRevision === null) {
    if (ticketBaseExists) {
      const readyAncestry = await runGit(ticketDirectory, [
        "merge-base",
        "--is-ancestor",
        ticketBaseRevision,
        gitText(head),
      ]);
      if (
        !head.success || head.limited || gitText(head) === "" ||
        !readyAncestry.success
      ) {
        issues.push(
          issue(
            "$.ticket.baseRevision",
            "ready_base_ancestry_mismatch",
            "Committed ready metadata must descend from the ticket base",
          ),
        );
      } else {
        const readyPaths = await changedPaths(
          ticketDirectory,
          ticketBaseRevision,
          gitText(head),
          "$.ticket.baseRevision",
          issues,
        );
        if (
          readyPaths !== undefined &&
          readyPaths.some((path) => !path.startsWith(ticketEvidencePrefix))
        ) {
          issues.push(
            issue(
              "$.ticket.baseRevision",
              "ready_base_scope_violation",
              "Ready-phase commits may change only canonical ticket metadata",
            ),
          );
        }
      }
    }
    return issues;
  }

  const candidateRevision = state.candidateRevision as string;
  const headRevision = gitText(head);
  if (state.phase === "integrated" && ticket.schemaVersion === 2) {
    await validateIntegrationGitEvidence(
      ticketDirectory,
      ticket,
      state,
      headRevision,
      ticketEvidencePrefix,
      revisionExists,
      issues,
    );
  } else {
    const metadataAncestry = await runGit(ticketDirectory, [
      "merge-base",
      "--is-ancestor",
      candidateRevision,
      headRevision,
    ]);
    if (
      !head.success || head.limited || headRevision === "" ||
      !metadataAncestry.success
    ) {
      issues.push(
        issue(
          "$.state.candidateRevision",
          "metadata_ancestry_mismatch",
          "Committed ticket metadata must descend from the reviewed candidate",
        ),
      );
    } else {
      const metadataPaths = await changedPaths(
        ticketDirectory,
        candidateRevision,
        headRevision,
        "$.state.candidateRevision",
        issues,
      );
      if (
        metadataPaths !== undefined &&
        metadataPaths.some((path) => !path.startsWith(ticketEvidencePrefix))
      ) {
        issues.push(
          issue(
            "$.state.candidateRevision",
            "metadata_scope_violation",
            "Post-candidate commits may change only canonical ticket metadata",
          ),
        );
      }
    }
  }

  await validateTaskDefinitions(ticketDirectory, ticket, state, issues);

  const finalCandidateRevision = state.candidateRevision as string;
  const gitBlobBudget: GitBlobBudget = { remaining: MAX_GIT_BLOB_BYTES };
  for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
    const result = results[resultIndex] as JsonRecord;
    const red = result.red as JsonRecord;
    const resultPath = `$.results[${resultIndex}]`;
    const baseRevision = result.inputBaseRevision as string;
    const redRevision = result.redRevision as string;
    const candidateRevision = result.candidateRevision as string;
    const revisions = [
      [baseRevision, `${resultPath}.inputBaseRevision`],
      [redRevision, `${resultPath}.redRevision`],
      [candidateRevision, `${resultPath}.candidateRevision`],
      [state.candidateRevision as string, "$.state.candidateRevision"],
    ] as const;
    let allRevisionsExist = true;
    for (const [revision, path] of revisions) {
      if (!await revisionExists(revision)) {
        allRevisionsExist = false;
        issues.push(
          issue(
            path,
            "revision_not_found",
            "Git commit evidence does not exist",
          ),
        );
      }
    }
    if (!allRevisionsExist) continue;

    const baseToRed = await runGit(ticketDirectory, [
      "merge-base",
      "--is-ancestor",
      baseRevision,
      redRevision,
    ]);
    const redToCandidate = await runGit(ticketDirectory, [
      "merge-base",
      "--is-ancestor",
      redRevision,
      candidateRevision,
    ]);
    if (!baseToRed.success || !redToCandidate.success) {
      issues.push(
        issue(
          `${resultPath}.candidateRevision`,
          "ancestry_mismatch",
          "Candidate lineage must descend from the exact RED revision",
        ),
      );
    }

    const testFiles = red.testFiles as unknown[];
    const declaredTestPaths = new Set<string>();
    for (let fileIndex = 0; fileIndex < testFiles.length; fileIndex++) {
      const testFile = testFiles[fileIndex] as JsonRecord;
      const testPath = testFile.path as string;
      const testSha256 = testFile.sha256 as string;
      declaredTestPaths.add(testPath);
      const blobSpec = `${redRevision}:${testPath}`;
      const sizeResult = await runGit(ticketDirectory, [
        "cat-file",
        "-s",
        blobSpec,
      ]);
      const blobSize = Number(gitText(sizeResult));
      if (!sizeResult.success || !Number.isSafeInteger(blobSize)) {
        issues.push(
          issue(
            `${resultPath}.red.testFiles[${fileIndex}].path`,
            "content_missing",
            "Declared RED test blob does not exist",
          ),
        );
        continue;
      }
      if (blobSize > MAX_FILE_BYTES) {
        issues.push(
          issue(
            `${resultPath}.red.testFiles[${fileIndex}].path`,
            "git_output_limit",
            "Declared RED test blob exceeds the validation limit",
          ),
        );
        continue;
      }
      const aggregateLimit = issue(
        `${resultPath}.red.testFiles[${fileIndex}].path`,
        "aggregate_too_large",
        "Git test evidence exceeds the aggregate blob-byte limit",
      );
      const redBlobValidation = await validateGitBlob(
        ticketDirectory,
        blobSpec,
        blobSize,
        testSha256,
        [
          issue(
            `${resultPath}.red.testFiles[${fileIndex}].path`,
            "content_missing",
            "Declared RED test blob could not be read",
          ),
          issue(
            `${resultPath}.red.testFiles[${fileIndex}].path`,
            "git_output_limit",
            "Declared RED test blob could not be read within the validation limit",
          ),
        ],
        issue(
          `${resultPath}.red.testFiles[${fileIndex}].sha256`,
          "content_hash_mismatch",
          "Declared RED test digest does not match the Git blob",
        ),
        aggregateLimit,
        issues,
        gitBlobBudget,
      );
      if (redBlobValidation === "valid") {
        await validateGitBlob(
          ticketDirectory,
          `${candidateRevision}:${testPath}`,
          blobSize,
          testSha256,
          [
            issue(
              `${resultPath}.red.testFiles[${fileIndex}].path`,
              "content_missing",
              "Declared RED test blob does not exist in the candidate",
            ),
            issue(
              `${resultPath}.red.testFiles[${fileIndex}].sha256`,
              "content_hash_mismatch",
              "Declared RED test digest does not match the candidate Git blob",
            ),
          ],
          issue(
            `${resultPath}.red.testFiles[${fileIndex}].sha256`,
            "content_hash_mismatch",
            "Declared RED test digest does not match the candidate Git blob",
          ),
          aggregateLimit,
          issues,
          gitBlobBudget,
        );
        if (
          gitBlobBudget.remaining >= 0 &&
          candidateRevision !== finalCandidateRevision
        ) {
          await validateGitBlob(
            ticketDirectory,
            `${finalCandidateRevision}:${testPath}`,
            blobSize,
            testSha256,
            [
              issue(
                `${resultPath}.red.testFiles[${fileIndex}].path`,
                "content_missing",
                "Declared RED test blob does not exist in the final candidate",
              ),
              issue(
                `${resultPath}.red.testFiles[${fileIndex}].sha256`,
                "content_hash_mismatch",
                "Declared RED test digest does not match the final candidate Git blob",
              ),
            ],
            issue(
              `${resultPath}.red.testFiles[${fileIndex}].sha256`,
              "content_hash_mismatch",
              "Declared RED test digest does not match the final candidate Git blob",
            ),
            aggregateLimit,
            issues,
            gitBlobBudget,
          );
        }
      }
      if (gitBlobBudget.remaining < 0) return issues;
    }

    const redPaths = await changedPaths(
      ticketDirectory,
      baseRevision,
      redRevision,
      `${resultPath}.redRevision`,
      issues,
    );
    if (
      redPaths !== undefined &&
      (redPaths.some((path) =>
        !declaredTestPaths.has(path) &&
        !path.startsWith(ticketEvidencePrefix)
      ) || [...declaredTestPaths].some((path) =>
        !redPaths.includes(path) || !isApprovedRedTestPath(path)
      ))
    ) {
      issues.push(
        issue(
          `${resultPath}.redRevision`,
          "red_scope_violation",
          "RED changes must contain only declared tests and ticket evidence",
        ),
      );
    }

    const candidatePaths = await changedPaths(
      ticketDirectory,
      baseRevision,
      candidateRevision,
      `${resultPath}.candidateRevision`,
      issues,
    );
    if (
      candidatePaths !== undefined &&
      candidatePaths.some((path) =>
        !isAllowedWrite(path, allowedWrites) &&
        !path.startsWith(ticketEvidencePrefix)
      )
    ) {
      issues.push(
        issue(
          `${resultPath}.candidateRevision`,
          "candidate_scope_violation",
          "Candidate changes must remain inside the ticket write scope",
        ),
      );
    }
  }
  return issues;
}

function emit(ok: boolean, issues: readonly ValidationIssue[]): void {
  console.log(JSON.stringify({ ok, issues }));
}

export async function runTicketValidator(
  args: readonly string[],
): Promise<number> {
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
    const issues = [...validateTicketBundle(loadResult.bundle, tasks)];
    if (issues.length === 0) {
      issues.push(
        ...validateEvidenceFiles(
          args[0]!,
          loadResult.bundle,
          loadResult.budget,
        ),
      );
    }
    if (issues.length === 0) {
      issues.push(...await validateGitEvidence(args[0]!, loadResult.bundle));
    }
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
  Deno.exit(await runTicketValidator(Deno.args));
}
