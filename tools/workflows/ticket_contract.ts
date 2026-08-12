import { createHash } from "node:crypto";

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

type JsonRecord = Record<string, unknown>;

const MAX_GIT_TEST_REFERENCES = 100;

const REVISION_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LEGACY_TICKET_IDENTITY_DIGESTS: Readonly<
  Record<string, ReadonlySet<string>>
> = {
  "PILOT-001": new Set([
    "8f167cc3a211a49862dc23be0d54dba3fb187e119c8e62aa03b24aceeed717d1",
  ]),
  "PILOT-002": new Set([
    "640d43ed67a4bef5597bc2dcf86c735d060e3ea6cbef3893e91fe0ad3aa99b24",
  ]),
};

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
  "integrationRevision",
  "integrationChecks",
  "blocker",
]);

const RESULT_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "ticketRevision",
  "round",
  "implementerRunId",
  "issuedByControllerRunId",
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
  "issuedByControllerRunId",
  "baseRevision",
  "candidateRevision",
  "verdict",
  "commands",
  "lenses",
  "findings",
  "notes",
]);
const REQUIRED_LENS_FIELDS = ["verdict", "evidence"] as const;
const LENS_FIELDS = new Set([
  "verdict",
  "evidence",
  "notApplicableAgreement",
]);
const NOT_APPLICABLE_AGREEMENT_FIELDS = new Set([
  "orchestratorRunId",
  "scopeOrContractRef",
  "rationale",
]);
const WAIVER_FIELDS = new Set([
  "authority",
  "rationale",
  "owner",
  "expiresAt",
]);

const REQUIRED_TASK_COLLECTION_FIELDS = new Set(["baseline", "candidate"]);
const BASELINE_TASK_FIELDS = new Set(["name", "definition"]);
const CANDIDATE_TASK_FIELDS = new Set([
  "name",
  "definition",
  "guardedBy",
]);
const PROTECTED_WRITE_AUTHORIZATION_FIELDS = new Set([
  "authorizedByControllerRunId",
  "paths",
  "contractRef",
  "rationale",
]);

