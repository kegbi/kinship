export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

type JsonRecord = Record<string, unknown>;

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const BUNDLE_FIELDS = new Set([
  "ticket",
  "state",
  "events",
  "results",
  "reviews",
]);

const STATE_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "ticketRevision",
  "phase",
  "round",
  "baseRevision",
  "candidateRevision",
  "events",
  "resultRefs",
  "reviewRefs",
  "dependencyRevisions",
  "openFindingIds",
  "orchestratorChecks",
  "acceptedCandidateRevision",
  "blocker",
]);

const RESULT_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "ticketRevision",
  "round",
  "implementerRunId",
  "inputBaseRevision",
  "dispatchRef",
  "redRevision",
  "red",
  "green",
  "refactor",
  "candidateRevision",
]);

const RED_FIELDS = new Set([
  "command",
  "exitCode",
  "expectedFailure",
  "output",
  "logRef",
  "testFiles",
  "productionFiles",
]);

const CRITERION_FIELDS = new Set(["id", "text", "redProof"]);
const EVENT_FIELDS = new Set([
  "sequence",
  "from",
  "to",
  "round",
  "actorRunId",
  "evidenceRef",
  "revision",
]);
const CHECK_FIELDS = new Set(["runId", "revision", "command", "exitCode"]);
const REVIEW_COMMAND_FIELDS = new Set(["command", "exitCode"]);
const TEST_FILE_FIELDS = new Set(["path", "sha256"]);
const GREEN_FIELDS = new Set([
  "command",
  "exitCode",
  "logRef",
  "productionFiles",
]);
const REFACTOR_FIELDS = new Set(["summary", "command", "exitCode", "logRef"]);
const REVIEW_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "ticketRevision",
  "round",
  "implementerRunId",
  "reviewerRunId",
  "baseRevision",
  "candidateRevision",
  "verdict",
  "commands",
  "lenses",
  "findings",
  "notes",
]);
const LENS_FIELDS = new Set(["verdict", "evidence"]);

const TICKET_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "revision",
  "title",
  "outcome",
  "baseRevision",
  "dependencies",
  "maxRounds",
  "scope",
  "nonGoals",
  "allowedWrites",
  "contractRefs",
  "acceptanceCriteria",
  "requiredTasks",
  "risks",
  "unresolvedDecisions",
]);

const REQUIRED_TICKET_FIELDS = [...TICKET_FIELDS];

const REVIEW_LENSES = [
  "bug_correctness",
  "security_privacy",
  "architecture_contracts",
  "performance_reliability",
  "style_maintainability",
  "tests_tdd",
] as const;

const FINDING_FIELDS = [
  "id",
  "lens",
  "severity",
  "location",
  "expectedBehavior",
  "observedBehavior",
  "reproduction",
  "impact",
  "affectedCriterion",
  "contractRef",
  "requiredRemediation",
  "verification",
  "status",
] as const;
const FINDING_FIELD_SET = new Set<string>(FINDING_FIELDS);

const VALID_TRANSITIONS = new Set([
  "planned:ready",
  "planned:blocked",
  "ready:red",
  "ready:blocked",
  "red:green",
  "red:blocked",
  "green:refactor",
  "green:blocked",
  "refactor:review",
  "refactor:blocked",
  "review:accepted",
  "review:rework",
  "review:blocked",
  "rework:red",
  "rework:blocked",
  "accepted:integrated",
]);

const VALID_PHASES = new Set([
  "planned",
  "ready",
  "red",
  "green",
  "refactor",
  "review",
  "rework",
  "accepted",
  "integrated",
  "blocked",
  "cancelled",
]);
const VALID_REVIEW_VERDICTS = new Set(["APPROVED", "CHANGES_REQUESTED"]);
const VALID_LENS_VERDICTS = new Set(["pass", "fail", "not_applicable"]);
const VALID_FINDING_LENSES = new Set<string>(REVIEW_LENSES);
const VALID_FINDING_SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const VALID_FINDING_STATUSES = new Set(["open", "resolved", "waived"]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: ValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function validateFields(
  record: JsonRecord,
  path: string,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  issues: ValidationIssue[],
): void {
  for (const field of required) {
    if (!(field in record)) {
      addIssue(
        issues,
        `${path}.${field}`,
        "required_field",
        "Required field is missing",
      );
    }
  }
  for (const field of Object.keys(record).sort()) {
    if (!allowed.has(field)) {
      addIssue(
        issues,
        `${path}.${field}`,
        "unknown_field",
        "Unknown field",
      );
    }
  }
}

function validateRevision(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type", "Expected a Git revision string");
  } else if (!REVISION_PATTERN.test(value)) {
    addIssue(issues, path, "invalid_revision", "Expected a full Git revision");
  }
}

function validateNullableRevision(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value !== null) validateRevision(value, path, issues);
}

function validateSha256(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type", "Expected a SHA-256 string");
  } else if (!SHA256_PATTERN.test(value)) {
    addIssue(
      issues,
      path,
      "invalid_sha256",
      "Expected a lowercase SHA-256 digest",
    );
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is string {
  if (value === undefined) return false;
  if (typeof value !== "string") {
    addIssue(issues, path, "invalid_type", "Expected a string");
    return false;
  }
  if (value.trim().length === 0) {
    addIssue(issues, path, "empty_value", "String value cannot be empty");
    return false;
  }
  return true;
}

function validateInteger(
  value: unknown,
  path: string,
  minimum: number,
  issues: ValidationIssue[],
): value is number {
  if (value === undefined) return false;
  if (!Number.isInteger(value) || Number(value) < minimum) {
    addIssue(issues, path, "invalid_type", "Expected an integer in range");
    return false;
  }
  return true;
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  options: { readonly minimum?: number; readonly unique?: boolean } = {},
): value is string[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      addIssue(issues, path, "invalid_type", "Expected an array");
    }
    return false;
  }
  if (value.length < (options.minimum ?? 0)) {
    addIssue(issues, path, "evidence_required", "Array cannot be empty");
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (!validateNonEmptyString(item, `${path}[${index}]`, issues)) return;
    if (options.unique && seen.has(item)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        "duplicate_value",
        "Array values must be unique",
      );
    }
    seen.add(item);
  });
  return value.every((item) => typeof item === "string");
}

