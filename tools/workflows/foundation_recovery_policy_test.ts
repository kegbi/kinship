import {
  COVERAGE_POLICY_FILES,
  DELIVERY_POLICY_FILES,
  OBSOLETE_WORKFLOW_PATHS,
  type PolicyIssue,
  type RecoverySnapshot,
  validateFoundationRecovery,
} from "./foundation_recovery_policy.ts";

const AUTHORITATIVE_POLICY_FILES = [
  "AGENTS.md",
  "docs/architecture/quality-gates.md",
  "docs/architecture/technology-baseline.md",
  "docs/planning/README.md",
  "docs/planning/roadmap.md",
  "docs/planning/quality-and-operations.md",
  "docs/development/autonomous-delivery.md",
  ".agents/skills/run-tdd-ticket-loop/SKILL.md",
] as const;

const RETIRED_RUNTIME_GRAPH_PATHS = [
  "tools/runtime/FND-003",
  "docs/validation/runtime-graph-fnd003.json",
  "docs/validation/runtime-graph-fnd003.md",
] as const;

const INPUT_PATHS = [
  ...new Set([
    ...COVERAGE_POLICY_FILES,
    ...DELIVERY_POLICY_FILES,
    "deno.json",
    "pnpm-workspace.yaml",
    "package.json",
    ".gitignore",
  ]),
];

function repositorySnapshot(): RecoverySnapshot {
  const files = Object.fromEntries(
    INPUT_PATHS.map((path) => [path, Deno.readTextFileSync(path)]),
  );
  const existingPaths = new Set<string>();
  for (
    const path of [...OBSOLETE_WORKFLOW_PATHS, ...RETIRED_RUNTIME_GRAPH_PATHS]
  ) {
    try {
      Deno.statSync(path);
      existingPaths.add(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return { files, existingPaths };
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function mutate(
  snapshot: RecoverySnapshot,
  path: string,
  transform: (contents: string) => string,
): RecoverySnapshot {
  return {
    ...snapshot,
    files: { ...snapshot.files, [path]: transform(snapshot.files[path] ?? "") },
  };
}

function issueCodes(issues: PolicyIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.code))].sort();
}

function withWorkflowCoverageTask(
  snapshot: RecoverySnapshot,
  command: string,
): RecoverySnapshot {
  return mutate(snapshot, "deno.json", (contents) => {
    const config = JSON.parse(contents) as { tasks: Record<string, string> };
    config.tasks["test:workflow:coverage"] = command;
    return JSON.stringify(config);
  });
}

function withDenoConfig(
  snapshot: RecoverySnapshot,
  transform: (config: Record<string, unknown>) => void,
): RecoverySnapshot {
  return mutate(snapshot, "deno.json", (contents) => {
    const config = JSON.parse(contents) as Record<string, unknown>;
    transform(config);
    return JSON.stringify(config);
  });
}

Deno.test("repository satisfies the foundation recovery policy", () => {
  assertEquals(validateFoundationRecovery(repositorySnapshot()), []);
});

Deno.test("validator rejects coverage and delivery policy regression", () => {
  let snapshot = repositorySnapshot();
  snapshot = mutate(
    snapshot,
    "AGENTS.md",
    (value) =>
      value.replace("80% line, branch, and function", "70% line and function"),
  );
  snapshot = mutate(
    snapshot,
    ".agents/skills/run-tdd-ticket-loop/SKILL.md",
    (value) => `${value}\ncontrollerRunId\n`,
  );
  assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
    "coverage.minimum",
    "coverage.superseded",
    "delivery.obsolete",
  ]);
});

Deno.test("validator rejects retired concepts in supported delivery policy", () => {
  const retiredDirections = [
    "Persist ticket artifacts for every delivery.",
    "Record state transitions in the delivery workflow.",
    "Use a state machine as the current supported workflow.",
  ];

  for (const path of DELIVERY_POLICY_FILES) {
    for (const direction of retiredDirections) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${direction}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "delivery.obsolete", path },
      ]);
    }
  }
});

Deno.test("coverage policy inventory includes every authoritative policy", () => {
  assertEquals(COVERAGE_POLICY_FILES, AUTHORITATIVE_POLICY_FILES);
});

Deno.test("validator rejects production branch coverage regression in every policy input", () => {
  for (const path of AUTHORITATIVE_POLICY_FILES) {
    const snapshot = mutate(
      repositorySnapshot(),
      path,
      (contents) =>
        `${contents}\nProduction branch coverage may fall to 70%.\n`,
    );
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "coverage.superseded", path },
    ]);
  }
});