const TICKET_FIELDS = new Set([
  "schemaVersion",
  "ticketId",
  "revision",
  "title",
  "outcome",
  "baseRevision",
  "controllerRunId",
  "executionClass",
  "protectedWriteAuthorization",
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

const REQUIRED_FINDING_FIELDS = [
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
const FINDING_FIELD_SET = new Set<string>([
  ...REQUIRED_FINDING_FIELDS,
  "waiver",
]);

export type WorkflowPhase =
  | "planned"
  | "ready"
  | "red"
  | "green"
  | "refactor"
  | "review"
  | "rework"
  | "accepted"
  | "integrated"
  | "blocked"
  | "cancelled";

type TransitionActor = "implementer" | "reviewer" | "orchestrator";
type TransitionRevision =
  | "base"
  | "red"
  | "candidate"
  | "integration"
  | "unbound";
type TransitionEvidence =
  | "ticket"
  | "red"
  | "green"
  | "refactor"
  | "result"
  | "review"
  | "acceptance"
  | "integration"
  | "unbound";

interface WorkflowTransitionRule {
  readonly from: WorkflowPhase;
  readonly to: WorkflowPhase;
  readonly actor: TransitionActor;
  readonly revision: TransitionRevision;
  readonly evidence: TransitionEvidence;
  readonly round: "zero" | "first" | "same" | "next";
}

interface WorkflowPhaseRule {
  readonly requiresCandidate: boolean;
  readonly requiresReview: boolean;
  readonly requiresAcceptanceClosure: boolean;
}

export interface WorkflowPolicy {
  readonly phases: Readonly<Record<WorkflowPhase, WorkflowPhaseRule>>;
  readonly transitions: readonly WorkflowTransitionRule[];
  readonly round: {
    readonly initial: number;
    readonly firstImplementation: number;
  };
  readonly evidence: {
    readonly ticket: string;
    readonly acceptance: string;
    readonly integration: string;
    readonly roundRecords: Readonly<
      Partial<Record<TransitionEvidence, string>>
    >;
  };
}

export const WORKFLOW_POLICY: WorkflowPolicy = {
  phases: {
    planned: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    ready: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    red: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    green: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    refactor: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    review: {
      requiresCandidate: true,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    rework: {
      requiresCandidate: true,
      requiresReview: true,
      requiresAcceptanceClosure: false,
    },
    accepted: {
      requiresCandidate: true,
      requiresReview: true,
      requiresAcceptanceClosure: true,
    },
    integrated: {
      requiresCandidate: true,
      requiresReview: true,
      requiresAcceptanceClosure: true,
    },
    blocked: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
    cancelled: {
      requiresCandidate: false,
      requiresReview: false,
      requiresAcceptanceClosure: false,
    },
  },
  transitions: [
    {
      from: "planned",
      to: "ready",
      actor: "orchestrator",
      revision: "base",
      evidence: "ticket",
      round: "zero",
    },
    {
      from: "planned",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "zero",
    },
    {
      from: "ready",
      to: "red",
      actor: "implementer",
      revision: "red",
      evidence: "red",
      round: "first",
    },
    {
      from: "ready",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "zero",
    },
    {
      from: "red",
      to: "green",
      actor: "implementer",
      revision: "candidate",
      evidence: "green",
      round: "same",
    },
    {
      from: "red",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "same",
    },
    {
      from: "green",
      to: "refactor",
      actor: "implementer",
      revision: "candidate",
      evidence: "refactor",
      round: "same",
    },
    {
      from: "green",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "same",
    },
    {
      from: "refactor",
      to: "review",
      actor: "orchestrator",
      revision: "candidate",
      evidence: "result",
      round: "same",
    },
    {
      from: "refactor",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "same",
    },
    {
      from: "review",
      to: "accepted",
      actor: "orchestrator",
      revision: "candidate",
      evidence: "acceptance",
      round: "same",
    },
    {
      from: "review",
      to: "rework",
      actor: "reviewer",
      revision: "candidate",
      evidence: "review",
      round: "same",
    },
    {
      from: "review",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "same",
    },
    {
      from: "rework",
      to: "red",
      actor: "implementer",
      revision: "red",
      evidence: "red",
      round: "next",
    },
    {
      from: "rework",
      to: "blocked",
      actor: "orchestrator",
      revision: "unbound",
      evidence: "unbound",
      round: "same",
    },
    {
      from: "accepted",
      to: "integrated",
      actor: "orchestrator",
      revision: "integration",
      evidence: "integration",
      round: "same",
    },
  ],
  round: { initial: 0, firstImplementation: 1 },
  evidence: {
    ticket: "ticket.json",
    acceptance: "acceptance.md",
    integration: "integration.md",
    roundRecords: { result: "results", review: "reviews" },
  },
};

const TRANSITION_BY_KEY = new Map(
  WORKFLOW_POLICY.transitions.map((transition) => [
    `${transition.from}:${transition.to}`,
    transition,
  ]),
);

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

function phaseRule(value: unknown): WorkflowPhaseRule | undefined {
  return typeof value === "string" && VALID_PHASES.has(value)
    ? WORKFLOW_POLICY.phases[value as WorkflowPhase]
    : undefined;
}
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

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validateRunId(
  value: unknown,
  path: string,
  ticketId: unknown,
  role: "orchestrator" | "implementer" | "reviewer",
  round: number,
  issues: ValidationIssue[],
): value is string {
  if (!validateNonEmptyString(value, path, issues)) return false;
  const segments = value.split("/");
  if (
    typeof ticketId !== "string" || segments.length !== 4 ||
    segments[0] !== ticketId || segments[1] !== role ||
    segments[2] !== `r${round}` || !UUID_PATTERN.test(String(segments[3]))
  ) {
    addIssue(
      issues,
      path,
      "run_id_invalid",
      "Run ID must bind the ticket, role, round, and UUID",
    );
    return false;
  }
  return true;
}

function isControllerCheckRunId(
  value: string,
  controllerRunId: string,
): boolean {
  return value.startsWith(`${controllerRunId}/`) &&
    value.length > controllerRunId.length + 1;
}

function pathHasSegment(value: string, segment: string): boolean {
  const normalizedSegment = segment.toLowerCase();
  return value.split("/").some((part) =>
    part.toLowerCase() === normalizedSegment
  );
}

function isProtectedControlPath(value: string): boolean {
  const first = value.split("/")[0]?.toLowerCase();
  return first === ".codex" || first === ".agents";
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function validateTaskRecords(
  value: unknown,
  path: string,
  fields: ReadonlySet<string>,
  candidate: boolean,
  availableTasks: ReadonlySet<string>,
  issues: ValidationIssue[],
): readonly JsonRecord[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      addIssue(issues, path, "invalid_type", "Expected a task array");
    }
    return [];
  }
  const names = new Set<string>();
  const records: JsonRecord[] = [];
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, "invalid_type", "Expected a task object");
      return;
    }
    records.push(entry);
    validateFields(entry, entryPath, fields, [...fields], issues);
    if (validateNonEmptyString(entry.name, `${entryPath}.name`, issues)) {
      if (names.has(entry.name)) {
        addIssue(
          issues,
          `${entryPath}.name`,
          "duplicate_value",
          "Task names must be unique",
        );
      }
      names.add(entry.name);
      if (!availableTasks.has(entry.name)) {
        addIssue(
          issues,
          `${entryPath}.name`,
          "task_missing",
          "Required Deno task is unavailable",
        );
      }
    }
    validateNonEmptyString(entry.definition, `${entryPath}.definition`, issues);
    if (candidate && entry.guardedBy !== null) {
      validateNonEmptyString(entry.guardedBy, `${entryPath}.guardedBy`, issues);
    }
  });
  return records;
}