function isSafeRepositoryPath(value: string): boolean {
  const path = value.endsWith("/") ? value.slice(0, -1) : value;
  if (
    path.length === 0 || path.includes("\\") || path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) || path.includes("\0")
  ) {
    return false;
  }
  return path.split("/").every((segment) =>
    segment !== "" && segment !== "." && segment !== ".."
  );
}

function validateSafePath(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!validateNonEmptyString(value, path, issues)) return;
  if (!isSafeRepositoryPath(value)) {
    addIssue(
      issues,
      path,
      "path_traversal",
      "Expected a safe repository-relative path",
    );
  }
}

function validateSafePathArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      addIssue(issues, path, "invalid_type", "Expected a path array");
    }
    return;
  }
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    validateSafePath(item, itemPath, issues);
    if (typeof item === "string" && seen.has(item)) {
      addIssue(
        issues,
        itemPath,
        "duplicate_value",
        "Path values must be unique",
      );
    }
    if (typeof item === "string") seen.add(item);
  });
}

function validateTicket(
  ticket: JsonRecord,
  availableTasks: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateFields(
    ticket,
    "$.ticket",
    TICKET_FIELDS,
    REQUIRED_TICKET_FIELDS,
    issues,
  );
  if (ticket.schemaVersion !== 1) {
    addIssue(
      issues,
      "$.ticket.schemaVersion",
      "invalid_value",
      "Unsupported ticket schema version",
    );
  }
  validateNonEmptyString(ticket.ticketId, "$.ticket.ticketId", issues);
  validateInteger(ticket.revision, "$.ticket.revision", 1, issues);
  validateNonEmptyString(ticket.title, "$.ticket.title", issues);
  validateNonEmptyString(ticket.outcome, "$.ticket.outcome", issues);
  validateRevision(ticket.baseRevision, "$.ticket.baseRevision", issues);
  validateStringArray(ticket.dependencies, "$.ticket.dependencies", issues, {
    unique: true,
  });
  validateInteger(ticket.maxRounds, "$.ticket.maxRounds", 1, issues);
  validateStringArray(ticket.scope, "$.ticket.scope", issues, {
    minimum: 1,
    unique: true,
  });
  validateStringArray(ticket.nonGoals, "$.ticket.nonGoals", issues, {
    unique: true,
  });
  validateSafePathArray(ticket.allowedWrites, "$.ticket.allowedWrites", issues);
  validateStringArray(ticket.contractRefs, "$.ticket.contractRefs", issues, {
    minimum: 1,
    unique: true,
  });
  validateStringArray(ticket.requiredTasks, "$.ticket.requiredTasks", issues, {
    unique: true,
  });
  validateStringArray(ticket.risks, "$.ticket.risks", issues, {
    unique: true,
  });
  validateStringArray(
    ticket.unresolvedDecisions,
    "$.ticket.unresolvedDecisions",
    issues,
    { unique: true },
  );

  if (!Array.isArray(ticket.acceptanceCriteria)) {
    if (ticket.acceptanceCriteria !== undefined) {
      addIssue(
        issues,
        "$.ticket.acceptanceCriteria",
        "invalid_type",
        "Expected an acceptance-criteria array",
      );
    }
  } else {
    if (ticket.acceptanceCriteria.length === 0) {
      addIssue(
        issues,
        "$.ticket.acceptanceCriteria",
        "evidence_required",
        "At least one acceptance criterion is required",
      );
    }
    const ids = new Set<string>();
    ticket.acceptanceCriteria.forEach((criterion, index) => {
      const criterionPath = `$.ticket.acceptanceCriteria[${index}]`;
      if (!isRecord(criterion)) {
        addIssue(
          issues,
          criterionPath,
          "invalid_type",
          "Expected a criterion object",
        );
        return;
      }
      validateFields(
        criterion,
        criterionPath,
        CRITERION_FIELDS,
        [...CRITERION_FIELDS],
        issues,
      );
      if (
        validateNonEmptyString(
          criterion.id,
          `${criterionPath}.id`,
          issues,
        )
      ) {
        if (ids.has(criterion.id)) {
          addIssue(
            issues,
            `${criterionPath}.id`,
            "duplicate_id",
            "Acceptance criterion IDs must be unique",
          );
        }
        ids.add(criterion.id);
      }
      validateNonEmptyString(
        criterion.text,
        `${criterionPath}.text`,
        issues,
      );
      validateNonEmptyString(
        criterion.redProof,
        `${criterionPath}.redProof`,
        issues,
      );
    });
  }

  if (Array.isArray(ticket.requiredTasks)) {
    ticket.requiredTasks.forEach((task, index) => {
      if (typeof task === "string" && !availableTasks.has(task)) {
        addIssue(
          issues,
          `$.ticket.requiredTasks[${index}]`,
          "task_missing",
          "Required Deno task is unavailable",
        );
      }
    });
  }

  if (Array.isArray(ticket.unresolvedDecisions)) {
    ticket.unresolvedDecisions.forEach((_decision, index) => {
      addIssue(
        issues,
        `$.ticket.unresolvedDecisions[${index}]`,
        "unresolved_decision",
        "Ready and later tickets cannot have unresolved decisions",
      );
    });
  }
}