Deno.test("validator rejects backend and frontend coverage regressions in every policy input", () => {
  const conflictingClaims = [
    "The backend TypeScript gate is 70% for lines, branches, and functions.",
    "The frontend TypeScript gate is 70% for lines, branches, and functions.",
  ];

  for (const path of AUTHORITATIVE_POLICY_FILES) {
    for (const claim of conflictingClaims) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${claim}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "coverage.superseded", path },
      ]);
    }
  }
});

Deno.test("validator rejects split production coverage thresholds in every policy input", () => {
  const conflictingClaims = [
    [
      "Production line coverage may fall to 70%.",
      "Production branch coverage may fall to 70%.",
      "Production function coverage may fall to 70%.",
    ].join("\n"),
    [
      "- 79 percent may be accepted for production branch coverage.",
      "- Function coverage in production may be 70%.",
      "- Production coverage at 100 percentage for lines is accepted.",
    ].join("\n"),
    "| Production line coverage may fall to 70% |",
  ];

  for (const path of COVERAGE_POLICY_FILES) {
    for (const claims of conflictingClaims) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${claims}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "coverage.superseded", path },
      ]);
    }
  }
});

Deno.test("validator rejects production coverage caps in every policy input", () => {
  const cappedClaims = [
    "Production line, branch, and function coverage may be at most 80%.",
    "Production line, branch, and function coverage may be up to 80%.",
    "Production line, branch, and function coverage has a maximum 80%.",
    "Production line, branch, and function coverage may be no more than 80%.",
  ];

  for (const path of COVERAGE_POLICY_FILES) {
    for (const claim of cappedClaims) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${claim}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "coverage.superseded", path },
      ]);
    }
  }
});

Deno.test("validator rejects controlled coverage assertion bypasses in every policy input", () => {
  const conflictingClaims = [
    "Production test coverage has a 70% floor.",
    "The backend coverage minimum is 70%.",
    "Server-side line, branch, and function coverage may be 70%.",
    "Frontend lines, branches, and functions are capped at 80%.",
    "Production line, branch, and function coverage must be at least seventy-nine percent.",
    "The backend line, branch, and function coverage rate must be 0.79.",
  ];

  for (const path of AUTHORITATIVE_POLICY_FILES) {
    for (const claim of conflictingClaims) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${claim}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "coverage.superseded", path },
      ]);
    }
  }
});

Deno.test("validator allows percentages outside production coverage claims", () => {
  const allowedClaims = [
    "Production imports may contain 70% known records.",
    "Line coverage may fall to 70% in a local fixture.",
    "Branches may be sampled at 70 percent outside production.",
    "Function coverage may be 70 percentage in examples.",
    "Production imports may contain at most 80% known records.",
    "Local fixture line coverage may be up to 80%.",
    "Branch selection has a maximum 80% sampling cap.",
    "Example function coverage may be no more than 80%.",
  ].join("\n");

  for (const path of COVERAGE_POLICY_FILES) {
    const snapshot = mutate(
      repositorySnapshot(),
      path,
      (contents) => `${contents}\n${allowedClaims}\n`,
    );
    assertEquals(validateFoundationRecovery(snapshot), []);
  }
});

Deno.test("validator rejects unsupported protected-agent workflow directions", () => {
  const directions = [
    "Follow .codex/agents/orchestrator.toml for role dispatch.",
    "Follow .codex\\agents\\orchestrator.toml for role dispatch.",
    "Follow .CODEX \\\\ agents\\orchestrator.toml for role dispatch.",
    "Follow `.codex\\agents\\orchestrator.toml` for role dispatch.",
    'Follow ".codex" / "agents" / "orchestrator.toml" for role dispatch.',
    "Role dispatch may reference project custom agents.",
    "Use .codex/agents for role dispatch.",
    "Use project custom agents for role dispatch.",
  ];

  for (const path of AUTHORITATIVE_POLICY_FILES) {
    for (const direction of directions) {
      const snapshot = mutate(
        repositorySnapshot(),
        path,
        (contents) => `${contents}\n${direction}\n`,
      );
      assertEquals(validateFoundationRecovery(snapshot), [
        { code: "delivery.unsupported-agent-path", path },
      ]);
    }
  }
});