function validateRequiredTasksV2(
  value: unknown,
  availableTasks: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    if (value !== undefined) {
      addIssue(
        issues,
        "$.ticket.requiredTasks",
        "invalid_type",
        "Expected baseline and candidate task definitions",
      );
    }
    return;
  }
  validateFields(
    value,
    "$.ticket.requiredTasks",
    REQUIRED_TASK_COLLECTION_FIELDS,
    [...REQUIRED_TASK_COLLECTION_FIELDS],
    issues,
  );
  const baseline = validateTaskRecords(
    value.baseline,
    "$.ticket.requiredTasks.baseline",
    BASELINE_TASK_FIELDS,
    false,
    availableTasks,
    issues,
  );
  const candidate = validateTaskRecords(
    value.candidate,
    "$.ticket.requiredTasks.candidate",
    CANDIDATE_TASK_FIELDS,
    true,
    availableTasks,
    issues,
  );
  const baselineNames = baseline.map((entry) => entry.name);
  const candidateNames = candidate.map((entry) => entry.name);
  if (
    baselineNames.every((name): name is string => typeof name === "string") &&
    candidateNames.every((name): name is string => typeof name === "string") &&
    !sameStrings(baselineNames, candidateNames)
  ) {
    addIssue(
      issues,
      "$.ticket.requiredTasks.candidate",
      "task_set_mismatch",
      "Baseline and candidate task names must match",
    );
  }
}

function candidateTaskNames(requiredTasks: unknown): readonly string[] {
  if (Array.isArray(requiredTasks)) {
    return requiredTasks.filter((value): value is string =>
      typeof value === "string"
    );
  }
  if (!isRecord(requiredTasks) || !Array.isArray(requiredTasks.candidate)) {
    return [];
  }
  return requiredTasks.candidate.flatMap((value) =>
    isRecord(value) && typeof value.name === "string" ? [value.name] : []
  );
}

function validateExecutionAuthority(
  ticket: JsonRecord,
  issues: ValidationIssue[],
): void {
  validateRunId(
    ticket.controllerRunId,
    "$.ticket.controllerRunId",
    ticket.ticketId,
    "orchestrator",
    0,
    issues,
  );
  if (
    ticket.executionClass !== "ordinary" &&
    ticket.executionClass !== "protected-config-maintenance"
  ) {
    addIssue(
      issues,
      "$.ticket.executionClass",
      "invalid_value",
      "Execution class is invalid",
    );
  }
  const allowedWrites = Array.isArray(ticket.allowedWrites)
    ? ticket.allowedWrites.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  allowedWrites.forEach((value, index) => {
    if (pathHasSegment(value, ".git")) {
      addIssue(
        issues,
        `$.ticket.allowedWrites[${index}]`,
        "git_path_forbidden",
        ".git is never an authorized write path",
      );
    } else if (
      ticket.executionClass === "ordinary" && isProtectedControlPath(value)
    ) {
      addIssue(
        issues,
        `$.ticket.allowedWrites[${index}]`,
        "protected_path_forbidden",
        "Ordinary tickets cannot write protected control paths",
      );
    }
  });
  if (ticket.executionClass === "ordinary") {
    if (ticket.protectedWriteAuthorization !== null) {
      addIssue(
        issues,
        "$.ticket.protectedWriteAuthorization",
        "authorization_forbidden",
        "Ordinary tickets cannot carry protected-write authority",
      );
    }
    return;
  }
  if (!isRecord(ticket.protectedWriteAuthorization)) {
    addIssue(
      issues,
      "$.ticket.protectedWriteAuthorization",
      "authorization_required",
      "Protected maintenance requires controller authorization",
    );
    return;
  }
  const authorization = ticket.protectedWriteAuthorization;
  validateFields(
    authorization,
    "$.ticket.protectedWriteAuthorization",
    PROTECTED_WRITE_AUTHORIZATION_FIELDS,
    [...PROTECTED_WRITE_AUTHORIZATION_FIELDS],
    issues,
  );
  validateNonEmptyString(
    authorization.authorizedByControllerRunId,
    "$.ticket.protectedWriteAuthorization.authorizedByControllerRunId",
    issues,
  );
  if (authorization.authorizedByControllerRunId !== ticket.controllerRunId) {
    addIssue(
      issues,
      "$.ticket.protectedWriteAuthorization.authorizedByControllerRunId",
      "controller_mismatch",
      "Protected-write authority must come from the ticket controller",
    );
  }
  validateSafePathArray(
    authorization.paths,
    "$.ticket.protectedWriteAuthorization.paths",
    issues,
  );
  const authorizationPaths = Array.isArray(authorization.paths)
    ? authorization.paths.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  const protectedAllowedWrites = allowedWrites.filter(isProtectedControlPath);
  if (!sameStrings(protectedAllowedWrites, authorizationPaths)) {
    addIssue(
      issues,
      "$.ticket.protectedWriteAuthorization.paths",
      "authorization_mismatch",
      "Protected authorization paths must exactly match protected allowed writes",
    );
  }
  validateNonEmptyString(
    authorization.contractRef,
    "$.ticket.protectedWriteAuthorization.contractRef",
    issues,
  );
  validateNonEmptyString(
    authorization.rationale,
    "$.ticket.protectedWriteAuthorization.rationale",
    issues,
  );
}