function validateEvents(events: unknown, issues: ValidationIssue[]): void {
  if (!Array.isArray(events)) {
    addIssue(
      issues,
      "$.state.events",
      "invalid_type",
      "Expected an events array",
    );
    return;
  }

  let previousTo: string | undefined;
  events.forEach((event, index) => {
    const eventPath = `$.state.events[${index}]`;
    if (!isRecord(event)) {
      addIssue(issues, eventPath, "invalid_type", "Expected an event object");
      return;
    }
    validateFields(
      event,
      eventPath,
      EVENT_FIELDS,
      [...EVENT_FIELDS],
      issues,
    );
    const from = event.from;
    const to = event.to;
    validateInteger(event.sequence, `${eventPath}.sequence`, 1, issues);
    validateInteger(event.round, `${eventPath}.round`, 0, issues);
    validateNonEmptyString(
      event.actorRunId,
      `${eventPath}.actorRunId`,
      issues,
    );
    validateSafePath(event.evidenceRef, `${eventPath}.evidenceRef`, issues);
    validateRevision(event.revision, `${eventPath}.revision`, issues);
    if (event.sequence !== index + 1) {
      addIssue(
        issues,
        `$.state.events[${index}].sequence`,
        "invalid_sequence",
        "Event sequences must be contiguous and one-based",
      );
    }
    if (typeof from !== "string" || typeof to !== "string") {
      if (typeof from !== "string") {
        addIssue(
          issues,
          `${eventPath}.from`,
          "invalid_type",
          "Expected a state name",
        );
      }
      if (typeof to !== "string") {
        addIssue(
          issues,
          `${eventPath}.to`,
          "invalid_type",
          "Expected a state name",
        );
      }
      return;
    }
    if (!VALID_PHASES.has(from) || !VALID_PHASES.has(to)) {
      addIssue(
        issues,
        eventPath,
        "invalid_value",
        "Event state is not recognized",
      );
    }
    if (
      !VALID_TRANSITIONS.has(`${from}:${to}`) ||
      (previousTo !== undefined && from !== previousTo)
    ) {
      addIssue(
        issues,
        `$.state.events[${index}]`,
        "invalid_transition",
        "State transition is not allowed or contiguous",
      );
    }
    previousTo = to;
  });
}