Deno.test("validator rejects toolchain drift and obsolete workflow paths", () => {
  let snapshot = repositorySnapshot();
  snapshot = mutate(
    snapshot,
    "deno.json",
    (value) => value.replace("--threshold=80", "--threshold=79"),
  );
  snapshot = mutate(
    snapshot,
    "package.json",
    (value) => value.replace(">=24.0.0 <25", "24.19.0"),
  );
  snapshot = mutate(
    snapshot,
    ".gitignore",
    (value) => value.replace("node_modules/", ""),
  );
  snapshot = {
    ...snapshot,
    existingPaths: new Set([OBSOLETE_WORKFLOW_PATHS[0]]),
  };
  assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
    "toolchain.deno",
    "toolchain.ignore",
    "toolchain.node",
    "workflow.obsolete-path",
  ]);
});

Deno.test("validator rejects check-only tests and retired runtime graph artifacts", () => {
  const hiddenTest = withDenoConfig(repositorySnapshot(), (config) => {
    const tasks = config.tasks as Record<string, string>;
    tasks.check += " tools/runtime/example_contract_test.ts";
  });
  assertEquals(validateFoundationRecovery(hiddenTest), [
    { code: "toolchain.hidden-test", path: "deno.json" },
  ]);

  for (const path of RETIRED_RUNTIME_GRAPH_PATHS) {
    const snapshot = repositorySnapshot();
    assertEquals(
      validateFoundationRecovery({
        ...snapshot,
        existingPaths: new Set([...snapshot.existingPaths, path]),
      }),
      [{ code: "runtime.retired-artifact", path }],
    );
  }
});

Deno.test("validator rejects quoted and standard test targets in the root check task", () => {
  const testTargets = [
    '"tools/runtime/quoted_contract_test.ts"',
    "'tools/runtime/quoted-contract.test.ts'",
    "tools/runtime/unquoted-contract.test.ts",
  ];

  for (const testTarget of testTargets) {
    const snapshot = withDenoConfig(repositorySnapshot(), (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks.check += ` ${testTarget}`;
    });
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "toolchain.hidden-test", path: "deno.json" },
    ]);
  }
});

Deno.test("validator rejects missing and no-op dependency bootstrap tasks", () => {
  const taskNames = [
    "deps:deno",
    "deps:deno:offline",
    "deps:node",
    "deps:node:offline",
    "deps",
  ];

  for (const taskName of taskNames) {
    const missing = withDenoConfig(repositorySnapshot(), (config) => {
      delete (config.tasks as Record<string, string>)[taskName];
    });
    assertEquals(validateFoundationRecovery(missing), [
      { code: "toolchain.dependencies", path: "deno.json" },
    ]);

    const noOp = withDenoConfig(repositorySnapshot(), (config) => {
      (config.tasks as Record<string, string>)[taskName] =
        "deno eval \"console.log('done')\"";
    });
    assertEquals(validateFoundationRecovery(noOp), [
      { code: "toolchain.dependencies", path: "deno.json" },
    ]);
  }
});

Deno.test("validator rejects unfrozen, unpaired, and lock-mutating dependency bootstrap", () => {
  const mutations: Array<(config: Record<string, unknown>) => void> = [
    (config) => {
      (config.lock as Record<string, unknown>).frozen = false;
    },
    (config) => {
      delete (config.lock as Record<string, unknown>).frozen;
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:deno:offline"] = tasks["deps:deno"]!;
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:node:offline"] = tasks["deps:node"]!;
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks.deps = "deno task deps:deno";
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:deno"] += " --lock-write";
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:node"] = "pnpm install --no-frozen-lockfile";
    },
  ];

  for (const mutation of mutations) {
    const snapshot = withDenoConfig(repositorySnapshot(), mutation);
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "toolchain.dependencies", path: "deno.json" },
    ]);
  }
});

Deno.test("validator requires canonical Deno and root pnpm lock configuration", () => {
  const denoLockMutations: Array<(config: Record<string, unknown>) => void> = [
    (config) => {
      (config.lock as Record<string, unknown>).path = "./other.lock";
    },
    (config) => {
      delete (config.lock as Record<string, unknown>).path;
    },
  ];

  for (const mutation of denoLockMutations) {
    const snapshot = withDenoConfig(repositorySnapshot(), mutation);
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "toolchain.dependencies", path: "deno.json" },
    ]);
  }

  const pnpmLockMutations = [
    (contents: string) => contents.replace(/^lockfile: true\r?\n/m, ""),
    (contents: string) =>
      contents.replace(
        /^sharedWorkspaceLockfile: true\r?\n/m,
        "",
      ),
    (contents: string) =>
      contents.replace(
        /^gitBranchLockfile: false\r?\n/m,
        "",
      ),
    (contents: string) =>
      contents.replace(/^lockfile: true$/m, "lockfile: false"),
    (contents: string) =>
      contents.replace(
        /^sharedWorkspaceLockfile: true$/m,
        "sharedWorkspaceLockfile: false",
      ),
    (contents: string) =>
      contents.replace(
        /^gitBranchLockfile: false$/m,
        "gitBranchLockfile: true",
      ),
    (contents: string) => `${contents}\nlockfileDir: ./other\n`,
  ];

  for (const mutation of pnpmLockMutations) {
    const snapshot = mutate(
      repositorySnapshot(),
      "pnpm-workspace.yaml",
      mutation,
    );
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "toolchain.dependencies", path: "pnpm-workspace.yaml" },
    ]);
  }
});