function validateTicket(
  ticket: JsonRecord,
  availableTasks: ReadonlySet<string>,
  issues: ValidationIssue[],
): void {
  const schemaVersion = ticket.schemaVersion;
  const v2 = schemaVersion === 2;
  const requiredFields = v2
    ? REQUIRED_TICKET_FIELDS
    : REQUIRED_TICKET_FIELDS.filter((field) =>
      field !== "controllerRunId" && field !== "executionClass" &&
      field !== "protectedWriteAuthorization"
    );
  validateFields(
    ticket,
    "$.ticket",
    TICKET_FIELDS,
    requiredFields,
    issues,
  );
  if (schemaVersion === 1) {
    const ticketId = typeof ticket.ticketId === "string" ? ticket.ticketId : "";
    if (!(ticketId in LEGACY_TICKET_IDENTITY_DIGESTS)) {
      addIssue(
        issues,
        "$.ticket.schemaVersion",
        "legacy_schema_forbidden",
        "Only grandfathered PILOT packets may use schema version 1",
      );
    }
  } else if (schemaVersion !== 2) {
    addIssue(
      issues,
      "$.ticket.schemaVersion",
      "invalid_value",
      "Unsupported ticket schema version",
    );
  } else if (
    !("controllerRunId" in ticket) || !("executionClass" in ticket) ||
    !("protectedWriteAuthorization" in ticket) ||
    !isRecord(ticket.requiredTasks)
  ) {
    addIssue(
      issues,
      "$.ticket.schemaVersion",
      "invalid_value",
      "Schema version 2 requires the complete v2 ticket contract",
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
  if (v2) {
    validateRequiredTasksV2(ticket.requiredTasks, availableTasks, issues);
    validateExecutionAuthority(ticket, issues);
  } else {
    validateStringArray(
      ticket.requiredTasks,
      "$.ticket.requiredTasks",
      issues,
      { unique: true },
    );
  }
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

  if (!v2 && Array.isArray(ticket.requiredTasks)) {
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
      !TRANSITION_BY_KEY.has(`${from}:${to}`) ||
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
  ticket: JsonRecord | undefined,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(results)) {
    addIssue(issues, "$.results", "invalid_type", "Expected a results array");
    return;
  }
  let testReferenceCount = 0;
  results.forEach((result, resultIndex) => {
    const resultPath = `$.results[${resultIndex}]`;
    if (!isRecord(result)) {
      addIssue(issues, resultPath, "invalid_type", "Expected a result object");
      return;
    }
    const v2 = ticket?.schemaVersion === 2;
    const requiredResultFields = v2
      ? [...RESULT_FIELDS]
      : [...RESULT_FIELDS].filter((field) =>
        field !== "issuedByControllerRunId"
      );
    validateFields(
      result,
      resultPath,
      RESULT_FIELDS,
      requiredResultFields,
      issues,
    );
    if (result.schemaVersion !== (v2 ? 2 : 1)) {
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
    if (v2 && typeof result.round === "number") {
      validateRunId(
        result.implementerRunId,
        `${resultPath}.implementerRunId`,
        ticket?.ticketId,
        "implementer",
        result.round,
        issues,
      );
      validateNonEmptyString(
        result.issuedByControllerRunId,
        `${resultPath}.issuedByControllerRunId`,
        issues,
      );
      if (result.issuedByControllerRunId !== ticket?.controllerRunId) {
        addIssue(
          issues,
          `${resultPath}.issuedByControllerRunId`,
          "controller_mismatch",
          "Implementation result must be issued by the ticket controller",
        );
      }
    } else {
      validateNonEmptyString(
        result.implementerRunId,
        `${resultPath}.implementerRunId`,
        issues,
      );
    }
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
    testReferenceCount += red.testFiles.length;
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
  if (testReferenceCount > MAX_GIT_TEST_REFERENCES) {
    addIssue(
      issues,
      "$.results",
      "reference_limit",
      "Git test evidence exceeds the aggregate reference limit",
    );
  }
}

function validateFinding(
  finding: JsonRecord,
  path: string,
  criterionIds: ReadonlySet<string>,
  contractRefs: ReadonlySet<string>,
  blocksOpenFindings: boolean,
  issues: ValidationIssue[],
): void {
  validateFields(
    finding,
    path,
    FINDING_FIELD_SET,
    REQUIRED_FINDING_FIELDS,
    issues,
  );
  for (const field of REQUIRED_FINDING_FIELDS) {
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
  if (finding.status === "open" && blocksOpenFindings) {
    addIssue(
      issues,
      `${path}.status`,
      "open_finding",
      "Open findings block ticket acceptance",
    );
  }
  if (finding.status === "waived") {
    const nonWaivable = finding.severity === "P0" ||
      finding.severity === "P1" || finding.lens === "security_privacy" ||
      finding.lens === "architecture_contracts" || finding.lens === "tests_tdd";
    if (nonWaivable) {
      addIssue(
        issues,
        `${path}.status`,
        "waiver_forbidden",
        "This finding category cannot be waived",
      );
    }
    const waiver = { ...(finding.waiver as JsonRecord | undefined) };
    validateFields(
      waiver,
      `${path}.waiver`,
      WAIVER_FIELDS,
      [...WAIVER_FIELDS],
      issues,
    );
    for (const field of WAIVER_FIELDS) {
      validateNonEmptyString(
        waiver[field],
        `${path}.waiver.${field}`,
        issues,
      );
    }
    if (!(Date.parse(String(waiver.expiresAt)) > Date.now())) {
      addIssue(
        issues,
        `${path}.waiver.expiresAt`,
        "waiver_expired",
        "Waiver authority must have a valid future expiry",
      );
    }
  }
}

function validateReviews(
  reviews: unknown,
  ticket: JsonRecord | undefined,
  baseRevision: unknown,
  phase: unknown,
  criterionIds: ReadonlySet<string>,
  contractRefs: ReadonlySet<string>,
  scopeOrContractRefs: ReadonlySet<string>,
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
    const v2 = ticket?.schemaVersion === 2;
    const requiredReviewFields = v2
      ? [...REVIEW_FIELDS]
      : [...REVIEW_FIELDS].filter((field) =>
        field !== "issuedByControllerRunId"
      );
    const blocksOpenFindings = phaseRule(phase)?.requiresAcceptanceClosure ===
      true;
    validateFields(
      review,
      reviewPath,
      REVIEW_FIELDS,
      requiredReviewFields,
      issues,
    );
    if (review.schemaVersion !== (v2 ? 2 : 1)) {
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
    if (v2 && typeof review.round === "number") {
      validateRunId(
        review.implementerRunId,
        `${reviewPath}.implementerRunId`,
        ticket?.ticketId,
        "implementer",
        review.round,
        issues,
      );
      validateRunId(
        review.reviewerRunId,
        `${reviewPath}.reviewerRunId`,
        ticket?.ticketId,
        "reviewer",
        review.round,
        issues,
      );
      validateNonEmptyString(
        review.issuedByControllerRunId,
        `${reviewPath}.issuedByControllerRunId`,
        issues,
      );
      if (review.issuedByControllerRunId !== ticket?.controllerRunId) {
        addIssue(
          issues,
          `${reviewPath}.issuedByControllerRunId`,
          "controller_mismatch",
          "Review must be issued by the ticket controller",
        );
      }
    } else {
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
    }
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
      if (review.verdict === "APPROVED" && review.commands.length === 0) {
        addIssue(
          issues,
          `${reviewPath}.commands`,
          "evidence_required",
          "Approved reviews require successful command evidence",
        );
      }
      const commandNames = new Set<string>();
      review.commands.forEach((command, commandIndex) => {
        const commandPath = `${reviewPath}.commands[${commandIndex}]`;
        if (isRecord(command)) {
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
          if (typeof command.command === "string") {
            if (commandNames.has(command.command)) {
              addIssue(
                issues,
                `${commandPath}.command`,
                "duplicate_value",
                "Review commands must be unique",
              );
            }
            commandNames.add(command.command);
          }
          if (review.verdict === "APPROVED" && command.exitCode !== 0) {
            addIssue(
              issues,
              `${commandPath}.exitCode`,
              "review_command_failed",
              "Approved review commands must pass",
            );
          }
        } else {
          addIssue(
            issues,
            commandPath,
            "invalid_type",
            "Expected a review-command result object",
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
          REQUIRED_LENS_FIELDS,
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
        const agreementPath =
          `${reviewPath}.lenses.${lens}.notApplicableAgreement`;
        if (lensRecord.verdict === "not_applicable") {
          if (!isRecord(lensRecord.notApplicableAgreement)) {
            addIssue(
              issues,
              agreementPath,
              "agreement_required",
              "Not-applicable lenses require orchestrator agreement",
            );
          } else {
            const agreement = lensRecord.notApplicableAgreement;
            validateFields(
              agreement,
              agreementPath,
              NOT_APPLICABLE_AGREEMENT_FIELDS,
              [...NOT_APPLICABLE_AGREEMENT_FIELDS],
              issues,
            );
            for (const field of NOT_APPLICABLE_AGREEMENT_FIELDS) {
              validateNonEmptyString(
                agreement[field],
                `${agreementPath}.${field}`,
                issues,
              );
            }
            if (
              typeof agreement.scopeOrContractRef === "string" &&
              !scopeOrContractRefs.has(agreement.scopeOrContractRef)
            ) {
              addIssue(
                issues,
                `${agreementPath}.scopeOrContractRef`,
                "unknown_reference",
                "Agreement must cite declared scope or a contract",
              );
            }
          }
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
            blocksOpenFindings,
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

function validateChecks(
  value: unknown,
  path: string,
  requiredTasks: readonly string[],
  exactRevision: string | undefined,
  revisionIssueCode: string,
  controllerRunId: string | undefined,
  requirePassing: boolean,
  checkRunIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      addIssue(
        issues,
        path,
        "invalid_type",
        "Expected an orchestrator-check array",
      );
    }
    return;
  }
  const commands = new Set<string>();
  value.forEach((check, index) => {
    const checkPath = `${path}[${index}]`;
    if (!isRecord(check)) {
      addIssue(
        issues,
        checkPath,
        "invalid_type",
        "Expected an orchestrator check object",
      );
      return;
    }
    validateFields(check, checkPath, CHECK_FIELDS, [...CHECK_FIELDS], issues);
    validateNonEmptyString(check.runId, `${checkPath}.runId`, issues);
    validateRevision(check.revision, `${checkPath}.revision`, issues);
    validateNonEmptyString(check.command, `${checkPath}.command`, issues);
    validateInteger(check.exitCode, `${checkPath}.exitCode`, 0, issues);
    if (
      typeof check.runId === "string" && controllerRunId !== undefined &&
      !isControllerCheckRunId(check.runId, controllerRunId)
    ) {
      addIssue(
        issues,
        `${checkPath}.runId`,
        "controller_mismatch",
        "Orchestrator check must use controller-issued authority",
      );
    }
    if (typeof check.command === "string") {
      if (commands.has(check.command)) {
        addIssue(
          issues,
          `${checkPath}.command`,
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
          `${checkPath}.runId`,
          "duplicate_value",
          "Orchestrator check run IDs must be unique",
        );
      }
      checkRunIds.add(check.runId);
    }
    if (requirePassing && check.exitCode !== 0) {
      addIssue(
        issues,
        `${checkPath}.exitCode`,
        "check_failed",
        "Orchestrator checks must pass",
      );
    }
    if (
      exactRevision !== undefined && check.revision !== exactRevision
    ) {
      addIssue(
        issues,
        `${checkPath}.revision`,
        revisionIssueCode,
        "Orchestrator checks must cover the exact lifecycle revision",
      );
    }
  });
  if (
    requirePassing &&
    requiredTasks.some((task) => !commands.has(`deno task ${task}`))
  ) {
    addIssue(
      issues,
      path,
      "check_missing",
      "Every required task needs an orchestrator check",
    );
  }
}

function validateState(
  state: JsonRecord,
  ticketId: unknown,
  dependencies: unknown,
  requiredTasks: unknown,
  controllerRunId: unknown,
  issues: ValidationIssue[],
): void {
  const integratedPhase = state.phase === "integrated";
  const durableIntegratedPhase = integratedPhase &&
    typeof controllerRunId === "string";
  const requiredStateFields = durableIntegratedPhase
    ? [...STATE_FIELDS]
    : [...STATE_FIELDS].filter((field) =>
      field !== "integrationRevision" && field !== "integrationChecks"
    );
  validateFields(
    state,
    "$.state",
    STATE_FIELDS,
    requiredStateFields,
    issues,
  );
  const acceptancePhase = phaseRule(state.phase)?.requiresAcceptanceClosure ===
    true;
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
  if (state.integrationRevision !== undefined) {
    validateRevision(
      state.integrationRevision,
      "$.state.integrationRevision",
      issues,
    );
  }
  if (
    durableIntegratedPhase && typeof state.integrationRevision !== "string"
  ) {
    addIssue(
      issues,
      "$.state.integrationRevision",
      "integration_required",
      "Integrated state requires a durable integration revision",
    );
  }
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
    acceptancePhase &&
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
      if (acceptancePhase) {
        addIssue(
          issues,
          `$.state.openFindingIds[${index}]`,
          "open_finding",
          "Open findings block ticket acceptance",
        );
      }
    });
  } else if (state.openFindingIds !== undefined) {
    addIssue(
      issues,
      "$.state.openFindingIds",
      "invalid_type",
      "Expected an open-finding ID array",
    );
  }

  const checkRunIds = new Set<string>();
  const taskNames = candidateTaskNames(requiredTasks);
  validateChecks(
    state.orchestratorChecks,
    "$.state.orchestratorChecks",
    taskNames,
    acceptancePhase && typeof state.candidateRevision === "string"
      ? state.candidateRevision
      : undefined,
    "candidate_mismatch",
    typeof controllerRunId === "string" ? controllerRunId : undefined,
    acceptancePhase,
    checkRunIds,
    issues,
  );
  if (durableIntegratedPhase) {
    validateChecks(
      state.integrationChecks,
      "$.state.integrationChecks",
      taskNames,
      typeof state.integrationRevision === "string"
        ? state.integrationRevision
        : undefined,
      "integration_mismatch",
      controllerRunId,
      true,
      checkRunIds,
      issues,
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
  const maxRounds = Number(ticket.maxRounds);
  const v2 = ticket.schemaVersion === 2;
  const currentPhaseRule = phaseRule(phase);
  const acceptancePhase = currentPhaseRule?.requiresAcceptanceClosure === true;

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

  if (currentPhaseRule?.requiresCandidate === true) {
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

  if (currentPhaseRule?.requiresReview === true) {
    if (reviews.length === 0 || reviewRefs.length !== reviews.length) {
      addIssue(
        issues,
        "$.reviews",
        "review_required",
        "The declared phase requires exactly referenced reviews",
      );
    }
  }

  if (acceptancePhase) {
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
  if (
    typeof state.round === "number" && state.round > maxRounds
  ) {
    addIssue(
      issues,
      "$.state.round",
      "round_limit_exceeded",
      "State round exceeds the ticket maximum",
    );
  }

  const resultsByRound = new Map<number, JsonRecord>();
  const implementerRunIds = new Set<string>();
  results.forEach((value, index) => {
    if (!isRecord(value)) return;
    if (v2 && typeof value.implementerRunId === "string") {
      if (implementerRunIds.has(value.implementerRunId)) {
        addIssue(
          issues,
          `$.results[${index}].implementerRunId`,
          "run_id_not_fresh",
          "Each implementation round requires a fresh run ID",
        );
      }
      implementerRunIds.add(value.implementerRunId);
    }
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
    const expectedRound = index + WORKFLOW_POLICY.round.firstImplementation;
    if (value.round !== expectedRound) {
      addIssue(
        issues,
        `$.results[${index}].round`,
        "round_sequence",
        "Implementation result rounds must be contiguous and one-based",
      );
    }
    if (
      typeof value.round === "number" && value.round > maxRounds
    ) {
      addIssue(
        issues,
        `$.results[${index}].round`,
        "round_limit_exceeded",
        "Implementation result exceeds the ticket maximum round",
      );
    }
    const previousResult = index > 0 && isRecord(results[index - 1])
      ? results[index - 1]
      : undefined;
    if (
      index === 0 && typeof ticket.baseRevision === "string" &&
      value.inputBaseRevision !== ticket.baseRevision
    ) {
      addIssue(
        issues,
        `$.results[${index}].inputBaseRevision`,
        "base_mismatch",
        "The first implementation round must begin at the ticket base",
      );
    } else if (
      index > 0 && previousResult !== undefined &&
      value.inputBaseRevision !== previousResult.candidateRevision
    ) {
      addIssue(
        issues,
        `$.results[${index}].inputBaseRevision`,
        "round_chain_mismatch",
        "Each implementation round must begin at the prior candidate",
      );
    }
    if (typeof value.round === "number") {
      resultsByRound.set(value.round, value);
    }
  });

  const lastResult = results.at(-1);
  if (currentPhaseRule?.requiresCandidate === true && isRecord(lastResult)) {
    if (state.candidateRevision !== lastResult.candidateRevision) {
      addIssue(
        issues,
        `$.results[${results.length - 1}].candidateRevision`,
        "candidate_mismatch",
        "Latest implementation candidate must match the state candidate",
      );
    }
    if (state.round !== lastResult.round) {
      addIssue(
        issues,
        "$.state.round",
        "round_mismatch",
        "State round must match the latest implementation result",
      );
    }
  }

  const reviewsByRound = new Map<number, JsonRecord>();
  const reviewerRunIds = new Set<string>();
  reviews.forEach((value, index) => {
    if (!isRecord(value)) return;
    if (v2 && typeof value.reviewerRunId === "string") {
      if (reviewerRunIds.has(value.reviewerRunId)) {
        addIssue(
          issues,
          `$.reviews[${index}].reviewerRunId`,
          "run_id_not_fresh",
          "Each review round requires a fresh run ID",
        );
      }
      reviewerRunIds.add(value.reviewerRunId);
    }
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
    if (result === undefined) {
      addIssue(
        issues,
        `$.reviews[${index}].round`,
        "round_mismatch",
        "Review round must match an implementation result",
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
    if (
      result !== undefined &&
      value.candidateRevision !== result.candidateRevision
    ) {
      addIssue(
        issues,
        `$.reviews[${index}].candidateRevision`,
        "candidate_mismatch",
        "Review must cover its round's exact candidate",
      );
    }
    if (typeof value.round === "number") {
      reviewsByRound.set(value.round, value);
    }
  });

  let activeRound = WORKFLOW_POLICY.round.initial;
  events.forEach((value, index) => {
    if (!isRecord(value) || typeof value.round !== "number") return;
    const transition = typeof value.from === "string" &&
        typeof value.to === "string"
      ? TRANSITION_BY_KEY.get(`${value.from}:${value.to}`)
      : undefined;
    if (transition === undefined) return;
    const expectedRound = transition.round === "zero"
      ? WORKFLOW_POLICY.round.initial
      : transition.round === "first"
      ? WORKFLOW_POLICY.round.firstImplementation
      : transition.round === "next"
      ? activeRound + 1
      : activeRound;
    if (value.round !== expectedRound) {
      addIssue(
        issues,
        `$.state.events[${index}].round`,
        "round_mismatch",
        "Lifecycle transition must use its derived implementation round",
      );
    }
    if (transition.round === "first" || transition.round === "next") {
      activeRound = expectedRound!;
    }
    const result = resultsByRound.get(expectedRound);
    if (transition.round !== "zero" && result === undefined) {
      addIssue(
        issues,
        `$.state.events[${index}].round`,
        "round_mismatch",
        "Lifecycle transition must bind to an implementation round",
      );
      return;
    }
    if (
      expectedRound > maxRounds
    ) {
      addIssue(
        issues,
        `$.state.events[${index}].round`,
        "round_limit_exceeded",
        "Lifecycle transition exceeds the ticket maximum round",
      );
    }
    const roundResult = result ?? {};
    const expectedRevision: Readonly<Record<TransitionRevision, unknown>> = {
      base: ticket.baseRevision,
      red: roundResult.redRevision,
      candidate: roundResult.candidateRevision,
      integration: state.integrationRevision,
      unbound: undefined,
    };
    const revisionRule = !v2 && transition.from === "accepted" &&
        transition.to === "integrated"
      ? "candidate"
      : transition.revision;
    if (
      typeof expectedRevision[revisionRule] === "string" &&
      value.revision !== expectedRevision[revisionRule]
    ) {
      addIssue(
        issues,
        `$.state.events[${index}].revision`,
        "revision_mismatch",
        "Lifecycle transition revision must match its round evidence",
      );
    }
    const review = reviewsByRound.get(expectedRound);
    const expectedActor = transition.actor === "implementer"
      ? result?.implementerRunId
      : transition.actor === "reviewer"
      ? review?.reviewerRunId
      : v2
      ? ticket.controllerRunId
      : undefined;
    if (
      typeof expectedActor === "string" && value.actorRunId !== expectedActor
    ) {
      addIssue(
        issues,
        `$.state.events[${index}].actorRunId`,
        transition.actor === "orchestrator"
          ? "controller_mismatch"
          : "run_mismatch",
        "Lifecycle transition actor must match its round evidence",
      );
    }
  });
}

function validateLegacyPacketIdentity(
  ticket: JsonRecord,
  issues: ValidationIssue[],
): void {
  if (ticket.schemaVersion !== 1 || typeof ticket.ticketId !== "string") return;
  const allowedDigests = LEGACY_TICKET_IDENTITY_DIGESTS[ticket.ticketId];
  if (allowedDigests === undefined) return;
  const identityDigest = sha256Json(ticket);
  if (allowedDigests.has(identityDigest)) return;
  addIssue(
    issues,
    "$.ticket.schemaVersion",
    "legacy_packet_mismatch",
    "Legacy packet identity does not match an immutable historical fixture",
  );
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
  const scopeOrContractRefs = new Set<string>();
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
        if (typeof reference === "string") {
          contractRefs.add(reference);
          scopeOrContractRefs.add(reference);
        }
      });
    }
    if (Array.isArray(ticket.scope)) {
      ticket.scope.forEach((scope) => {
        if (typeof scope === "string") scopeOrContractRefs.add(scope);
      });
    }
  }
  if (ticket === undefined) {
    if ("ticket" in bundle) {
      addIssue(issues, "$.ticket", "invalid_type", "Expected a ticket object");
    }
  } else {
    validateTicket(ticket, availableTasks, issues);
    validateLegacyPacketIdentity(ticket, issues);
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
      ticket?.controllerRunId,
      issues,
    );
    validateReviews(
      bundle.reviews,
      ticket,
      ticket?.baseRevision,
      state.phase,
      criterionIds,
      contractRefs,
      scopeOrContractRefs,
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
    ticket,
    issues,
  );
  return issues.sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
  );
}