function validateResults(
  results: unknown,
  baseRevision: unknown,
  candidateRevision: unknown,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(results)) {
    addIssue(issues, "$.results", "invalid_type", "Expected a results array");
    return;
  }
  results.forEach((result, resultIndex) => {
    const resultPath = `$.results[${resultIndex}]`;
    if (!isRecord(result)) {
      addIssue(issues, resultPath, "invalid_type", "Expected a result object");
      return;
    }
    validateFields(
      result,
      resultPath,
      RESULT_FIELDS,
      [...RESULT_FIELDS],
      issues,
    );
    if (result.schemaVersion !== 1) {
      addIssue(
        issues,
        `${resultPath}.schemaVersion`,
        "invalid_value",
        "Unsupported result schema version",
      );
    }
    validateNonEmptyString(result.ticketId, `${resultPath}.ticketId`, issues);
    validateInteger(
      result.ticketRevision,
      `${resultPath}.ticketRevision`,
      1,
      issues,
    );
    validateInteger(result.round, `${resultPath}.round`, 1, issues);
    validateNonEmptyString(
      result.implementerRunId,
      `${resultPath}.implementerRunId`,
      issues,
    );
    validateRevision(
      result.inputBaseRevision,
      `${resultPath}.inputBaseRevision`,
      issues,
    );
    validateRevision(
      result.candidateRevision,
      `${resultPath}.candidateRevision`,
      issues,
    );
    if (!isRecord(result.red)) {
      addIssue(
        issues,
        `${resultPath}.red`,
        "invalid_type",
        "Expected a RED evidence object",
      );
      return;
    }
    if (
      typeof baseRevision === "string" &&
      result.inputBaseRevision !== baseRevision
    ) {
      addIssue(
        issues,
        `${resultPath}.inputBaseRevision`,
        "base_mismatch",
        "Result input base must match the ticket base",
      );
    }
    if (
      typeof candidateRevision === "string" &&
      result.candidateRevision !== candidateRevision
    ) {
      addIssue(
        issues,
        `${resultPath}.candidateRevision`,
        "candidate_mismatch",
        "Result must name the state's exact candidate",
      );
    }
    validateSafePath(result.dispatchRef, `${resultPath}.dispatchRef`, issues);
    const red = result.red;
    validateFields(
      red,
      `${resultPath}.red`,
      RED_FIELDS,
      [...RED_FIELDS],
      issues,
    );
    validateNonEmptyString(red.command, `${resultPath}.red.command`, issues);
    validateInteger(red.exitCode, `${resultPath}.red.exitCode`, 0, issues);
    validateNonEmptyString(
      red.expectedFailure,
      `${resultPath}.red.expectedFailure`,
      issues,
    );
    validateNonEmptyString(red.output, `${resultPath}.red.output`, issues);
    validateRevision(
      result.redRevision,
      `$.results[${resultIndex}].redRevision`,
      issues,
    );
    if (red.exitCode === 0) {
      addIssue(
        issues,
        `$.results[${resultIndex}].red.exitCode`,
        "red_must_fail",
        "RED must record a non-zero exit code",
      );
    }
    validateSafePath(red.logRef, `${resultPath}.red.logRef`, issues);
    if (!Array.isArray(red.testFiles)) {
      addIssue(
        issues,
        `${resultPath}.red.testFiles`,
        "invalid_type",
        "Expected a test-file evidence array",
      );
      return;
    }
    if (red.testFiles.length === 0) {
      addIssue(
        issues,
        `$.results[${resultIndex}].red.testFiles`,
        "test_evidence_required",
        "RED must name at least one content-addressed test or check",
      );
    }
    red.testFiles.forEach((testFile, fileIndex) => {
      const testFilePath = `${resultPath}.red.testFiles[${fileIndex}]`;
      if (isRecord(testFile)) {
        validateFields(
          testFile,
          testFilePath,
          TEST_FILE_FIELDS,
          [...TEST_FILE_FIELDS],
          issues,
        );
        validateSafePath(
          testFile.path,
          `${testFilePath}.path`,
          issues,
        );
      } else {
        addIssue(
          issues,
          testFilePath,
          "invalid_type",
          "Expected a test-file evidence object",
        );
      }
      if (isRecord(testFile)) {
        validateSha256(testFile.sha256, `${testFilePath}.sha256`, issues);
      }
    });
    const testFilePaths = new Set<string>();
    red.testFiles.forEach((testFile, fileIndex) => {
      if (!isRecord(testFile) || typeof testFile.path !== "string") return;
      if (testFilePaths.has(testFile.path)) {
        addIssue(
          issues,
          `${resultPath}.red.testFiles[${fileIndex}].path`,
          "duplicate_value",
          "RED test-file paths must be unique",
        );
      }
      testFilePaths.add(testFile.path);
    });
    validateSafePathArray(
      red.productionFiles,
      `${resultPath}.red.productionFiles`,
      issues,
    );
    if (Array.isArray(red.productionFiles) && red.productionFiles.length > 0) {
      addIssue(
        issues,
        `$.results[${resultIndex}].red.productionFiles`,
        "red_production_change",
        "RED production files must remain empty",
      );
    }
    if (isRecord(result.green)) {
      validateFields(
        result.green,
        `${resultPath}.green`,
        GREEN_FIELDS,
        [...GREEN_FIELDS],
        issues,
      );
      validateNonEmptyString(
        result.green.command,
        `${resultPath}.green.command`,
        issues,
      );
      validateInteger(
        result.green.exitCode,
        `${resultPath}.green.exitCode`,
        0,
        issues,
      );
      if (result.green.exitCode !== 0) {
        addIssue(
          issues,
          `${resultPath}.green.exitCode`,
          "green_failed",
          "GREEN must record a zero exit code",
        );
      }
      validateSafePath(
        result.green.logRef,
        `${resultPath}.green.logRef`,
        issues,
      );
      validateSafePathArray(
        result.green.productionFiles,
        `${resultPath}.green.productionFiles`,
        issues,
      );
    } else {
      addIssue(
        issues,
        `${resultPath}.green`,
        "invalid_type",
        "Expected a GREEN evidence object",
      );
    }
    if (isRecord(result.refactor)) {
      validateFields(
        result.refactor,
        `${resultPath}.refactor`,
        REFACTOR_FIELDS,
        [...REFACTOR_FIELDS],
        issues,
      );
      validateNonEmptyString(
        result.refactor.summary,
        `${resultPath}.refactor.summary`,
        issues,
      );
      validateNonEmptyString(
        result.refactor.command,
        `${resultPath}.refactor.command`,
        issues,
      );
      validateInteger(
        result.refactor.exitCode,
        `${resultPath}.refactor.exitCode`,
        0,
        issues,
      );
      if (result.refactor.exitCode !== 0) {
        addIssue(
          issues,
          `${resultPath}.refactor.exitCode`,
          "refactor_failed",
          "REFACTOR must record a zero exit code",
        );
      }
      validateSafePath(
        result.refactor.logRef,
        `${resultPath}.refactor.logRef`,
        issues,
      );
    } else {
      addIssue(
        issues,
        `${resultPath}.refactor`,
        "invalid_type",
        "Expected a REFACTOR evidence object",
      );
    }
  });
}

function validateFinding(
  finding: JsonRecord,
  path: string,
  criterionIds: ReadonlySet<string>,
  contractRefs: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  validateFields(
    finding,
    path,
    FINDING_FIELD_SET,
    FINDING_FIELDS,
    issues,
  );
  for (const field of FINDING_FIELDS) {
    validateNonEmptyString(finding[field], `${path}.${field}`, issues);
  }
  if (
    typeof finding.lens === "string" &&
    !VALID_FINDING_LENSES.has(finding.lens)
  ) {
    addIssue(
      issues,
      `${path}.lens`,
      "invalid_value",
      "Finding lens is invalid",
    );
  }
  if (
    typeof finding.severity === "string" &&
    !VALID_FINDING_SEVERITIES.has(finding.severity)
  ) {
    addIssue(
      issues,
      `${path}.severity`,
      "invalid_value",
      "Finding severity is invalid",
    );
  }
  if (
    typeof finding.status === "string" &&
    !VALID_FINDING_STATUSES.has(finding.status)
  ) {
    addIssue(
      issues,
      `${path}.status`,
      "invalid_value",
      "Finding status is invalid",
    );
  }
  if (
    typeof finding.affectedCriterion === "string" &&
    !criterionIds.has(finding.affectedCriterion)
  ) {
    addIssue(
      issues,
      `${path}.affectedCriterion`,
      "unknown_reference",
      "Finding must reference a known acceptance criterion",
    );
  }
  if (
    typeof finding.contractRef === "string" &&
    !contractRefs.has(finding.contractRef)
  ) {
    addIssue(
      issues,
      `${path}.contractRef`,
      "unknown_reference",
      "Finding must reference a declared contract",
    );
  }
  if (finding.status === "open") {
    addIssue(
      issues,
      `${path}.status`,
      "open_finding",
      "Open findings block ticket acceptance",
    );
  }
}

