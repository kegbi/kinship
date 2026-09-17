/**
 * The single source of truth for repository test, coverage, and type-check
 * composition.
 *
 * `deno.json` keeps a small stable verb vocabulary; every verb delegates to
 * `tools/tasks/run.ts`, which reads this manifest. Permission sets, test file
 * lists, and coverage includes are declared once here instead of being copied
 * across task strings.
 *
 * `tools/tasks/manifest_test.ts` proves the manifest stays complete: every test
 * file is reachable from root `test` or documented as on-demand, every
 * production file is inside some coverage include, and no test file has two
 * unit homes.
 */

export type PermissionScope = "all" | readonly string[];

export interface Permissions {
  readonly env?: PermissionScope;
  readonly read?: PermissionScope;
  readonly write?: PermissionScope;
  readonly net?: PermissionScope;
  readonly run?: readonly string[];
}

export interface TestSet {
  /** Test module paths, or glob patterns for the vitest runner. */
  readonly tests: readonly string[];
  readonly permissions?: Permissions;
  readonly runner?: "deno" | "vitest";
  /** The set needs a disposable PostgreSQL project around it. */
  readonly postgres?: boolean;
}

export interface CoverageSet extends TestSet {
  /** Raw coverage directory under `.coverage/`. */
  readonly directory: string;
  /** Production paths measured by this set. */
  readonly include: readonly string[];
  /**
   * Minimum line, branch, and function percentage. Defaults to
   * `DEFAULT_COVERAGE_THRESHOLD`; a set raises it when its code carries a
   * higher obligation than the repository floor, as the shared kernel does.
   */
  readonly threshold?: number;
}

/** The repository coverage floor every set meets unless it declares more. */
export const DEFAULT_COVERAGE_THRESHOLD = 80;

export interface OnDemand {
  /** Why the set cannot belong to the aggregate gates. */
  readonly reason: string;
  /** Optional dedicated `deno task` alias that keeps it runnable by name. */
  readonly task?: string;
}

export interface TaskModule {
  readonly id: string;
  readonly unit?: TestSet;
  /**
   * Contract-facing subset of `unit.tests`, run by the `contract` verb. It is a
   * view, never a second execution home, so root `test` still runs each file
   * exactly once.
   */
  readonly contract?: readonly string[];
  /** Files under `tests/integration` owned by this module. */
  readonly integration?: readonly string[];
  readonly coverage?: CoverageSet;
  readonly onDemand?: OnDemand;
}

// --- Reusable permission sets -------------------------------------------

/** Postgres.js configuration names accepted by the platform pool. */
export const POSTGRES_ENV = [
  "PGHOST",
  "PGPORT",
  "PGUSERNAME",
  "PGUSER",
  "PGDATABASE",
  "PGPASSWORD",
  "PGMAX",
  "PGSSL",
  "PGSSLNEGOTIATION",
  "PGIDLE_TIMEOUT",
  "PGCONNECT_TIMEOUT",
  "PGMAX_LIFETIME",
  "PGMAX_PIPELINE",
  "PGBACKOFF",
  "PGKEEP_ALIVE",
  "PGPREPARE",
  "PGDEBUG",
  "PGFETCH_TYPES",
  "PGPUBLICATIONS",
  "PGAPPNAME",
  "PGTARGETSESSIONATTRS",
  "PGTARGET_SESSION_ATTRS",
] as const;

export const OBJECT_STORAGE_ENV = [
  "OBJECT_STORAGE_ACCESS_KEY",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_HOST",
  "OBJECT_STORAGE_PORT",
  "OBJECT_STORAGE_REQUEST_TIMEOUT_MS",
  "OBJECT_STORAGE_SECRET_KEY",
  "OBJECT_STORAGE_USE_SSL",
] as const;

export const AUTH_ENV = [
  "AUTH_MFA_ENCRYPTION_KEYSET",
  "AUTH_MINIMUM_RESPONSE_MS",
  "AUTH_THROTTLE_SUBJECT_KEYSET",
] as const;

/**
 * The runtime environment authority the `worker` service declares in
 * `compose.yaml`. A test set that loads an `apps/worker` module evaluates the
 * same composition the service runs, so it must grant the same names.
 */
export const WORKER_RUNTIME_ENV = [
  "APP_ENV",
  "READABLE_STREAM",
  "DATABASE_URL",
  ...POSTGRES_ENV,
  "WORKER_INSTANCE_ID",
  ...OBJECT_STORAGE_ENV,
] as const;

/** Every canonical schema baseline the migration and schema harnesses read. */
export const SCHEMA_READS = [
  "personal-crm-schema/v1",
  "personal-crm-schema/v2",
  "personal-crm-schema/v3",
  "personal-crm-schema/v4",
  "personal-crm-schema/v5",
  "personal-crm-schema/v6",
  "personal-crm-schema/v7",
] as const;

/** Environment authority shared by every PostgreSQL-backed application set. */
export const APPLICATION_DATABASE_ENV = [
  "READABLE_STREAM",
  "APP_ENV",
  ...AUTH_ENV,
  "DATABASE_URL",
  ...OBJECT_STORAGE_ENV,
  ...POSTGRES_ENV,
] as const;

/**
 * Configuration artifacts the API contract suites read as text: Compose files,
 * container definitions, adapters proven to stay inside their module, accepted
 * architecture decisions, and product catalogs.
 */
