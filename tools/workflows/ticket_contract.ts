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
  if (typeof value === "string" && !REVISION_PATTERN.test(value)) {
    addIssue(issues, path, "invalid_revision", "Expected a full Git revision");
  }
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
  if (typeof value === "string" && !isSafeRepositoryPath(value)) {
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
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSafePath(item, `${path}[${index}]`, issues)
    );
  }
}

function validateTicket(
  ticket: JsonRecord,
  availableTasks: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  for (const field of REQUIRED_TICKET_FIELDS) {
    if (!(field in ticket)) {
      addIssue(
        issues,
        `$.ticket.${field}`,
        "required_field",
        "Required ticket field is missing",
      );
    }
  }

  if (ticket.schemaVersion !== 1) {
    addIssue(
      issues,
      "$.ticket.schemaVersion",
      "invalid_value",
      "Unsupported ticket schema version",
    );
  }

  for (const field of Object.keys(ticket).sort()) {
    if (!TICKET_FIELDS.has(field)) {
      addIssue(
        issues,
        `$.ticket.${field}`,
        "unknown_field",
        "Unknown ticket field",
      );
    }
  }

  validateRevision(ticket.baseRevision, "$.ticket.baseRevision", issues);

  if (Array.isArray(ticket.acceptanceCriteria)) {
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
      if (typeof criterion.id === "string") {
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
    });
  }

  if (Array.isArray(ticket.allowedWrites)) {
    ticket.allowedWrites.forEach((path, index) => {
      validateSafePath(path, `$.ticket.allowedWrites[${index}]`, issues);
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
      if (
        isRecord(testFile) && typeof testFile.sha256 === "string" &&
        !SHA256_PATTERN.test(testFile.sha256)
      ) {
        addIssue(
          issues,
          `$.results[${resultIndex}].red.testFiles[${fileIndex}].sha256`,
          "invalid_sha256",
          "Expected a lowercase SHA-256 digest",
        );
      }
    });
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
    }
  });
}

function validateFinding(
  finding: JsonRecord,
  path: string,
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
    if (!(field in finding)) {
      addIssue(
        issues,
        `${path}.${field}`,
        "required_field",
        "Required finding field is missing",
      );
    }
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
        if (
          !Array.isArray(lensRecord.evidence) ||
          lensRecord.evidence.length === 0
        ) {
          addIssue(
            issues,
            `${reviewPath}.lenses.${lens}.evidence`,
            "evidence_required",
            "Review lens evidence cannot be empty",
          );
        }
        if (
          lensRecord.verdict !== "pass" && lensRecord.verdict !== "fail" &&
          lensRecord.verdict !== "not_applicable"
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
    state.openFindingIds.forEach((_findingId, index) => {
      addIssue(
        issues,
        `$.state.openFindingIds[${index}]`,
        "open_finding",
        "Open findings block ticket acceptance",
      );
    });
  }

  const commands = new Set<string>();
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
      if (typeof check.command === "string") {
        commands.add(check.command);
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
      issues,
    );
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