function validateReviews(
  reviews: unknown,
  baseRevision: unknown,
  candidateRevision: unknown,
  criterionIds: ReadonlySet<string>,
  contractRefs: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(reviews)) {
    addIssue(issues, "$.reviews", "invalid_type", "Expected a reviews array");
    return;
  }
  reviews.forEach((review, reviewIndex) => {
    if (!isRecord(review)) {
      addIssue(
        issues,
        `$.reviews[${reviewIndex}]`,
        "invalid_type",
        "Expected a review object",
      );
      return;
    }
    const reviewPath = `$.reviews[${reviewIndex}]`;
    validateFields(
      review,
      reviewPath,
      REVIEW_FIELDS,
      [...REVIEW_FIELDS],
      issues,
    );
    if (review.schemaVersion !== 1) {
      addIssue(
        issues,
        `${reviewPath}.schemaVersion`,
        "invalid_value",
        "Unsupported review schema version",
      );
    }
    validateNonEmptyString(review.ticketId, `${reviewPath}.ticketId`, issues);
    validateInteger(
      review.ticketRevision,
      `${reviewPath}.ticketRevision`,
      1,
      issues,
    );
    validateInteger(review.round, `${reviewPath}.round`, 1, issues);
    validateNonEmptyString(
      review.implementerRunId,
      `${reviewPath}.implementerRunId`,
      issues,
    );
    validateNonEmptyString(
      review.reviewerRunId,
      `${reviewPath}.reviewerRunId`,
      issues,
    );
    validateRevision(review.baseRevision, `${reviewPath}.baseRevision`, issues);
    validateRevision(
      review.candidateRevision,
      `${reviewPath}.candidateRevision`,
      issues,
    );
    if (
      typeof review.verdict !== "string" ||
      !VALID_REVIEW_VERDICTS.has(review.verdict)
    ) {
      addIssue(
        issues,
        `${reviewPath}.verdict`,
        "invalid_value",
        "Review verdict is invalid",
      );
    }
    if (!Array.isArray(review.commands)) {
      if (review.commands !== undefined) {
        addIssue(
          issues,
          `${reviewPath}.commands`,
          "invalid_type",
          "Expected a review-command array",
        );
      }
    } else {
      review.commands.forEach((command, commandIndex) => {
        const commandPath = `${reviewPath}.commands[${commandIndex}]`;
        if (typeof command === "string") {
          validateNonEmptyString(command, commandPath, issues);
        } else if (isRecord(command)) {
          validateFields(
            command,
            commandPath,
            REVIEW_COMMAND_FIELDS,
            [...REVIEW_COMMAND_FIELDS],
            issues,
          );
          validateNonEmptyString(
            command.command,
            `${commandPath}.command`,
            issues,
          );
          validateInteger(
            command.exitCode,
            `${commandPath}.exitCode`,
            0,
            issues,
          );
        } else {
          addIssue(
            issues,
            commandPath,
            "invalid_type",
            "Expected a command string or result object",
          );
        }
      });
    }
    if (
      typeof baseRevision === "string" && review.baseRevision !== baseRevision
    ) {
      addIssue(
        issues,
        `${reviewPath}.baseRevision`,
        "base_mismatch",
        "Review base must match the ticket base",
      );
    }
    if (
      typeof review.implementerRunId === "string" &&
      review.reviewerRunId === review.implementerRunId
    ) {
      addIssue(
        issues,
        `${reviewPath}.reviewerRunId`,
        "run_id_not_fresh",
        "Reviewer and implementer run IDs must differ",
      );
    }
    if (
      typeof candidateRevision === "string" &&
      review.candidateRevision !== candidateRevision
    ) {
      addIssue(
        issues,
        `${reviewPath}.candidateRevision`,
        "candidate_mismatch",
        "Review must cover the state's exact candidate",
      );
    }
    if (isRecord(review.lenses)) {
      validateFields(
        review.lenses,
        `${reviewPath}.lenses`,
        VALID_FINDING_LENSES,
        REVIEW_LENSES,
        issues,
      );
      for (const lens of REVIEW_LENSES) {
        const lensRecord = review.lenses[lens];
        if (!isRecord(lensRecord)) {
          addIssue(
            issues,
            `${reviewPath}.lenses.${lens}`,
            "lens_missing",
            "Every review lens is required",
          );
          continue;
        }
        validateFields(
          lensRecord,
          `${reviewPath}.lenses.${lens}`,
          LENS_FIELDS,
          [...LENS_FIELDS],
          issues,
        );
        validateStringArray(
          lensRecord.evidence,
          `${reviewPath}.lenses.${lens}.evidence`,
          issues,
          { minimum: 1 },
        );
        if (
          typeof lensRecord.verdict !== "string" ||
          !VALID_LENS_VERDICTS.has(lensRecord.verdict)
        ) {
          addIssue(
            issues,
            `${reviewPath}.lenses.${lens}.verdict`,
            "invalid_value",
            "Review lens verdict is invalid",
          );
        }
      }
    } else {
      addIssue(
        issues,
        `${reviewPath}.lenses`,
        "invalid_type",
        "Expected a review lenses object",
      );
    }
    if (Array.isArray(review.findings)) {
      const findingIds = new Set<string>();
      review.findings.forEach((finding, findingIndex) => {
        if (isRecord(finding)) {
          if (typeof finding.id === "string") {
            if (findingIds.has(finding.id)) {
              addIssue(
                issues,
                `${reviewPath}.findings[${findingIndex}].id`,
                "duplicate_id",
                "Finding IDs must be unique",
              );
            }
            findingIds.add(finding.id);
          }
          validateFinding(
            finding,
            `${reviewPath}.findings[${findingIndex}]`,
            criterionIds,
            contractRefs,
            issues,
          );
        } else {
          addIssue(
            issues,
            `${reviewPath}.findings[${findingIndex}]`,
            "invalid_type",
            "Expected a finding object",
          );
        }
      });
    } else if (review.findings !== undefined) {
      addIssue(
        issues,
        `${reviewPath}.findings`,
        "invalid_type",
        "Expected a findings array",
      );
    }
    validateStringArray(review.notes, `${reviewPath}.notes`, issues);

    if (review.verdict === "APPROVED" && isRecord(review.lenses)) {
      const failedLens = REVIEW_LENSES.some((lens) =>
        isRecord(review.lenses) &&
        isRecord(review.lenses[lens]) &&
        review.lenses[lens].verdict === "fail"
      );
      const unresolvedFinding = Array.isArray(review.findings) &&
        review.findings.some((finding) =>
          isRecord(finding) && finding.status === "open"
        );
      if (failedLens || unresolvedFinding) {
        addIssue(
          issues,
          `${reviewPath}.verdict`,
          "verdict_conflict",
          "An approved review cannot contain failed lenses or open findings",
        );
      }
    }
    if (review.verdict === "CHANGES_REQUESTED" && isRecord(review.lenses)) {
      const failedLens = REVIEW_LENSES.some((lens) =>
        isRecord(review.lenses) &&
        isRecord(review.lenses[lens]) &&
        review.lenses[lens].verdict === "fail"
      );
      const openFinding = Array.isArray(review.findings) &&
        review.findings.some((finding) =>
          isRecord(finding) && finding.status === "open"
        );
      if (!failedLens && !openFinding) {
        addIssue(
          issues,
          `${reviewPath}.verdict`,
          "verdict_conflict",
          "Changes requested requires a failed lens or open finding",
        );
      }
    }
  });
}