Deno.test("validator enforces the documented exact frozen-install syntax", () => {
  const mutations: Array<(config: Record<string, unknown>) => void> = [
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:deno"] = tasks["deps:deno"]!.replace(
        "--frozen",
        "--frozen=true",
      );
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:node"] = "pnpm i --frozen-lockfile";
    },
    (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks["deps:node"] += " --lockfile-dir=other";
    },
  ];

  for (const mutation of mutations) {
    const snapshot = withDenoConfig(repositorySnapshot(), mutation);
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "toolchain.dependencies", path: "deno.json" },
    ]);
  }
});

Deno.test("validator allows immaterial dependency command formatting", () => {
  const snapshot = withDenoConfig(repositorySnapshot(), (config) => {
    const tasks = config.tasks as Record<string, string>;
    tasks["deps:deno"] =
      "DENO_NO_PACKAGE_JSON=1   deno install --node-modules-dir=none --frozen";
    tasks["deps:deno:offline"] =
      "DENO_NO_PACKAGE_JSON=1 deno   install --cached-only --node-modules-dir=none --frozen";
    tasks["deps:node"] = "pnpm   install --frozen-lockfile";
    tasks["deps:node:offline"] = "pnpm install --frozen-lockfile --offline";
    tasks.deps = "deno task deps:deno   &&   deno task deps:node";
  });
  assertEquals(validateFoundationRecovery(snapshot), []);
});

Deno.test("validator enumerates every removed workflow asset", () => {
  const expectedPaths = [
    "tools/workflows/ticket_contract.ts",
    "tools/workflows/validate_ticket.ts",
    "tools/workflows/validate_ticket_test.ts",
    ".agents/skills/run-tdd-ticket-loop/assets/acceptance.template.md",
    ".agents/skills/run-tdd-ticket-loop/assets/dispatch.template.md",
    ".agents/skills/run-tdd-ticket-loop/assets/events.template.jsonl",
    ".agents/skills/run-tdd-ticket-loop/assets/finding-waiver.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/not-applicable-lens.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/result.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/review.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/state.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.json",
    ".agents/skills/run-tdd-ticket-loop/assets/ticket.template.md",
  ];
  assertEquals(OBSOLETE_WORKFLOW_PATHS, expectedPaths);

  for (const path of expectedPaths) {
    const snapshot = {
      ...repositorySnapshot(),
      existingPaths: new Set([path]),
    };
    assertEquals(validateFoundationRecovery(snapshot), [
      { code: "workflow.obsolete-path", path },
    ]);
  }
});

Deno.test("validator keeps ticket history out of formatter scope", () => {
  const missingHistoryExclusion = mutate(
    repositorySnapshot(),
    "deno.json",
    (contents) => {
      const config = JSON.parse(contents) as {
        fmt: { exclude?: string[] };
      };
      delete config.fmt.exclude;
      return JSON.stringify(config);
    },
  );
  assertEquals(validateFoundationRecovery(missingHistoryExclusion), [
    { code: "toolchain.formatter-history", path: "deno.json" },
  ]);
});

Deno.test("validator rejects non-executable workflow coverage tasks", () => {
  const validCommand =
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/workflows --clean tools/workflows/foundation_recovery_policy_test.ts && deno coverage --include=tools/workflows/foundation_recovery_policy\\.ts$ --detailed --threshold=80 .coverage/workflows";
  const invalidCommands = [
    "DENO_NO_PACKAGE_JSON=1 deno eval --threshold=80 \"console.log('covered')\"",
    validCommand.split(" && ")[1] ?? "",
    validCommand.split(" && ")[0] ?? "",
    validCommand.replace(
      "--include=tools/workflows/foundation_recovery_policy\\.ts$",
      "--include=tools/workflows/other\\.ts$",
    ),
    validCommand.replace("--threshold=80", "--threshold=79"),
    `${validCommand} || DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
    validCommand.replace("deno test", "deno test --filter=no-tests"),
    validCommand.replace("deno test", "deno test --quiet"),
    `${validCommand} > /dev/null`,
    `${validCommand} ; DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
    `${validCommand} | DENO_NO_PACKAGE_JSON=1 deno eval \"Deno.exit(0)\"`,
  ];

  for (const command of invalidCommands) {
    const snapshot = withWorkflowCoverageTask(repositorySnapshot(), command);
    assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
      "toolchain.deno",
    ]);
  }
});