export const API_CONFIGURATION_READS = [
  ".env.example",
  "AGENTS.md",
  "deno.json",
  "compose.yaml",
  "compose.dev.yaml",
  "compose.test.yaml",
  "Dockerfile.api",
  "Dockerfile.gateway",
  "Dockerfile.web",
  "gateway/nginx.conf",
  "gateway/security_headers.conf",
  "apps/api/personalization_router.ts",
  "apps/api/governance.ts",
  "packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts",
  "packages/backend/modules/interactions/adapters/postgres/communication_repository.ts",
  "packages/backend/modules/interactions/adapters/postgres/interaction_repository.ts",
  "packages/backend/modules/people/adapters/postgres/profile_fact_organizations.ts",
  "packages/backend/modules/people/adapters/postgres/tag_personalization.ts",
  "packages/backend/modules/people/public.ts",
  "packages/backend/modules/planning/adapters/postgres/reminder_rule_personalization.ts",
  "packages/backend/modules/workspaces/adapters/postgres/personalization.ts",
  "packages/backend/modules/workspaces/adapters/postgres/profile_fact_configuration.ts",
  "apps/web/src/pages/app/settings/profile.astro",
  "apps/web/src/pages/internal/activity-report-shell.astro",
  "apps/web/src/pages/internal/person-audit-shell.astro",
  "apps/web/src/pages/internal/person-profile-shell.astro",
  "packages/backend/read-models/audit-history/adapters/postgres/audit_history_repository.ts",
  "packages/backend/modules/workspaces/adapters/postgres/workspace_invitations.ts",
  "packages/backend/modules/workspaces/adapters/postgres/settings_management.ts",
  "tools/dev.ts",
  "tools/e2e.ts",
  "tools/tasks/manifest.ts",
  "tools/tasks/run.ts",
  "tests/e2e/auth-003.spec.ts",
  "docs/architecture/backend-architecture.md",
  "docs/architecture/compose-contract.md",
  "docs/architecture/configuration-and-secrets.md",
  "docs/architecture/decisions/0001-astro-personalized-rendering.md",
  "docs/architecture/decisions/0004-onboarding-invitation-and-atomic-audit-coordination.md",
  "docs/architecture/decisions/README.md",
  "docs/architecture/module-boundaries.yaml",
  "docs/architecture/observability.md",
  "docs/architecture/technology-baseline.md",
  "docs/product/user-flows.yaml",
  "docs/product/page-catalog.yaml",
  "docs/product/release-slices.md",
  "docs/planning/README.md",
  "docs/planning/roadmap.md",
  "docs/planning/traceability.md",
] as const;

/** Application facades the ownership-boundary suites read as text. */
export const OWNERSHIP_BOUNDARY_READS = [
  "packages/backend/modules/people/application",
  "packages/backend/modules/files/application",
  "packages/backend/modules/governance/application",
] as const;

// --- The architecture gate ----------------------------------------------

/**
 * The architecture checker walks the whole import graph, so it reads every
 * source root plus the two documents it enforces: the module manifest with its
 * JSON Schema, and the canonical DDL whose tables must be owned.
 */
export const ARCHITECTURE_CHECKER = "tools/architecture/check_boundaries.ts";

export const ARCHITECTURE_PERMISSIONS: Permissions = {
  read: [
    "apps",
    "docs/architecture",
    "packages",
    "personal-crm-schema/v7",
    "tools",
  ],
};

// --- Type-check and build entry points ----------------------------------

/** Production entry points every check and build gate compiles. */
export const PRODUCTION_ENTRYPOINTS = [
  "apps/api/main.ts",
  "apps/worker/main.ts",
  "tools/migrations/main.ts",
] as const;

/** Developer and operator entry points the check gate also compiles. */
export const TOOL_ENTRYPOINTS = [
  "tools/dev.ts",
  "tools/e2e.ts",
  "tools/postgres_gate.ts",
  "tools/schema/validate_postgres.ts",
  "tools/contracts/generate.ts",
  "tools/tasks/run.ts",
  ARCHITECTURE_CHECKER,
  "tools/operations/private_production_preflight.ts",
  "tools/operations/private_production_probe.ts",
  "tools/operations/private_production_recovery.ts",
] as const;

// --- Operator scripts ----------------------------------------------------

export interface OperatorScript {
  readonly id: string;
  readonly script: string;
  readonly permissions: Permissions;
}

export const OPERATOR_SCRIPTS: readonly OperatorScript[] = [
  {
    id: "probe",
    script: "tools/operations/private_production_probe.ts",
    permissions: {
      net: "all",
      read: ["docs/planning/private-production-profile.json"],
    },
  },
  {
    id: "recovery",
    script: "tools/operations/private_production_recovery.ts",
    permissions: {
      env: [
        "READABLE_STREAM",
        "DATABASE_URL",
        "RECOVERY_DATABASE_URL",
        "PRIVATE_PRODUCTION_WRITES_QUIESCED",
        "PRIVATE_PRODUCTION_ISOLATED_TARGET",
        ...OBJECT_STORAGE_ENV,
        "RECOVERY_OBJECT_STORAGE_ACCESS_KEY",
        "RECOVERY_OBJECT_STORAGE_BUCKET",
        "RECOVERY_OBJECT_STORAGE_HOST",
        "RECOVERY_OBJECT_STORAGE_PORT",
        "RECOVERY_OBJECT_STORAGE_SECRET_KEY",
        "RECOVERY_OBJECT_STORAGE_USE_SSL",
        ...POSTGRES_ENV,
      ],
      net: "all",
      run: ["pg_dump", "pg_restore"],
      read: [
        "docs/planning/private-production-profile.json",
        ...SCHEMA_READS,
        ".artifacts/private-production-recovery",
      ],
      write: [".artifacts/private-production-recovery"],
    },
  },
  {
    id: "preflight",
    script: "tools/operations/private_production_preflight.ts",
    permissions: {
      env: [
        "APP_ENV",
        ...AUTH_ENV,
        "DATABASE_URL",
        "GATEWAY_TLS_CERTIFICATE_PATH",
        "GATEWAY_TLS_PRIVATE_KEY_PATH",
        "INTEGRATIONS_DAV_ENABLED",
        "INTEGRATIONS_ENCRYPTION_KEYSET",
        ...OBJECT_STORAGE_ENV,
        "POSTGRES_DB",
        "POSTGRES_PASSWORD",
        "POSTGRES_USER",
        "PRIVATE_PRODUCTION_ARCHIVE_ENCRYPTED_AT_REST",
        "PRIVATE_PRODUCTION_ARCHIVE_KEY_RECOVERY_VERIFIED",
        "PRIVATE_PRODUCTION_SECRET_STORE_READY",
        "PUBLIC_WEB_ORIGIN",
        "SMTP_FROM",
        "SMTP_HOST",
        "SMTP_PASSWORD",
        "SMTP_PORT",
        "SMTP_SECURITY",
        "SMTP_USERNAME",
      ],
      read: ["docs/planning/private-production-profile.json"],
    },
  },
];