function validateState(
  state: JsonRecord,
  ticketId: unknown,
  dependencies: unknown,
  requiredTasks: unknown,
  issues: ValidationIssue[],
): void {
  validateFields(state, "$.state", STATE_FIELDS, [...STATE_FIELDS], issues);
  if (state.schemaVersion !== 1) {
    addIssue(
      issues,
      "$.state.schemaVersion",
      "invalid_value",
      "Unsupported state schema version",
    );
  }
  validateNonEmptyString(state.ticketId, "$.state.ticketId", issues);
  validateInteger(state.ticketRevision, "$.state.ticketRevision", 1, issues);
  if (typeof state.phase !== "string" || !VALID_PHASES.has(state.phase)) {
    addIssue(
      issues,
      "$.state.phase",
      "invalid_value",
      "State phase is invalid",
    );
  }
  validateInteger(state.round, "$.state.round", 0, issues);
  validateRevision(state.baseRevision, "$.state.baseRevision", issues);
  validateNullableRevision(
    state.candidateRevision,
    "$.state.candidateRevision",
    issues,
  );
  validateNullableRevision(
    state.acceptedCandidateRevision,
    "$.state.acceptedCandidateRevision",
    issues,
  );
  if (state.blocker !== null) {
    validateNonEmptyString(state.blocker, "$.state.blocker", issues);
  }
  if (typeof ticketId === "string" && state.ticketId !== ticketId) {
    addIssue(
      issues,
      "$.state.ticketId",
      "ticket_mismatch",
      "State ticket ID must match the ticket packet",
    );
  }
  validateSafePathArray(state.resultRefs, "$.state.resultRefs", issues);
  validateSafePathArray(state.reviewRefs, "$.state.reviewRefs", issues);
  const dependencyRevisions = state.dependencyRevisions;
  if (isRecord(dependencyRevisions)) {
    const knownDependencies = new Set(
      Array.isArray(dependencies)
        ? dependencies.filter((value): value is string =>
          typeof value === "string"
        )
        : [],
    );
    Object.entries(dependencyRevisions).forEach(([dependency, revision]) => {
      validateRevision(
        revision,
        `$.state.dependencyRevisions.${dependency}`,
        issues,
      );
      if (!knownDependencies.has(dependency)) {
        addIssue(
          issues,
          `$.state.dependencyRevisions.${dependency}`,
          "unknown_reference",
          "Dependency revision key is not declared by the ticket",
        );
      }
    });
    if (Array.isArray(dependencies)) {
      dependencies.forEach((dependency) => {
        if (
          typeof dependency === "string" &&
          !REVISION_PATTERN.test(String(dependencyRevisions[dependency] ?? ""))
        ) {
          addIssue(
            issues,
            `$.state.dependencyRevisions.${dependency}`,
            "dependency_unresolved",
            "Dependency requires an exact integrated revision",
          );
        }
      });
    }
  } else {
    addIssue(
      issues,
      "$.state.dependencyRevisions",
      "invalid_type",
      "Expected dependency revision evidence",
    );
  }
  if (
    typeof state.candidateRevision === "string" &&
    state.acceptedCandidateRevision !== state.candidateRevision
  ) {
    addIssue(
      issues,
      "$.state.acceptedCandidateRevision",
      "candidate_mismatch",
      "Accepted candidate must match the current candidate",
    );
  }
  if (Array.isArray(state.openFindingIds)) {
    const findingIds = new Set<string>();
    state.openFindingIds.forEach((_findingId, index) => {
      validateNonEmptyString(
        _findingId,
        `$.state.openFindingIds[${index}]`,
        issues,
      );
      if (typeof _findingId === "string" && findingIds.has(_findingId)) {
        addIssue(
          issues,
          `$.state.openFindingIds[${index}]`,
          "duplicate_value",
          "Open finding IDs must be unique",
        );
      }
      if (typeof _findingId === "string") findingIds.add(_findingId);
      addIssue(
        issues,
        `$.state.openFindingIds[${index}]`,
        "open_finding",
        "Open findings block ticket acceptance",
      );
    });
  } else if (state.openFindingIds !== undefined) {
    addIssue(
      issues,
      "$.state.openFindingIds",
      "invalid_type",
      "Expected an open-finding ID array",
    );
  }

  const commands = new Set<string>();
  const checkRunIds = new Set<string>();
  if (Array.isArray(state.orchestratorChecks)) {
    state.orchestratorChecks.forEach((check, index) => {
      if (!isRecord(check)) {
        addIssue(
          issues,
          `$.state.orchestratorChecks[${index}]`,
          "invalid_type",
          "Expected an orchestrator check object",
        );
        return;
      }
      validateFields(
        check,
        `$.state.orchestratorChecks[${index}]`,
        CHECK_FIELDS,
        [...CHECK_FIELDS],
        issues,
      );
      validateNonEmptyString(
        check.runId,
        `$.state.orchestratorChecks[${index}].runId`,
        issues,
      );
      validateRevision(
        check.revision,
        `$.state.orchestratorChecks[${index}].revision`,
        issues,
      );
      validateNonEmptyString(
        check.command,
        `$.state.orchestratorChecks[${index}].command`,
        issues,
      );
      validateInteger(
        check.exitCode,
        `$.state.orchestratorChecks[${index}].exitCode`,
        0,
        issues,
      );
      if (typeof check.command === "string") {
        if (commands.has(check.command)) {
          addIssue(
            issues,
            `$.state.orchestratorChecks[${index}].command`,
            "duplicate_value",
            "Orchestrator check commands must be unique",
          );
        }
        commands.add(check.command);
      }
      if (typeof check.runId === "string") {
        if (checkRunIds.has(check.runId)) {
          addIssue(
            issues,
            `$.state.orchestratorChecks[${index}].runId`,
            "duplicate_value",
            "Orchestrator check run IDs must be unique",
          );
        }
        checkRunIds.add(check.runId);
      }
      if (check.exitCode !== 0) {
        addIssue(
          issues,
          `$.state.orchestratorChecks[${index}].exitCode`,
          "check_failed",
          "Orchestrator checks must pass",
        );
      }
      if (
        typeof state.candidateRevision === "string" &&
        check.revision !== state.candidateRevision
      ) {
        addIssue(
          issues,
          `$.state.orchestratorChecks[${index}].revision`,
          "candidate_mismatch",
          "Orchestrator checks must cover the exact candidate",
        );
      }
    });
  } else if (state.orchestratorChecks !== undefined) {
    addIssue(
      issues,
      "$.state.orchestratorChecks",
      "invalid_type",
      "Expected an orchestrator-check array",
    );
  }
  if (
    Array.isArray(requiredTasks) &&
    requiredTasks.some((task) =>
      typeof task === "string" && !commands.has(`deno task ${task}`)
    )
  ) {
    addIssue(
      issues,
      "$.state.orchestratorChecks",
      "check_missing",
      "Every required task needs an orchestrator check",
    );
  }
}