Deno.test("validator rejects filtered, redirected, and masked canonical workflow tests", () => {
  const validWorkflowCommand =
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read tools/workflows/foundation_recovery_policy_test.ts";
  const validCoverageCommand =
    "DENO_NO_PACKAGE_JSON=1 deno test --allow-read --coverage=.coverage/workflows --clean tools/workflows/foundation_recovery_policy_test.ts && deno coverage --include=tools/workflows/foundation_recovery_policy\\.ts$ --detailed --threshold=80 .coverage/workflows";
  const mutations: ReadonlyArray<readonly [taskName: string, command: string]> =
    [
      [
        "test:workflow",
        validWorkflowCommand.replace("deno test", "deno test --filter=never"),
      ],
      [
        "test:workflow",
        `${validWorkflowCommand} || deno eval "Deno.exit(0)"`,
      ],
      ["test:workflow", `${validWorkflowCommand} > NUL`],
      [
        "test:workflow:coverage",
        validCoverageCommand.replace("deno test", "deno test --filter=never"),
      ],
      [
        "test:workflow:coverage",
        `${validCoverageCommand} || deno eval "Deno.exit(0)"`,
      ],
      ["test:workflow:coverage", `${validCoverageCommand} > NUL`],
    ];

  for (const [taskName, command] of mutations) {
    const snapshot = withDenoConfig(repositorySnapshot(), (config) => {
      const tasks = config.tasks as Record<string, string>;
      tasks[taskName] = command;
    });
    assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [
      "toolchain.deno",
    ]);
  }
});

Deno.test("validator retains every mandatory test class in policy inputs", () => {
  const cases: ReadonlyArray<
    readonly [path: string, removed: string | RegExp, issueCode: string]
  > = [
    ["AGENTS.md", "changed behavior", "tests.changed-behavior"],
    [
      "AGENTS.md",
      "Required user flows still need end-to-end coverage",
      "tests.required-e2e",
    ],
    ["AGENTS.md", "security/tenant boundaries", "tests.security-tenant"],
    ["AGENTS.md", "schema behavior", "tests.schema"],
    [
      "docs/architecture/quality-gates.md",
      "Every new or changed production behavior",
      "tests.changed-behavior",
    ],
    [
      "docs/architecture/quality-gates.md",
      /Every defined user-facing workflow[\s\S]*?have end-to-end coverage\./,
      "tests.required-e2e",
    ],
    [
      "docs/architecture/quality-gates.md",
      "rejection of every cross-workspace relationship path;",
      "tests.security-tenant",
    ],
    [
      "docs/architecture/quality-gates.md",
      "## Required Schema Tests",
      "tests.schema",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "a regression or changed-behavior test for every production change;",
      "tests.changed-behavior",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "all required cataloged Playwright flows before a flow is delivered;",
      "tests.required-e2e",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "authorization, workspace-isolation, and other security boundary tests;",
      "tests.security-tenant",
    ],
    [
      "docs/development/autonomous-delivery.md",
      "the PostgreSQL schema matrix for schema or harness changes;",
      "tests.schema",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "Changed-behavior tests",
      "tests.changed-behavior",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "required E2E flows",
      "tests.required-e2e",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "security and tenant-isolation tests",
      "tests.security-tenant",
    ],
    [
      ".agents/skills/run-tdd-ticket-loop/SKILL.md",
      "schema tests",
      "tests.schema",
    ],
  ];

  for (const [path, removed, issueCode] of cases) {
    const snapshot = mutate(
      repositorySnapshot(),
      path,
      (contents) =>
        contents.replace(removed, "policy requirement removed for mutation"),
    );
    assertEquals(issueCodes(validateFoundationRecovery(snapshot)), [issueCode]);
  }
});

Deno.test("validator fails closed when a required policy input is absent", () => {
  const snapshot = repositorySnapshot();
  const files = { ...snapshot.files };
  delete files["AGENTS.md"];
  let message = "";
  try {
    validateFoundationRecovery({ ...snapshot, files });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertEquals(message, "missing policy input: AGENTS.md");
});