// --- Integration suite ---------------------------------------------------

/**
 * Every PostgreSQL-backed integration file runs under one disposable project,
 * so one permission set covers the whole suite.
 */
export const INTEGRATION_PERMISSIONS: Permissions = {
  read: [...SCHEMA_READS],
  env: [...APPLICATION_DATABASE_ENV],
  net: "all",
};

// --- Modules -------------------------------------------------------------

export const MODULES: readonly TaskModule[] = [
  {
    // The shared kernel is pure: no I/O, no environment, no database. Every
    // backend module depends on it, so it is measured on its own and held to a
    // higher bar than the repository floor.
    id: "shared-kernel",
    unit: {
      tests: [
        "packages/backend/shared-kernel/clock_test.ts",
        "packages/backend/shared-kernel/ids_test.ts",
        "packages/backend/shared-kernel/pagination_test.ts",
        "packages/backend/shared-kernel/partial_date_test.ts",
        "packages/backend/shared-kernel/result_test.ts",
        "packages/backend/shared-kernel/transaction_test.ts",
        "packages/backend/shared-kernel/validation_test.ts",
      ],
    },
    coverage: {
      directory: "shared-kernel",
      threshold: 95,
      tests: [
        "packages/backend/shared-kernel/clock_test.ts",
        "packages/backend/shared-kernel/ids_test.ts",
        "packages/backend/shared-kernel/pagination_test.ts",
        "packages/backend/shared-kernel/partial_date_test.ts",
        "packages/backend/shared-kernel/result_test.ts",
        "packages/backend/shared-kernel/transaction_test.ts",
        "packages/backend/shared-kernel/validation_test.ts",
      ],
      include: ["packages/backend/shared-kernel"],
    },
  },
  {
    id: "api",
    unit: {
      tests: [
        "apps/api/app_test.ts",
        "apps/api/authentication_test.ts",
        "apps/api/files_test.ts",
        "apps/api/interactions_test.ts",
        "apps/api/invitations_test.ts",
        "apps/api/people_test.ts",
        "apps/api/registration_test.ts",
        "apps/api/relationships_test.ts",
        "apps/api/security_config_test.ts",
        "apps/api/settings_test.ts",
        // The test support package every backend and API suite imports. It
        // lives in this set because the same set measures all of
        // `packages/backend`, so its own suites keep it covered there.
        "packages/backend/testing/assert_test.ts",
        "packages/backend/testing/fakes_test.ts",
        "packages/backend/testing/fixtures_test.ts",
        "packages/backend/platform/postgres/config_test.ts",
        "packages/backend/platform/postgres/errors_test.ts",
        "packages/backend/platform/postgres/lifecycle_impact_test.ts",
        "packages/backend/platform/postgres/person_display_test.ts",
        "packages/backend/platform/postgres/reference_counter_test.ts",
        "packages/backend/platform/postgres/rows_test.ts",
        "packages/backend/platform/postgres/timestamps_test.ts",
        "packages/backend/platform/postgres/transactions_test.ts",
        "packages/backend/modules/api-access/authentication_subject_test.ts",
        "packages/backend/modules/identity/identity_test.ts",
        "packages/backend/modules/identity/application/password_recovery_test.ts",
        "packages/backend/modules/files/object_storage_test.ts",
        "packages/backend/modules/files/person_files_test.ts",
        "packages/backend/modules/interactions/record_interaction_test.ts",
        "packages/backend/modules/people/create_person_test.ts",
        "packages/backend/modules/people/important_dates_test.ts",
        "packages/backend/modules/people/profile_facts_test.ts",
        "packages/backend/modules/people/lifecycle_person_test.ts",
        "packages/backend/modules/relationships/relationships_test.ts",
        "packages/backend/read-models/activity-report/activity_report_test.ts",
        "packages/backend/read-models/audit-history/audit_history_test.ts",
        "packages/backend/read-models/people-directory/list_people_test.ts",
        "packages/backend/read-models/people-directory/list_tag_options_test.ts",
        "packages/backend/read-models/person-profile/person_profile_test.ts",
        "packages/backend/read-models/today/today_interactions_test.ts",
        "packages/backend/read-models/today/today_recent_people_test.ts",
        "packages/backend/modules/workspaces/recent_people_test.ts",
        "packages/backend/modules/workspaces/register_first_workspace_test.ts",
        "packages/backend/modules/workspaces/protected_session_test.ts",
        "packages/backend/modules/workspaces/invite_member_test.ts",
        "packages/backend/modules/workspaces/application/member_ui_state_test.ts",
        "packages/backend/modules/workspaces/settings_management_test.ts",
        "packages/backend/modules/workspaces/personalization_test.ts",
        "packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail_test.ts",
        "packages/contracts/files_test.ts",
        "packages/contracts/health_test.ts",
        "tools/architecture/APP-004E/personalization_boundary_test.ts",
        "tools/architecture/FND-001S/astro_rendering_topology_contract_test.ts",
        "tools/architecture/FND-002/coordination_contract_test.ts",
        "tools/configuration_contract_test.ts",
        "tools/contracts/interactions_contract_test.ts",
        "tools/contracts/people_contract_test.ts",
        "tools/contracts/registration_contract_test.ts",
        "tools/e2e_test.ts",
        "tools/gateway_contract_test.ts",
        "tools/migrations/baseline_test.ts",
        "tools/postgres_gate_test.ts",
        "tools/product/PRODUCT-001/release_contract_test.ts",
      ],
      permissions: {
        read: [
          ...API_CONFIGURATION_READS,
          "personal-crm-schema/v7/personal_crm_schema_spec_v7.md",
          "personal-crm-schema/v7/personal_crm_schema_v7.sql",
          "packages/contracts",
          ...OWNERSHIP_BOUNDARY_READS,
        ],
        env: ["CI", "READABLE_STREAM"],
        run: ["deno", "powershell"],
        net: ["127.0.0.1"],
      },
    },
    contract: [
      "apps/api/app_test.ts",
      "apps/api/authentication_test.ts",
      "apps/api/files_test.ts",
      "apps/api/interactions_test.ts",
      "apps/api/invitations_test.ts",
      "apps/api/people_test.ts",
      "apps/api/registration_test.ts",
      "apps/api/relationships_test.ts",
      "apps/api/settings_test.ts",
      "packages/contracts/files_test.ts",
      "packages/contracts/health_test.ts",
      "tools/contracts/interactions_contract_test.ts",
      "tools/contracts/people_contract_test.ts",
      "tools/contracts/registration_contract_test.ts",
    ],
    integration: [
      "tests/integration/authentication_postgres_test.ts",
      "tests/integration/files_postgres_test.ts",
      "tests/integration/governance_postgres_test.ts",
      "tests/integration/interactions_postgres_test.ts",
      "tests/integration/invitation_postgres_test.ts",
      "tests/integration/people_postgres_test.ts",
      "tests/integration/registration_postgres_test.ts",
      "tests/integration/settings_postgres_test.ts",
      "tests/integration/time_preferences_postgres_test.ts",
    ],
    coverage: {
      directory: "deno",
      postgres: true,
      include: [
        "apps/api",
        "packages/backend",
        "packages/contracts",
        "tools/contracts",
        "tools/migrations",
      ],
      permissions: {
        read: [...API_CONFIGURATION_READS, ...SCHEMA_READS],
        run: ["deno", "powershell"],
        env: ["CI", ...APPLICATION_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "apps/api/app_test.ts",
        "apps/api/authentication_test.ts",
        "apps/api/exports_test.ts",
        "apps/api/files_test.ts",
        "apps/api/gifts_test.ts",
        "apps/api/governance_test.ts",
        "apps/api/imports_test.ts",
        "apps/api/interactions_test.ts",
        "apps/api/invitations_test.ts",
        "apps/api/journal_test.ts",
        "apps/api/people_test.ts",
        "apps/api/personal_lifecycle_test.ts",
        "apps/api/planning_test.ts",
        "apps/api/registration_test.ts",
        "apps/api/relationships_test.ts",
        "apps/api/security_config_test.ts",
        "apps/api/settings_test.ts",
        "apps/api/workspace_lifecycle_test.ts",
        "apps/worker/composition_test.ts",
        // This set measures all of packages/backend, the shared kernel and the
        // test support package included, so it runs the suites that exercise
        // them too.
        "packages/backend/testing/assert_test.ts",
        "packages/backend/testing/fakes_test.ts",
        "packages/backend/testing/fixtures_test.ts",
        "packages/backend/shared-kernel/clock_test.ts",
        "packages/backend/shared-kernel/ids_test.ts",
        "packages/backend/shared-kernel/pagination_test.ts",
        "packages/backend/shared-kernel/partial_date_test.ts",
        "packages/backend/shared-kernel/result_test.ts",
        "packages/backend/shared-kernel/transaction_test.ts",
        "packages/backend/shared-kernel/validation_test.ts",
        "packages/backend/platform/postgres/config_test.ts",
        "packages/backend/platform/postgres/errors_test.ts",
        "packages/backend/platform/postgres/lifecycle_impact_test.ts",
        "packages/backend/platform/postgres/person_display_test.ts",
        "packages/backend/platform/postgres/reference_counter_test.ts",
        "packages/backend/platform/postgres/rows_test.ts",
        "packages/backend/platform/postgres/timestamps_test.ts",
        "packages/backend/platform/postgres/transactions_test.ts",
        "packages/backend/modules/api-access/authentication_subject_test.ts",
        "packages/backend/modules/identity/identity_test.ts",
        "packages/backend/modules/identity/application/password_recovery_test.ts",
        "packages/backend/modules/files/object_storage_test.ts",
        "packages/backend/modules/files/person_files_test.ts",
        "packages/backend/modules/gifts/gift_management_test.ts",
        "packages/backend/modules/import-export/import_management_test.ts",
        "packages/backend/modules/import-export/export_management_test.ts",
        "packages/backend/modules/interactions/record_interaction_test.ts",
        "packages/backend/modules/journal/journal_management_test.ts",
        "packages/backend/modules/people/create_person_test.ts",
        "packages/backend/modules/people/important_dates_test.ts",
        "packages/backend/modules/people/profile_facts_test.ts",
        "packages/backend/modules/people/lifecycle_person_test.ts",
        "packages/backend/modules/planning/task_management_test.ts",
        "packages/backend/modules/planning/reminder_management_test.ts",
        "packages/backend/modules/relationships/relationships_test.ts",
        "packages/backend/read-models/activity-report/activity_report_test.ts",
        "packages/backend/read-models/audit-history/audit_history_test.ts",
        "packages/backend/read-models/people-directory/list_people_test.ts",
        "packages/backend/read-models/people-directory/list_tag_options_test.ts",
        "packages/backend/read-models/person-profile/person_profile_test.ts",
        "packages/backend/read-models/today/today_interactions_test.ts",
        "packages/backend/read-models/today/today_recent_people_test.ts",
        "packages/backend/read-models/today/today_reminders_test.ts",
        "packages/backend/read-models/today/today_tasks_test.ts",
        "packages/backend/modules/workspaces/recent_people_test.ts",
        "packages/backend/modules/workspaces/register_first_workspace_test.ts",
        "packages/backend/modules/workspaces/protected_session_test.ts",
        "packages/backend/modules/workspaces/invite_member_test.ts",
        "packages/backend/modules/workspaces/application/member_ui_state_test.ts",
        "packages/backend/modules/workspaces/settings_management_test.ts",
        "packages/backend/modules/workspaces/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/workspace_lifecycle_test.ts",
        "packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail_test.ts",
        "packages/contracts/files_test.ts",
        "packages/contracts/gifts_test.ts",
        "packages/contracts/health_test.ts",
        "packages/contracts/personal_lifecycle_test.ts",
        "packages/contracts/workspace_lifecycle_test.ts",
        "tools/architecture/APP-004E/personalization_boundary_test.ts",
        "tools/architecture/FND-001S/astro_rendering_topology_contract_test.ts",
        "tools/architecture/FND-002/coordination_contract_test.ts",
        "tools/configuration_contract_test.ts",
        "tools/contracts/governance_contract_test.ts",
        "tools/contracts/interactions_contract_test.ts",
        "tools/contracts/people_contract_test.ts",
        "tools/contracts/planning_contract_test.ts",
        "tools/contracts/registration_contract_test.ts",
        "tools/e2e_test.ts",
        "tools/gateway_contract_test.ts",
        "tools/migrations/baseline_test.ts",
        "tools/postgres_gate_test.ts",
        "tools/product/PRODUCT-001/release_contract_test.ts",
        "tests/integration/registration_postgres_test.ts",
        "tests/integration/authentication_postgres_test.ts",
        "tests/integration/files_postgres_test.ts",
        "tests/integration/gifts_postgres_test.ts",
        "tests/integration/governance_postgres_test.ts",
        "tests/integration/import_postgres_test.ts",
        "tests/integration/export_postgres_test.ts",
        "tests/integration/interactions_postgres_test.ts",
        "tests/integration/invitation_postgres_test.ts",
        "tests/integration/journal_postgres_test.ts",
        "tests/integration/people_postgres_test.ts",
        "tests/integration/personal_lifecycle_postgres_test.ts",
        "tests/integration/planning_postgres_test.ts",
        "tests/integration/settings_postgres_test.ts",
        "tests/integration/time_preferences_postgres_test.ts",
      ],
    },
  },
  {
    id: "api-access",
    unit: {
      tests: [
        "apps/api/api_tokens_test.ts",
        "packages/backend/modules/api-access/api_token_management_test.ts",
        "packages/contracts/api_tokens_test.ts",
      ],
      permissions: { env: ["READABLE_STREAM"] },
    },
    integration: ["tests/integration/api_tokens_postgres_test.ts"],
    coverage: {
      directory: "api-access",
      postgres: true,
      permissions: { env: "all", net: "all" },
      tests: [
        "apps/api/api_tokens_test.ts",
        "apps/api/people_test.ts",
        "packages/backend/modules/api-access/api_token_management_test.ts",
        "tests/integration/api_tokens_postgres_test.ts",
      ],
      include: [
        "apps/api/api_tokens.ts",
        "packages/backend/modules/api-access/adapters/crypto/api_token_secrets.ts",
        "packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts",
        "packages/backend/modules/api-access/application/api_token_management.ts",
        "packages/backend/modules/api-access/application/audit_events.ts",
      ],
    },
  },
  {
    id: "integrations",
    unit: {
      tests: [
        "apps/api/integrations_test.ts",
        "packages/backend/modules/integrations/dav_sync_test.ts",
        "packages/backend/modules/integrations/dav_adapter_test.ts",
        "packages/contracts/integrations_test.ts",
      ],
    },
    integration: ["tests/integration/dav_postgres_test.ts"],
    coverage: {
      directory: "integrations",
      postgres: true,
      permissions: { env: "all", net: "all" },
      tests: [
        "apps/api/integrations_test.ts",
        "packages/backend/modules/integrations/dav_sync_test.ts",
        "packages/backend/modules/integrations/dav_adapter_test.ts",
        "packages/backend/modules/people/create_person_test.ts",
        "packages/backend/modules/people/lifecycle_person_test.ts",
        "packages/backend/modules/planning/task_management_test.ts",
        "packages/contracts/integrations_test.ts",
        "tests/integration/dav_postgres_test.ts",
      ],
      include: [
        "apps/api/integrations.ts",
        "packages/backend/modules/integrations/adapters/crypto/dav_secret_box.ts",
        "packages/backend/modules/integrations/adapters/dav/http_dav_client.ts",
        "packages/backend/modules/integrations/adapters/postgres/dav_repository.ts",
        "packages/backend/modules/integrations/application/dav_sync.ts",
        "packages/backend/modules/integrations/application/audit_events.ts",
        "packages/backend/modules/people/application/create_person.ts",
        "packages/backend/modules/people/application/lifecycle_person.ts",
        "packages/backend/modules/planning/application/task_management.ts",
      ],
    },
  },
  {
    id: "planning",
    unit: {
      tests: [
        "apps/api/planning_test.ts",
        "apps/worker/composition_test.ts",
        "packages/backend/modules/planning/task_management_test.ts",
        "packages/backend/modules/planning/reminder_management_test.ts",
        "packages/backend/read-models/today/today_attention_test.ts",
        "packages/backend/read-models/today/today_tasks_test.ts",
        "packages/backend/read-models/today/today_reminders_test.ts",
        "tools/architecture/APP-006B/reminder_coordination_boundary_test.ts",
        "tools/worker_contract_test.ts",
        "tools/contracts/planning_contract_test.ts",
      ],
      permissions: {
        env: [...WORKER_RUNTIME_ENV],
        read: [
          "deno.json",
          "docs/architecture/module-boundaries.yaml",
          "packages/backend/modules/interactions/application/record_interaction.ts",
          "packages/backend/modules/interactions/application/record_communication.ts",
          "apps/worker/composition.ts",
          // The worker entry-point contract resolves the check gate's targets,
          // which expands the one globbed suite in its own directory.
          "tools/performance",
        ],
      },
    },
    contract: [
      "apps/api/planning_test.ts",
      "tools/contracts/planning_contract_test.ts",
    ],
    integration: ["tests/integration/planning_postgres_test.ts"],
    coverage: {
      directory: "planning",
      postgres: true,
      permissions: {
        read: [...SCHEMA_READS],
        env: [...APPLICATION_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "apps/api/planning_test.ts",
        "packages/backend/modules/planning/task_management_test.ts",
        "packages/backend/modules/planning/reminder_management_test.ts",
        "packages/backend/read-models/audit-history/audit_history_test.ts",
        "packages/backend/read-models/today/today_attention_test.ts",
        "packages/backend/read-models/today/today_tasks_test.ts",
        "packages/backend/read-models/today/today_reminders_test.ts",
        "tools/contracts/planning_contract_test.ts",
        "tests/integration/planning_postgres_test.ts",
      ],
      include: [
        "apps/api/planning.ts",
        "packages/backend/modules/planning/adapters/postgres/task_repository.ts",
        "packages/backend/modules/planning/adapters/postgres/reminder_repository.ts",
        "packages/backend/modules/planning/application/task_management.ts",
        "packages/backend/modules/planning/application/reminder_management.ts",
        "packages/backend/modules/planning/application/reminder_delivery.ts",
        "packages/backend/modules/planning/application/audit_events.ts",
        "packages/backend/read-models/today/adapters/postgres/today_attention_repository.ts",
        "packages/backend/read-models/today/adapters/postgres/today_tasks_repository.ts",
        "packages/backend/read-models/today/adapters/postgres/today_reminders_repository.ts",
        "packages/backend/read-models/today/application/get_today_attention.ts",
        "packages/backend/read-models/today/application/get_today_tasks.ts",
        "packages/backend/read-models/today/application/get_today_reminders.ts",
      ],
    },
  },
  {
    id: "governance",
    unit: {
      tests: [
        "apps/api/governance_test.ts",
        "packages/backend/modules/governance/legal_acceptance_test.ts",
        "tools/contracts/governance_contract_test.ts",
      ],
      permissions: { env: ["READABLE_STREAM"] },
    },
    contract: [
      "apps/api/governance_test.ts",
      "tools/contracts/governance_contract_test.ts",
    ],
    coverage: {
      directory: "governance",
      permissions: { env: ["READABLE_STREAM"] },
      tests: [
        "apps/api/authentication_test.ts",
        "apps/api/governance_test.ts",
        "packages/backend/modules/governance/legal_acceptance_test.ts",
        "tools/contracts/governance_contract_test.ts",
      ],
      include: [
        "apps/api/governance.ts",
        "packages/backend/modules/governance/application/legal_acceptance.ts",
      ],
    },
  },
  {
    id: "gifts",
    unit: {
      tests: [
        "apps/api/gifts_test.ts",
        "packages/backend/modules/gifts/gift_management_test.ts",
        "packages/contracts/gifts_test.ts",
      ],
    },
    integration: ["tests/integration/gifts_postgres_test.ts"],
    coverage: {
      directory: "gifts",
      tests: [
        "apps/api/gifts_test.ts",
        "packages/backend/modules/gifts/gift_management_test.ts",
      ],
      include: [
        "apps/api/gifts.ts",
        "packages/backend/modules/gifts/application/gift_management.ts",
      ],
    },
  },
  {
    id: "storage",
    unit: {
      tests: ["packages/backend/modules/files/storage_settings_test.ts"],
    },
    coverage: {
      directory: "storage",
      permissions: { env: ["READABLE_STREAM"] },
      tests: [
        "packages/backend/modules/files/storage_settings_test.ts",
        "apps/api/files_test.ts",
      ],
      include: [
        "apps/api/file_storage_config.ts",
        "packages/backend/modules/files/application/storage_settings.ts",
      ],
    },
  },
  {
    id: "journal",
    unit: {
      tests: [
        "apps/api/journal_test.ts",
        "packages/backend/modules/journal/journal_management_test.ts",
        "packages/contracts/journal_test.ts",
      ],
      permissions: { read: ["packages/contracts"] },
    },
    contract: [
      "apps/api/journal_test.ts",
      "packages/contracts/journal_test.ts",
    ],
    integration: ["tests/integration/journal_postgres_test.ts"],
    coverage: {
      directory: "journal",
      tests: [
        "apps/api/journal_test.ts",
        "packages/backend/modules/journal/journal_management_test.ts",
      ],
      include: [
        "apps/api/journal.ts",
        "packages/backend/modules/journal/application/journal_management.ts",
        "packages/backend/read-models/journal-timeline/application/list_journal_timeline.ts",
      ],
    },
  },
  {
    id: "imports",
    unit: {
      tests: [
        "apps/api/imports_test.ts",
        "packages/backend/modules/import-export/import_management_test.ts",
        "tools/architecture/APP-009A/import_ownership_boundary_test.ts",
      ],
      permissions: {
        read: [
          "packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
          ...OWNERSHIP_BOUNDARY_READS,
        ],
      },
    },
    integration: ["tests/integration/import_postgres_test.ts"],
    coverage: {
      directory: "imports",
      permissions: {
        read: [
          "packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
          ...OWNERSHIP_BOUNDARY_READS,
        ],
      },
      tests: [
        "apps/api/imports_test.ts",
        "packages/backend/modules/import-export/import_management_test.ts",
        "tools/architecture/APP-009A/import_ownership_boundary_test.ts",
      ],
      include: [
        "apps/api/imports.ts",
        "packages/backend/modules/import-export/application/import_management.ts",
      ],
    },
  },
  {
    id: "exports",
    unit: {
      tests: [
        "apps/api/exports_test.ts",
        "packages/backend/modules/import-export/export_management_test.ts",
      ],
    },
    contract: ["apps/api/exports_test.ts"],
    integration: ["tests/integration/export_postgres_test.ts"],
    coverage: {
      directory: "exports",
      tests: [
        "apps/api/exports_test.ts",
        "packages/backend/modules/import-export/export_management_test.ts",
      ],
      include: [
        "apps/api/exports.ts",
        "packages/backend/modules/import-export/application/export_management.ts",
      ],
    },
  },
  {
    id: "lifecycle",
    unit: {
      tests: [
        "apps/api/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/personal_lifecycle_test.ts",
        "packages/contracts/personal_lifecycle_test.ts",
        "tools/architecture/APP-009C/personal_lifecycle_boundary_test.ts",
      ],
      permissions: { read: ["packages/backend/modules"] },
    },
    integration: ["tests/integration/personal_lifecycle_postgres_test.ts"],
    coverage: {
      directory: "lifecycle",
      postgres: true,
      permissions: {
        env: [...APPLICATION_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "apps/api/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/personal_lifecycle_test.ts",
        "packages/contracts/personal_lifecycle_test.ts",
        "tests/integration/personal_lifecycle_postgres_test.ts",
      ],
      include: [
        "apps/api/personal_lifecycle.ts",
        "packages/backend/modules/identity/adapters/postgres/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/application/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/adapters/postgres/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/application/audit_events.ts",
      ],
    },
  },
  {
    id: "workspace-lifecycle",
    unit: {
      tests: [
        "apps/api/workspace_lifecycle_test.ts",
        "packages/backend/modules/workspaces/workspace_lifecycle_test.ts",
        "packages/contracts/workspace_lifecycle_test.ts",
      ],
      permissions: { env: "all", net: "all" },
    },
    integration: [
      "tests/integration/workspace_lifecycle_impact_postgres_test.ts",
    ],
    coverage: {
      directory: "workspace-lifecycle",
      permissions: { env: "all", net: "all" },
      tests: [
        "apps/api/workspace_lifecycle_test.ts",
        "apps/worker/composition_test.ts",
        "packages/backend/modules/workspaces/workspace_lifecycle_test.ts",
        "packages/contracts/workspace_lifecycle_test.ts",
      ],
      include: [
        "apps/api/workspace_lifecycle.ts",
        // The worker is one deployable: its entry point and composition belong
        // to the same measured surface, so no worker file escapes coverage.
        "apps/worker",
        "packages/backend/modules/workspaces/application/workspace_lifecycle.ts",
      ],
    },
  },
  {
    id: "web",
    unit: { runner: "vitest", tests: ["apps/web/src/**/*.test.ts"] },
    coverage: {
      runner: "vitest",
      directory: "web",
      tests: ["apps/web/src/**/*.test.ts"],
      include: ["apps/web/src/lib/*.ts"],
    },
  },
  {
    id: "gateway",
    unit: {
      tests: ["tools/gateway_log_capture_test.ts"],
      permissions: {
        read: ["gateway/nginx.conf", "gateway/security_headers.conf"],
        net: ["127.0.0.1"],
        run: ["docker", "pwsh"],
      },
    },
  },
  {
    id: "tasks",
    unit: {
      tests: [
        "tools/tasks/manifest_test.ts",
        "tools/pipeline_contract_test.ts",
        "tools/architecture/check_boundaries_test.ts",
      ],
      permissions: {
        read: [
          ".github",
          ".tool-versions",
          "Dockerfile.api",
          "Dockerfile.gateway",
          "Dockerfile.web",
          "deno.json",
          "lefthook.yml",
          "package.json",
          "vitest.config.ts",
          "compose.yaml",
          "docs/architecture",
          "docs/planning/private-production-profile.json",
          "personal-crm-schema/v7",
          "apps",
          "packages",
          "tools",
          "tests",
        ],
      },
    },
  },
  {
    id: "performance",
    unit: {
      tests: ["tools/performance/*_test.ts"],
      permissions: {
        read: [
          "docs/planning/mvp-capacity-profile.json",
          "playwright.config.ts",
          "tests/e2e/perf-001.spec.ts",
          "tests/integration/planning_postgres_test.ts",
          "apps/api/people_test.ts",
          "packages/backend/read-models/people-directory/list_people_test.ts",
          "packages/backend/modules/import-export/import_management_test.ts",
          "packages/backend/modules/import-export/export_management_test.ts",
        ],
      },
    },
  },
  {
    id: "operations",
    unit: {
      tests: [
        "tools/operations/private_production_probe_test.ts",
        "tools/operations/private_production_recovery_test.ts",
        "tools/operations/private_production_preflight_test.ts",
      ],
      permissions: {
        env: ["READABLE_STREAM"],
        read: [
          "docs/planning/private-production-profile.json",
          "docs/planning/mvp-capacity-profile.json",
          "gateway/nginx.conf",
          ".artifacts/private-production-recovery",
        ],
        write: [".artifacts/private-production-recovery"],
      },
    },
  },
  {
    id: "operations-compose",
    unit: {
      tests: [
        "tools/operations/private_production_compose_test.ts",
        "tools/operations/object_storage_compose_test.ts",
      ],
      permissions: { run: ["docker"] },
    },
  },
  {
    id: "operations-recovery",
    onDemand: {
      reason:
        "The backup and restore drill needs the pg_dump and pg_restore client binaries plus a disposable Compose project, so it runs as an operator rehearsal rather than inside the aggregate gates. Run it with `deno task test:unit --module=operations-recovery`.",
    },
    unit: {
      tests: ["tools/operations/private_production_recovery_boundary_test.ts"],
      permissions: {
        env: ["READABLE_STREAM", "DATABASE_URL", ...POSTGRES_ENV],
        net: ["127.0.0.1"],
        run: ["docker", "deno"],
        read: [
          "docs/planning/private-production-profile.json",
          ...SCHEMA_READS,
          ".artifacts/private-production-recovery",
        ],
        write: [".artifacts/private-production-recovery"],
      },
    },
  },
  {
    id: "repro-astro-readiness",
    onDemand: {
      reason:
        "GAP-002 reproduces an intermittent Astro readiness deadline by spawning the real probe under coverage three times, which costs about thirty seconds and duplicates a gate suite. Keep it on demand.",
      task: "test:repro:astro-readiness",
    },
    unit: {
      tests: ["tools/astro_readiness_repro_test.ts"],
      permissions: { run: ["deno"] },
    },
  },
];

/**
 * Modules root `test` runs, in order. Every module with a non-on-demand unit
 * set must appear exactly once.
 */
export const TEST_AGGREGATE: readonly string[] = [
  "tasks",
  "shared-kernel",
  "api",
  "api-access",
  "integrations",
  "planning",
  "governance",
  "gifts",
  "journal",
  "imports",
  "exports",
  "lifecycle",
  "workspace-lifecycle",
  "storage",
  "performance",
  "operations",
  "web",
  "operations-compose",
  "gateway",
];

/**
 * Modules root `test:coverage` runs, in order. Every module with a
 * non-on-demand coverage set must appear exactly once.
 */
export const COVERAGE_AGGREGATE: readonly string[] = [
  "shared-kernel",
  "api",
  "api-access",
  "integrations",
  "planning",
  "governance",
  "gifts",
  "storage",
  "journal",
  "imports",
  "exports",
  "lifecycle",
  "workspace-lifecycle",
  "web",
];

// --- Pure helpers --------------------------------------------------------

export function moduleById(id: string): TaskModule | undefined {
  return MODULES.find((module) => module.id === id);
}

/** Converts a glob with `*` and `**` segments into an anchored expression. */
export function globToRegExp(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern.charAt(index);
    if (character !== "*") {
      expression += character.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
      continue;
    }
    if (pattern.charAt(index + 1) !== "*") {
      expression += "[^/]*";
      continue;
    }
    if (pattern.charAt(index + 2) === "/") {
      expression += "(?:.*/)?";
      index += 2;
      continue;
    }
    expression += ".*";
    index += 1;
  }
  return new RegExp(`^${expression}$`);
}

export function isGlob(pattern: string): boolean {
  return pattern.includes("*");
}

/** Expands manifest test patterns against a known repository file list. */
export function expandTests(
  patterns: readonly string[],
  files: readonly string[],
): string[] {
  const expanded: string[] = [];
  for (const pattern of patterns) {
    if (!isGlob(pattern)) {
      expanded.push(pattern);
      continue;
    }
    const expression = globToRegExp(pattern);
    for (const file of files) {
      if (expression.test(file)) expanded.push(file);
    }
  }
  return expanded;
}

/** True when a coverage include pattern measures the given production file. */
export function includeMatches(include: string, file: string): boolean {
  if (isGlob(include)) return globToRegExp(include).test(file);
  return file === include || file.startsWith(`${include}/`);
}

function scopeFlag(name: string, scope: PermissionScope | undefined): string[] {
  if (scope === undefined) return [];
  if (scope === "all") return [`--allow-${name}`];
  if (scope.length === 0) return [];
  return [`--allow-${name}=${scope.join(",")}`];
}

/** Renders a permission set as Deno command-line flags. */
export function permissionFlags(permissions: Permissions = {}): string[] {
  return [
    ...scopeFlag("read", permissions.read),
    ...scopeFlag("write", permissions.write),
    ...scopeFlag("env", permissions.env),
    ...scopeFlag("net", permissions.net),
    ...scopeFlag("run", permissions.run),
  ];
}

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".astro",
  "dist",
  ".coverage",
]);