function validateLifecycle(
  bundle: JsonRecord,
  ticket: JsonRecord,
  state: JsonRecord,
  issues: ValidationIssue[],
): void {
  const phase = state.phase;
  const events = Array.isArray(state.events) ? state.events : [];
  const results = Array.isArray(bundle.results) ? bundle.results : [];
  const reviews = Array.isArray(bundle.reviews) ? bundle.reviews : [];
  const resultRefs = Array.isArray(state.resultRefs) ? state.resultRefs : [];
  const reviewRefs = Array.isArray(state.reviewRefs) ? state.reviewRefs : [];
  const candidatePhases = new Set([
    "review",
    "rework",
    "accepted",
    "integrated",
  ]);
  const reviewedPhases = new Set(["rework", "accepted", "integrated"]);

  if (
    events.length === 0 || !isRecord(events[0]) ||
    events[0].from !== "planned" || !isRecord(events.at(-1)) ||
    events.at(-1)?.to !== phase
  ) {
    addIssue(
      issues,
      "$.state.events",
      "lifecycle_incomplete",
      "The lifecycle must start at planned and end at the declared phase",
    );
  }

  if (candidatePhases.has(String(phase))) {
    if (results.length === 0 || resultRefs.length !== results.length) {
      addIssue(
        issues,
        "$.results",
        "lifecycle_incomplete",
        "Candidate phases require exactly referenced implementation results",
      );
    }
    if (typeof state.candidateRevision !== "string") {
      addIssue(
        issues,
        "$.state.candidateRevision",
        "candidate_required",
        "Candidate phases require an exact candidate revision",
      );
    }
  }

  if (reviewedPhases.has(String(phase))) {
    if (reviews.length === 0 || reviewRefs.length !== reviews.length) {
      addIssue(
        issues,
        "$.reviews",
        "review_required",
        "The declared phase requires exactly referenced reviews",
      );
    }
  }

  if (phase === "accepted" || phase === "integrated") {
    const review = reviews.at(-1);
    if (!isRecord(review) || review.verdict !== "APPROVED") {
      addIssue(
        issues,
        "$.reviews",
        "review_required",
        "Acceptance requires an approved review of the exact candidate",
      );
    }
    if (state.acceptedCandidateRevision !== state.candidateRevision) {
      addIssue(
        issues,
        "$.state.acceptedCandidateRevision",
        "candidate_mismatch",
        "Acceptance must identify the current candidate",
      );
    }
    if (
      !Array.isArray(state.orchestratorChecks) ||
      state.orchestratorChecks.length === 0
    ) {
      addIssue(
        issues,
        "$.state.orchestratorChecks",
        "check_missing",
        "Acceptance requires independent orchestrator checks",
      );
    }
  }

  if (state.ticketRevision !== ticket.revision) {
    addIssue(
      issues,
      "$.state.ticketRevision",
      "ticket_revision_mismatch",
      "State ticket revision must match the ticket packet",
    );
  }
  if (state.baseRevision !== ticket.baseRevision) {
    addIssue(
      issues,
      "$.state.baseRevision",
      "base_mismatch",
      "State base revision must match the ticket packet",
    );
  }

  const resultsByRound = new Map<number, JsonRecord>();
  results.forEach((value, index) => {
    if (!isRecord(value)) return;
    if (value.ticketId !== ticket.ticketId) {
      addIssue(
        issues,
        `$.results[${index}].ticketId`,
        "ticket_mismatch",
        "Result ticket ID must match the ticket packet",
      );
    }
    if (value.ticketRevision !== ticket.revision) {
      addIssue(
        issues,
        `$.results[${index}].ticketRevision`,
        "ticket_revision_mismatch",
        "Result ticket revision must match the ticket packet",
      );
    }
    if (typeof value.round === "number") {
      resultsByRound.set(value.round, value);
    }
  });

  reviews.forEach((value, index) => {
    if (!isRecord(value)) return;
    if (value.ticketId !== ticket.ticketId) {
      addIssue(
        issues,
        `$.reviews[${index}].ticketId`,
        "ticket_mismatch",
        "Review ticket ID must match the ticket packet",
      );
    }
    if (value.ticketRevision !== ticket.revision) {
      addIssue(
        issues,
        `$.reviews[${index}].ticketRevision`,
        "ticket_revision_mismatch",
        "Review ticket revision must match the ticket packet",
      );
    }
    const result = resultsByRound.get(value.round as number);
    if (result === undefined || value.round !== state.round) {
      addIssue(
        issues,
        `$.reviews[${index}].round`,
        "round_mismatch",
        "Review round must match its result and the current state",
      );
    }
    if (
      result !== undefined &&
      value.implementerRunId !== result.implementerRunId
    ) {
      addIssue(
        issues,
        `$.reviews[${index}].implementerRunId`,
        "run_mismatch",
        "Review must identify the round implementer",
      );
    }
  });

  events.forEach((value, index) => {
    if (!isRecord(value) || typeof value.round !== "number") return;
    const result = resultsByRound.get(value.round);
    if (result === undefined) return;
    if (
      (value.to === "red" || value.to === "green" ||
        value.to === "refactor") &&
      value.actorRunId !== result.implementerRunId
    ) {
      addIssue(
        issues,
        `$.state.events[${index}].actorRunId`,
        "run_mismatch",
        "Implementation transitions must identify the round implementer",
      );
    }
  });
}

export function validateTicketBundle(
  bundle: unknown,
  availableTasks: ReadonlySet<string>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(bundle)) {
    addIssue(issues, "$", "invalid_type", "Expected a ticket bundle object");
    return issues;
  }
  validateFields(bundle, "$", BUNDLE_FIELDS, [...BUNDLE_FIELDS], issues);
  const ticket = isRecord(bundle.ticket) ? bundle.ticket : undefined;
  const state = isRecord(bundle.state) ? bundle.state : undefined;
  const criterionIds = new Set<string>();
  const contractRefs = new Set<string>();
  if (ticket !== undefined) {
    if (Array.isArray(ticket.acceptanceCriteria)) {
      ticket.acceptanceCriteria.forEach((criterion) => {
        if (isRecord(criterion) && typeof criterion.id === "string") {
          criterionIds.add(criterion.id);
        }
      });
    }
    if (Array.isArray(ticket.contractRefs)) {
      ticket.contractRefs.forEach((reference) => {
        if (typeof reference === "string") contractRefs.add(reference);
      });
    }
  }
  if (ticket === undefined) {
    if ("ticket" in bundle) {
      addIssue(issues, "$.ticket", "invalid_type", "Expected a ticket object");
    }
  } else {
    validateTicket(ticket, availableTasks, issues);
  }
  if (state === undefined) {
    if ("state" in bundle) {
      addIssue(issues, "$.state", "invalid_type", "Expected a state object");
    }
  } else {
    validateEvents(state.events, issues);
    validateState(
      state,
      ticket?.ticketId,
      ticket?.dependencies,
      ticket?.requiredTasks,
      issues,
    );
    validateReviews(
      bundle.reviews,
      ticket?.baseRevision,
      state.candidateRevision,
      criterionIds,
      contractRefs,
      issues,
    );
    if (ticket !== undefined) {
      validateLifecycle(bundle, ticket, state, issues);
    }
    if (
      Array.isArray(bundle.events) && Array.isArray(state.events) &&
      JSON.stringify(bundle.events) !== JSON.stringify(state.events)
    ) {
      addIssue(
        issues,
        "$.events",
        "ledger_mismatch",
        "The event ledger must exactly match the state event summary",
      );
    }
  }
  validateResults(
    bundle.results,
    ticket?.baseRevision,
    state?.candidateRevision,
    issues,
  );
  return issues.sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
  );
}