/**
 * Expands one glob by walking only the directory the pattern is rooted in, so a
 * suite needs read access to its own tree rather than to the repository.
 */
export async function expandGlobPattern(
  pattern: string,
  root: URL,
): Promise<string[]> {
  const segments = pattern.split("/");
  const wildcard = segments.findIndex((segment) => segment.includes("*"));
  const base = segments.slice(0, wildcard).join("/");
  const expression = globToRegExp(pattern);
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(new URL(relative, root))) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else if (expression.test(path)) found.push(path);
    }
  }
  await walk(base);
  return found.sort();
}

/** Walks the repository for every test module, ignoring build output. */
export async function listRepositoryTestFiles(
  root: URL,
): Promise<string[]> {
  const ignored = IGNORED_DIRECTORIES;
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(new URL(relative, root))) {
      if (ignored.has(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
      } else if (
        entry.name.endsWith("_test.ts") || entry.name.endsWith(".test.ts")
      ) {
        found.push(path);
      }
    }
  }
  for (const base of ["apps", "packages", "tools", "tests"]) await walk(base);
  return found.sort();
}

/** Walks the repository for every production TypeScript module. */
export async function listProductionFiles(root: URL): Promise<string[]> {
  const ignored = IGNORED_DIRECTORIES;
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(new URL(relative, root))) {
      if (ignored.has(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      if (entry.name.endsWith("_test.ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }
      if (entry.name.endsWith(".test-helper.ts")) continue;
      found.push(path);
    }
  }
  for (const base of ["apps", "packages"]) await walk(base);
  return found.sort();
}
