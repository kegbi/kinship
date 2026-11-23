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

import { E2E_PROCESS_BINARIES } from "../e2e.ts";

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
   * Source patterns the report leaves out, replacing Deno's own default
   * rather than adding to it. A set declares this only when the tree it
   * measures carries shared test scaffolding.
   */
  readonly exclude?: readonly string[];
  /**
   * Minimum line, branch, and function percentage. Defaults to
   * `DEFAULT_COVERAGE_THRESHOLD`; a set raises it when its code carries a
   * higher obligation than the repository floor, as the shared kernel does.
   */
  readonly threshold?: number;
}

/** The repository coverage floor every set meets unless it declares more. */
export const DEFAULT_COVERAGE_THRESHOLD = 80;

/**
 * What a set whose tree holds shared test scaffolding leaves out.
 *
 * The first pattern is Deno's own default: a suite measures the code it
 * exercises, not itself. `.test-helper.ts` is the same thing under the name
 * this repository already gives scaffolding that is neither production nor a
 * suite — `listProductionFiles` skips it and so does the architecture checker
 * — but `deno coverage` cannot know that, so a set that carries helpers names
 * both patterns. Passing `--exclude` replaces Deno's default, so the first
 * entry has to be restated.
 */
export const COVERAGE_EXCLUDES_WITH_HELPERS = [
  "test\\.(js|mjs|ts|jsx|tsx)$",
  "\\.test-helper\\.ts$",
] as const;

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
  "AUTH_SIGN_IN_DEVICE_KEYSET",
  "AUTH_THROTTLE_SUBJECT_KEYSET",
] as const;

/** Reminder email (PLANNING-003) uses the SMTP transport the API does. */
export const REMINDER_MAIL_ENV = [
  "PUBLIC_WEB_ORIGIN",
  "SMTP_FROM",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SMTP_SECURITY",
  "SMTP_USERNAME",
] as const;

/**
 * The runtime environment authority the `worker` service declares in
 * `compose.yaml`. A test set that loads an `apps/worker` module evaluates the
 * same composition the service runs, so it must grant the same names.
 */
export const WORKER_RUNTIME_ENV = [
  "APP_ENV",
  "DATABASE_URL",
  ...POSTGRES_ENV,
  "WORKER_INSTANCE_ID",
  ...OBJECT_STORAGE_ENV,
  ...REMINDER_MAIL_ENV,
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
  "personal-crm-schema/v8",
  "personal-crm-schema/v9",
  "personal-crm-schema/v10",
  "personal-crm-schema/v11",
  "personal-crm-schema/v12",
  "personal-crm-schema/v13",
  "personal-crm-schema/v14",
  "personal-crm-schema/v15",
  "personal-crm-schema/v16",
] as const;

/** Environment authority shared by every PostgreSQL-backed application set. */
export const APPLICATION_DATABASE_ENV = [
  "APP_ENV",
  ...AUTH_ENV,
  "DATABASE_URL",
  ...OBJECT_STORAGE_ENV,
  ...POSTGRES_ENV,
] as const;

/**
 * The fixture and worker connections a PostgreSQL-backed suite opens beside
 * the API's (ADR 0008): fixtures seed as the project's superuser, and the
 * worker suites connect as the worker's own role.
 */
export const FIXTURE_DATABASE_ENV = [
  "DATABASE_ADMIN_URL",
  "DATABASE_WORKER_URL",
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
  "compose.support.yaml",
  "compose.test.yaml",
  "Dockerfile.api",
  "Dockerfile.web",
  "gateway/nginx.conf",
  "gateway/security_headers.conf",
  "apps/api/personalization_router.ts",
  "packages/backend/modules/governance/transport/http/routes.ts",
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
  // GAP-040: every inline script and event attribute the CSP must account for.
  "apps/web/src",
  "packages/http-kit/problem.ts",
  "apps/web/src/pages/internal/activity-report-shell.astro",
  "apps/web/src/pages/internal/person-audit-shell.astro",
  "apps/web/src/pages/internal/person-profile-shell.astro",
  "apps/web/src/components/person/PersonSection.astro",
  "packages/backend/read-models/audit-history/adapters/postgres/audit_history_repository.ts",
  "packages/backend/modules/workspaces/adapters/postgres/workspace_invitations.ts",
  "packages/backend/modules/workspaces/adapters/postgres/settings_management.ts",
  "tools/dev.ts",
  "tools/e2e.ts",
  "tools/tasks/manifest.ts",
  "tools/tasks/run.ts",
  // The E2E specs and their support: AUTH-003's flow and AUD-G3's check that
  // every spec runs under the policy-violation collector.
  "tests/e2e",
  "docs/architecture/backend-architecture.md",
  "docs/architecture/compose-contract.md",
  "docs/architecture/configuration-and-secrets.md",
  "docs/architecture/decisions/0001-astro-personalized-rendering.md",
  "docs/architecture/decisions/0004-onboarding-invitation-and-atomic-audit-coordination.md",
  "docs/architecture/decisions/README.md",
  "docs/architecture/module-boundaries.yaml",
  "docs/architecture/observability.md",
  "docs/architecture/technology-baseline.md",
  // AUD-G5's FND-001S topology pins.
  "docs/product/information-architecture.md",
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
    "personal-crm-schema/v10",
    "personal-crm-schema/v11",
    "personal-crm-schema/v12",
    "personal-crm-schema/v13",
    "personal-crm-schema/v14",
    "personal-crm-schema/v15",
    "personal-crm-schema/v16",
    "tools",
  ],
};

// --- The web suite -------------------------------------------------------

/** The vitest suites: the vanilla modules' `.ts` and the islands' `.tsx`. */
export const WEB_TESTS = [
  "apps/web/src/**/*.test.ts",
  "apps/web/src/**/*.test.tsx",
] as const;

// --- Type-check and build entry points ----------------------------------

/** Production entry points every check and build gate compiles. */
export const PRODUCTION_ENTRYPOINTS = [
  "apps/api/main.ts",
  "apps/worker/main.ts",
  "tools/migrations/main.ts",
] as const;

/** Developer and operator entry points the check gate also compiles. */
export const TOOL_ENTRYPOINTS = [
  "tools/dependency_audit_gate.ts",
  "tools/dev.ts",
  "tools/e2e.ts",
  "tools/postgres_gate.ts",
  "tools/schema/validate_postgres.ts",
  "tools/schema/database_types.ts",
  "tools/contracts/build.ts",
  "tools/tasks/run.ts",
  ARCHITECTURE_CHECKER,
  "tools/operations/private_production_preflight.ts",
  "tools/operations/private_production_probe.ts",
  "tools/operations/private_production_recovery.ts",
  "tools/operations/dokploy_preflight.ts",
  "tools/operations/dokploy_storage_init.ts",
] as const;

// --- Operator scripts ----------------------------------------------------

export interface OperatorScript {
  readonly id: string;
  readonly script: string;
  readonly permissions: Permissions;
}

export const OPERATOR_SCRIPTS: readonly OperatorScript[] = [
  {
    // The only step that connects as the database superuser: it creates or
    // corrects the roles schema v14 relies on (ADR 0008). Compose runs the
    // same script in its `bootstrap` service.
    id: "bootstrap",
    script: "tools/migrations/bootstrap.ts",
    permissions: {
      env: [
        "DATABASE_URL",
        ...POSTGRES_ENV,
        "POSTGRES_APP_PASSWORD",
        "POSTGRES_MIGRATOR_PASSWORD",
        "POSTGRES_WORKER_PASSWORD",
      ],
      net: "all",
    },
  },
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
        "POSTGRES_APP_PASSWORD",
        "POSTGRES_MIGRATOR_PASSWORD",
        "POSTGRES_PASSWORD",
        "POSTGRES_WORKER_PASSWORD",
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
 * so one permission set covers the whole suite. `docker` is granted for the
 * object-store fault suite alone (GAP-037), which starts, pauses, and removes
 * its own pinned RustFS container.
 */
export const INTEGRATION_PERMISSIONS: Permissions = {
  read: [
    ...SCHEMA_READS,
    "packages/backend/modules/import-export/domain/formats/fixtures/monica.sql",
  ],
  // Suites compose the API as the application role and seed as the
  // superuser of their disposable project (ADR 0008).
  env: [...APPLICATION_DATABASE_ENV, ...FIXTURE_DATABASE_ENV],
  net: "all",
  run: ["docker"],
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
        "packages/backend/shared-kernel/telemetry_test.ts",
        "packages/backend/shared-kernel/audit_event_test.ts",
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
        "packages/backend/shared-kernel/telemetry_test.ts",
        "packages/backend/shared-kernel/audit_event_test.ts",
      ],
      include: ["packages/backend/shared-kernel"],
    },
  },
  {
    // The people module's domain is pure: the rules a person, a remembered
    // date, and a profile fact obey, with nothing behind them. It is measured
    // on its own at the bar the shared kernel keeps, and the module's four
    // use-case suites live here too so each one has exactly one unit home.
    id: "people",
    unit: {
      tests: [
        "packages/backend/modules/people/domain/important_dates/rules_test.ts",
        "packages/backend/modules/people/domain/lifecycle_rules_test.ts",
        "packages/backend/modules/people/domain/person_identity_test.ts",
        "packages/backend/modules/people/domain/person_name_test.ts",
        "packages/backend/modules/people/domain/avatar_test.ts",
        "packages/backend/modules/people/domain/merge_rules_test.ts",
        "packages/backend/modules/people/domain/bulk_rules_test.ts",
        "packages/backend/modules/people/domain/profile_facts/cursors_test.ts",
        "packages/backend/modules/people/domain/profile_facts/normalize_test.ts",
        "packages/backend/modules/people/domain/profile_facts/validate_test.ts",
        "packages/backend/modules/people/application/create_person_test.ts",
        "packages/backend/modules/people/application/important_dates_test.ts",
        "packages/backend/modules/people/application/profile_facts_test.ts",
        "packages/backend/modules/people/application/lifecycle_person_test.ts",
        "packages/backend/modules/people/application/person_avatar_test.ts",
        "packages/backend/modules/people/application/person_star_test.ts",
        "packages/backend/modules/people/application/duplicate_dismissal_test.ts",
        "packages/backend/modules/people/application/merge_people_test.ts",
        "packages/backend/modules/people/application/bulk_people_test.ts",
        // The composed person rail (AUD-Q3) reads the people module's
        // sections through the person-profile read model. Its suite needs no
        // permission and lives here rather than in the `api` set, whose
        // command is already at the Windows shim's argv limit (REL-105); the
        // `api` module's `deno` coverage set measures it with the rest of the
        // backend.
        "packages/backend/read-models/person-profile/application/compose_person_rail_test.ts",
      ],
    },
    coverage: {
      directory: "people-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/people/domain/important_dates/rules_test.ts",
        "packages/backend/modules/people/domain/lifecycle_rules_test.ts",
        "packages/backend/modules/people/domain/person_identity_test.ts",
        "packages/backend/modules/people/domain/person_name_test.ts",
        "packages/backend/modules/people/domain/avatar_test.ts",
        "packages/backend/modules/people/domain/merge_rules_test.ts",
        "packages/backend/modules/people/domain/bulk_rules_test.ts",
        "packages/backend/modules/people/domain/profile_facts/cursors_test.ts",
        "packages/backend/modules/people/domain/profile_facts/normalize_test.ts",
        "packages/backend/modules/people/domain/profile_facts/validate_test.ts",
      ],
      include: ["packages/backend/modules/people/domain"],
    },
  },
  {
    id: "api",
    unit: {
      tests: [
        "apps/api/app_test.ts",
        "apps/api/routes_test.ts",
        // Default-deny for every protected route, and the authorization
        // matrix executed against every route (AUD-K5).
        "apps/api/default_deny_test.ts",
        "apps/api/role_matrix_test.ts",
        // The pins on every module's refusal tables, which read all of the
        // route surfaces this app mounts, and the object-storage
        // configuration the files suite used to carry (GAP-024).
        "apps/api/failures_test.ts",
        "apps/api/file_storage_config_test.ts",
        // Every module's audit description forwards the actor's request
        // identifier (GAP-039).
        "apps/api/audit_correlation_test.ts",
        // The avatar bridge passes on a discard it could not complete
        // (REL-083).
        "apps/api/avatar_bridge_test.ts",
        "packages/backend/modules/workspaces/transport/http/authentication_test.ts",
        "packages/backend/modules/files/transport/http/routes_test.ts",
        "packages/http-kit/body_limit_test.ts",
        "packages/http-kit/client_address_test.ts",
        "packages/http-kit/cookies_test.ts",
        "packages/http-kit/cors_test.ts",
        "packages/http-kit/downloads_test.ts",
        "packages/http-kit/failures_test.ts",
        "packages/http-kit/health_test.ts",
        "packages/http-kit/logging_test.ts",
        "packages/http-kit/origin_test.ts",
        "packages/http-kit/problem_test.ts",
        "packages/http-kit/request_id_test.ts",
        "packages/http-kit/route_admission_test.ts",
        "packages/http-kit/route_test.ts",
        "packages/http-kit/secure_headers_test.ts",
        "packages/http-kit/session_test.ts",
        "packages/http-kit/validate_test.ts",
        "packages/backend/modules/interactions/transport/http/routes_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/accept_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/create_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/register_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/routes_test.ts",
        "packages/backend/modules/people/transport/http/dates_test.ts",
        "packages/backend/modules/people/transport/http/directory_test.ts",
        "packages/backend/modules/people/transport/http/facts_test.ts",
        "packages/backend/modules/people/transport/http/avatar_test.ts",
        "packages/backend/modules/people/transport/http/star_test.ts",
        "packages/backend/modules/people/transport/http/tag_facet_test.ts",
        "packages/backend/modules/people/transport/http/merge_test.ts",
        "packages/backend/modules/people/transport/http/bulk_test.ts",
        "packages/backend/modules/people/transport/http/identity_test.ts",
        "packages/backend/modules/people/transport/http/life_events_test.ts",
        "packages/backend/modules/people/transport/http/lifecycle_test.ts",
        "packages/backend/modules/people/transport/http/profile_test.ts",
        "packages/backend/modules/people/transport/http/recent_people_test.ts",
        "packages/backend/modules/people/transport/http/routes_test.ts",
        "packages/backend/modules/people/transport/http/tag_options_test.ts",
        "packages/backend/modules/people/transport/http/timeline_test.ts",
        "apps/api/registration_test.ts",
        "packages/backend/modules/relationships/transport/http/routes_test.ts",
        "apps/api/security_config_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/personalization_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/preferences_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/routes_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/sessions_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/ui_state_test.ts",
        // The test support package every backend and API suite imports. It
        // lives in this set because the same set measures all of
        // `packages/backend`, so its own suites keep it covered there.
        "packages/backend/testing/assert_test.ts",
        "packages/backend/testing/fakes_test.ts",
        "packages/backend/testing/fixtures_test.ts",
        "packages/backend/platform/postgres/config_test.ts",
        "packages/backend/platform/postgres/errors_test.ts",
        "packages/backend/platform/postgres/lifecycle_impact_test.ts",
        "packages/backend/platform/postgres/name_match_test.ts",
        "packages/backend/platform/postgres/person_display_test.ts",
        "packages/backend/platform/postgres/reference_counter_test.ts",
        "packages/backend/platform/postgres/person_references_test.ts",
        "packages/backend/platform/postgres/rows_test.ts",
        "packages/backend/platform/postgres/timestamps_test.ts",
        "packages/backend/platform/postgres/transactions_test.ts",
        "packages/backend/platform/telemetry/json_logger_test.ts",
        "packages/backend/modules/api-access/application/authentication_subject_test.ts",
        "packages/backend/read-models/activity-report/application/list_activity_report_test.ts",
        "packages/backend/read-models/audit-history/application/list_audit_history_test.ts",
        "packages/backend/read-models/people-directory/application/list_people_test.ts",
        "packages/backend/read-models/people-directory/application/list_duplicates_test.ts",
        "packages/backend/read-models/people-directory/application/list_tag_options_test.ts",
        "packages/backend/read-models/people-directory/application/list_tag_facet_test.ts",
        "packages/backend/read-models/person-profile/application/get_person_profile_test.ts",
        "packages/backend/read-models/person-profile/application/list_person_timeline_test.ts",
        "packages/backend/read-models/today/application/get_today_interactions_test.ts",
        "packages/backend/read-models/today/application/get_today_recent_people_test.ts",
        "packages/contracts/client_test.ts",
        "packages/contracts/registry_test.ts",
        "packages/contracts/today_test.ts",
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
        "tools/e2e_tls_test.ts",
        "tools/gateway_contract_test.ts",
        "tools/migrations/baseline_test.ts",
        "tools/postgres_gate_test.ts",
        "tools/product/PRODUCT-001/release_contract_test.ts",
        "tools/schema/database_types_test.ts",
      ],
      permissions: {
        read: [
          ...API_CONFIGURATION_READS,
          "personal-crm-schema/v16/personal_crm_field_catalog_v16.csv",
          "personal-crm-schema/v16/personal_crm_schema_spec_v16.md",
          "personal-crm-schema/v16/personal_crm_schema_v16.sql",
          // MCP-E3: v16 is proven to be v15 plus 0016's table and nothing else.
          "personal-crm-schema/v16/migrations/0016_add_request_tombstones.sql",
          "personal-crm-schema/v15/personal_crm_schema_v15.sql",
          "packages/contracts",
          // The role table reads the matrix it executes (AUD-K5).
          "docs/architecture/authorization-matrix.yaml",
          ...OWNERSHIP_BOUNDARY_READS,
          ".tls/e2e",
        ],
        // `tools/e2e_tls_test.ts` writes and removes one run's TLS material.
        write: [".tls/e2e"],
        env: ["CI"],
        // `tools/e2e_test.ts` drives the launcher's process helpers, which
        // spawn `ps` and `kill` off Windows (REL-040).
        run: E2E_PROCESS_BINARIES,
        net: ["127.0.0.1"],
      },
    },
    contract: [
      "apps/api/app_test.ts",
      "apps/api/routes_test.ts",
      "packages/backend/modules/workspaces/transport/http/authentication_test.ts",
      "packages/backend/modules/files/transport/http/routes_test.ts",
      "packages/backend/modules/interactions/transport/http/routes_test.ts",
      "packages/backend/modules/workspaces/transport/http/invitations/accept_test.ts",
      "packages/backend/modules/workspaces/transport/http/invitations/create_test.ts",
      "packages/backend/modules/workspaces/transport/http/invitations/register_test.ts",
      "packages/backend/modules/workspaces/transport/http/invitations/routes_test.ts",
      "packages/backend/modules/people/transport/http/dates_test.ts",
      "packages/backend/modules/people/transport/http/directory_test.ts",
      "packages/backend/modules/people/transport/http/facts_test.ts",
      "packages/backend/modules/people/transport/http/avatar_test.ts",
      "packages/backend/modules/people/transport/http/star_test.ts",
      "packages/backend/modules/people/transport/http/tag_facet_test.ts",
      "packages/backend/modules/people/transport/http/merge_test.ts",
      "packages/backend/modules/people/transport/http/bulk_test.ts",
      "packages/backend/modules/people/transport/http/identity_test.ts",
      "packages/backend/modules/people/transport/http/life_events_test.ts",
      "packages/backend/modules/people/transport/http/lifecycle_test.ts",
      "packages/backend/modules/people/transport/http/profile_test.ts",
      "packages/backend/modules/people/transport/http/recent_people_test.ts",
      "packages/backend/modules/people/transport/http/routes_test.ts",
      "packages/backend/modules/people/transport/http/tag_options_test.ts",
      "packages/backend/modules/people/transport/http/timeline_test.ts",
      "apps/api/registration_test.ts",
      "packages/backend/modules/relationships/transport/http/routes_test.ts",
      "packages/backend/modules/workspaces/transport/http/settings/personalization_test.ts",
      "packages/backend/modules/workspaces/transport/http/settings/preferences_test.ts",
      "packages/backend/modules/workspaces/transport/http/settings/routes_test.ts",
      "packages/backend/modules/workspaces/transport/http/settings/sessions_test.ts",
      "packages/backend/modules/workspaces/transport/http/settings/ui_state_test.ts",
      "packages/contracts/client_test.ts",
      "packages/contracts/registry_test.ts",
      "packages/contracts/today_test.ts",
      "packages/contracts/files_test.ts",
      "packages/contracts/health_test.ts",
      "tools/contracts/interactions_contract_test.ts",
      "tools/contracts/people_contract_test.ts",
      "tools/contracts/registration_contract_test.ts",
    ],
    integration: [
      "tests/integration/authentication_budget_postgres_test.ts",
      "tests/integration/authentication_sign_in_postgres_test.ts",
      "tests/integration/files_postgres_test.ts",
      "tests/integration/avatars_postgres_test.ts",
      "tests/integration/people_favorites_postgres_test.ts",
      "tests/integration/people_directory_capacity_postgres_test.ts",
      "tests/integration/person_merge_postgres_test.ts",
      "tests/integration/people_bulk_postgres_test.ts",
      "tests/integration/files_object_store_postgres_test.ts",
      // MCP-B8: personal tokens on a person's files.
      "tests/integration/api_tokens_files_postgres_test.ts",
      "tests/integration/governance_postgres_test.ts",
      "tests/integration/interactions_activities_postgres_test.ts",
      "tests/integration/interactions_communications_postgres_test.ts",
      "tests/integration/people_directory_postgres_test.ts",
      "tests/integration/people_profile_postgres_test.ts",
      "tests/integration/people_lifecycle_postgres_test.ts",
      // Personal tokens on the people-identity routes (MCP-B1).
      "tests/integration/api_tokens_people_identity_postgres_test.ts",
      "tests/integration/people_dates_postgres_test.ts",
      "tests/integration/people_facts_postgres_test.ts",
      "tests/integration/api_tokens_people_profile_postgres_test.ts",
      "tests/integration/people_relationships_postgres_test.ts",
      "tests/integration/settings_preferences_postgres_test.ts",
      "tests/integration/settings_personalization_postgres_test.ts",
      // Personal tokens on the personalization routes (MCP-B9).
      "tests/integration/api_tokens_vocabularies_postgres_test.ts",
      "tests/integration/time_preferences_postgres_test.ts",
      "tests/integration/migrations_postgres_test.ts",
      "tests/integration/workspace_isolation_postgres_test.ts",
      "tests/integration/read_models_reports_postgres_test.ts",
      "tests/integration/read_models_today_postgres_test.ts",
    ],
    coverage: {
      directory: "deno",
      postgres: true,
      include: [
        "apps/api",
        "packages/backend",
        "packages/contracts",
        "packages/http-kit",
        "tools/contracts",
        "tools/migrations",
      ],
      // GAP-021 split the people, settings, and invitation suites into one
      // file per concern, and what they share moved into `.test-helper.ts`
      // modules beside them. Those are scaffolding, not the code this set
      // measures. The generated Kysely types are derived output (GAP-042).
      exclude: [
        ...COVERAGE_EXCLUDES_WITH_HELPERS,
        "packages/backend/platform/postgres/generated/",
      ],
      permissions: {
        read: [
          ...API_CONFIGURATION_READS,
          "packages/contracts",
          // The role table reads the matrix it executes (AUD-K5).
          "docs/architecture/authorization-matrix.yaml",
          ...SCHEMA_READS,
          // The vCard and CSV parser fixtures (GAP-050).
          "packages/backend/modules/import-export/domain/formats/fixtures",
          ".tls/e2e",
        ],
        write: [".tls/e2e"],
        // As in the unit set: `tools/e2e_test.ts` runs here too (REL-040).
        run: E2E_PROCESS_BINARIES,
        // The worker composition suite configures reminder email.
        env: [
          "CI",
          ...APPLICATION_DATABASE_ENV,
          ...FIXTURE_DATABASE_ENV,
          ...REMINDER_MAIL_ENV,
        ],
        net: "all",
      },
      tests: [
        "apps/api/app_test.ts",
        "apps/api/routes_test.ts",
        // Default-deny for every protected route, and the authorization
        // matrix executed against every route (AUD-K5).
        "apps/api/default_deny_test.ts",
        "apps/api/role_matrix_test.ts",
        // The pins on every module's refusal tables, which read all of the
        // route surfaces this app mounts, and the object-storage
        // configuration the files suite used to carry (GAP-024).
        "apps/api/failures_test.ts",
        "apps/api/file_storage_config_test.ts",
        // Every module's audit description forwards the actor's request
        // identifier (GAP-039).
        "apps/api/audit_correlation_test.ts",
        // The avatar bridge passes on a discard it could not complete
        // (REL-083).
        "apps/api/avatar_bridge_test.ts",
        "packages/backend/modules/workspaces/transport/http/authentication_test.ts",
        "packages/backend/modules/import-export/transport/http/exports_test.ts",
        "packages/backend/modules/files/transport/http/routes_test.ts",
        "packages/backend/modules/gifts/transport/http/routes_test.ts",
        "packages/backend/modules/governance/transport/http/routes_test.ts",
        "packages/http-kit/body_limit_test.ts",
        "packages/http-kit/client_address_test.ts",
        "packages/http-kit/cookies_test.ts",
        "packages/http-kit/cors_test.ts",
        "packages/http-kit/downloads_test.ts",
        "packages/http-kit/failures_test.ts",
        "packages/http-kit/health_test.ts",
        "packages/http-kit/logging_test.ts",
        "packages/http-kit/origin_test.ts",
        "packages/http-kit/problem_test.ts",
        "packages/http-kit/request_id_test.ts",
        "packages/http-kit/route_admission_test.ts",
        "packages/http-kit/route_test.ts",
        "packages/http-kit/secure_headers_test.ts",
        "packages/http-kit/session_test.ts",
        "packages/http-kit/validate_test.ts",
        "packages/backend/modules/import-export/transport/http/imports_test.ts",
        "packages/backend/modules/interactions/transport/http/routes_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/accept_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/create_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/register_test.ts",
        "packages/backend/modules/workspaces/transport/http/invitations/routes_test.ts",
        "packages/backend/modules/journal/transport/http/routes_test.ts",
        "packages/backend/modules/journal/transport/http/life_events_test.ts",
        "packages/backend/modules/people/transport/http/dates_test.ts",
        "packages/backend/modules/people/transport/http/directory_test.ts",
        "packages/backend/modules/people/transport/http/facts_test.ts",
        "packages/backend/modules/people/transport/http/avatar_test.ts",
        "packages/backend/modules/people/transport/http/star_test.ts",
        "packages/backend/modules/people/transport/http/tag_facet_test.ts",
        "packages/backend/modules/people/transport/http/merge_test.ts",
        "packages/backend/modules/people/transport/http/bulk_test.ts",
        "packages/backend/modules/people/transport/http/identity_test.ts",
        "packages/backend/modules/people/transport/http/life_events_test.ts",
        "packages/backend/modules/people/transport/http/lifecycle_test.ts",
        "packages/backend/modules/people/transport/http/profile_test.ts",
        "packages/backend/modules/people/transport/http/recent_people_test.ts",
        "packages/backend/modules/people/transport/http/routes_test.ts",
        "packages/backend/modules/people/transport/http/tag_options_test.ts",
        "packages/backend/modules/people/transport/http/timeline_test.ts",
        "packages/backend/modules/people/transport/http/search_test.ts",
        "packages/backend/modules/workspaces/transport/http/personal_lifecycle_test.ts",
        "packages/backend/modules/planning/transport/http/routes_test.ts",
        "packages/backend/modules/planning/transport/http/notifications_test.ts",
        "apps/api/registration_test.ts",
        "packages/backend/modules/relationships/transport/http/routes_test.ts",
        "apps/api/security_config_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/personalization_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/preferences_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/routes_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/sessions_test.ts",
        "packages/backend/modules/workspaces/transport/http/settings/ui_state_test.ts",
        "packages/backend/modules/workspaces/transport/http/workspace_lifecycle_test.ts",
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
        "packages/backend/shared-kernel/telemetry_test.ts",
        "packages/backend/shared-kernel/audit_event_test.ts",
        "packages/backend/platform/postgres/config_test.ts",
        "packages/backend/platform/postgres/errors_test.ts",
        "packages/backend/platform/postgres/lifecycle_impact_test.ts",
        "packages/backend/platform/postgres/name_match_test.ts",
        "packages/backend/platform/postgres/person_display_test.ts",
        "packages/backend/platform/postgres/reference_counter_test.ts",
        "packages/backend/platform/postgres/person_references_test.ts",
        "packages/backend/platform/postgres/rows_test.ts",
        "packages/backend/platform/postgres/timestamps_test.ts",
        "packages/backend/platform/postgres/transactions_test.ts",
        "packages/backend/platform/telemetry/json_logger_test.ts",
        "packages/backend/modules/api-access/application/authentication_subject_test.ts",
        "packages/backend/modules/api-access/application/sign_in_device_test.ts",
        "packages/backend/modules/api-access/domain/token_rules_test.ts",
        "packages/backend/modules/governance/domain/legal_rules_test.ts",
        "packages/backend/modules/identity/domain/identity_rules_test.ts",
        "packages/backend/modules/identity/adapters/crypto/argon2id_test.ts",
        "packages/backend/modules/identity/adapters/crypto/totp_test.ts",
        "packages/backend/modules/identity/adapters/postgres/authentication_test.ts",
        "packages/backend/modules/identity/application/password_recovery_test.ts",
        "packages/backend/modules/integrations/domain/dav_rules_test.ts",
        "packages/backend/modules/integrations/domain/ical_test.ts",
        "packages/backend/modules/files/domain/cursors_test.ts",
        "packages/backend/modules/files/domain/file_rules_test.ts",
        "packages/backend/modules/files/adapters/object_storage/s3_compatible_object_storage_test.ts",
        "packages/backend/modules/files/adapters/scanning/declared_media_scanner_test.ts",
        "packages/backend/modules/files/adapters/crypto/file_identifiers_test.ts",
        "packages/backend/modules/files/application/person_files_test.ts",
        "packages/backend/modules/gifts/domain/cursors_test.ts",
        "packages/backend/modules/gifts/domain/gift_rules_test.ts",
        "packages/backend/modules/gifts/domain/recurring_debts_test.ts",
        "packages/backend/modules/gifts/domain/gift_edits_test.ts",
        "packages/backend/modules/gifts/application/gift_management_test.ts",
        "packages/backend/modules/gifts/application/recurring_debts_test.ts",
        "packages/backend/modules/gifts/application/gift_edits_test.ts",
        "packages/backend/modules/import-export/domain/export_rules_test.ts",
        "packages/backend/modules/import-export/domain/formats/canonical_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_sql_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_business_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_contact_types_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_catalog_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_extra_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_audit_test.ts",
        "packages/backend/modules/import-export/domain/business_entities_test.ts",
        "packages/backend/modules/import-export/domain/formats/portable_json_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_test.ts",
        "packages/backend/modules/import-export/domain/import_rules_test.ts",
        "packages/backend/modules/import-export/domain/contact_import_test.ts",
        "packages/backend/modules/import-export/domain/contact_type_mapping_test.ts",
        "packages/backend/modules/import-export/domain/monica_choices_test.ts",
        "packages/backend/modules/import-export/domain/formats/contact_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/contacts_export_test.ts",
        "packages/backend/modules/import-export/domain/formats/csv_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_parse_test.ts",
        "packages/backend/modules/import-export/domain/formats/zip_test.ts",
        "packages/backend/modules/import-export/application/import_management_test.ts",
        "packages/backend/modules/import-export/application/business_import_test.ts",
        "packages/backend/modules/import-export/application/contact_import_management_test.ts",
        "packages/backend/modules/import-export/application/export_management_test.ts",
        "packages/backend/modules/interactions/domain/communication_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_changes_test.ts",
        "packages/backend/modules/interactions/application/record_interaction_test.ts",
        "packages/backend/modules/interactions/application/interaction_changes_test.ts",
        "packages/backend/modules/journal/domain/cursors_test.ts",
        "packages/backend/modules/journal/domain/journal_rules_test.ts",
        "packages/backend/modules/journal/domain/life_event_rules_test.ts",
        "packages/backend/modules/journal/application/journal_management_test.ts",
        "packages/backend/modules/journal/application/life_events_test.ts",
        "packages/backend/modules/people/domain/important_dates/rules_test.ts",
        "packages/backend/modules/people/domain/lifecycle_rules_test.ts",
        "packages/backend/modules/people/domain/person_identity_test.ts",
        "packages/backend/modules/people/domain/person_name_test.ts",
        "packages/backend/modules/people/domain/avatar_test.ts",
        "packages/backend/modules/people/domain/merge_rules_test.ts",
        "packages/backend/modules/people/domain/bulk_rules_test.ts",
        "packages/backend/modules/people/domain/profile_facts/cursors_test.ts",
        "packages/backend/modules/people/domain/profile_facts/normalize_test.ts",
        "packages/backend/modules/people/domain/profile_facts/validate_test.ts",
        "packages/backend/modules/people/application/create_person_test.ts",
        "packages/backend/modules/people/application/important_dates_test.ts",
        "packages/backend/modules/people/application/profile_facts_test.ts",
        "packages/backend/modules/people/application/lifecycle_person_test.ts",
        "packages/backend/modules/people/application/person_avatar_test.ts",
        "packages/backend/modules/people/application/person_star_test.ts",
        "packages/backend/modules/people/application/duplicate_dismissal_test.ts",
        "packages/backend/modules/people/application/merge_people_test.ts",
        "packages/backend/modules/people/application/bulk_people_test.ts",
        "packages/backend/modules/planning/domain/cadence_test.ts",
        "packages/backend/modules/planning/domain/cursors_test.ts",
        "packages/backend/modules/planning/domain/delivery_rules_test.ts",
        "packages/backend/modules/planning/domain/recurrence_test.ts",
        "packages/backend/modules/planning/domain/reminder_rules_test.ts",
        "packages/backend/modules/planning/domain/task_rules_test.ts",
        "packages/backend/modules/planning/application/task_management_test.ts",
        "packages/backend/modules/planning/application/reminder_management_test.ts",
        "packages/backend/modules/planning/application/reminder_delivery_test.ts",
        "packages/backend/modules/planning/adapters/in_app/reminder_delivery_test.ts",
        "packages/backend/modules/relationships/domain/cursors_test.ts",
        "packages/backend/modules/relationships/domain/relationship_rules_test.ts",
        "packages/backend/modules/relationships/application/manage_relationships_test.ts",
        "packages/backend/read-models/activity-report/application/list_activity_report_test.ts",
        "packages/backend/read-models/audit-history/application/list_audit_history_test.ts",
        "packages/backend/read-models/people-directory/application/list_people_test.ts",
        "packages/backend/read-models/people-directory/application/list_duplicates_test.ts",
        "packages/backend/read-models/people-directory/application/list_tag_options_test.ts",
        "packages/backend/read-models/people-directory/application/list_tag_facet_test.ts",
        "packages/backend/read-models/person-profile/application/get_person_profile_test.ts",
        "packages/backend/read-models/person-profile/application/compose_person_rail_test.ts",
        "packages/backend/read-models/person-profile/application/list_person_timeline_test.ts",
        "packages/backend/read-models/today/application/get_today_interactions_test.ts",
        "packages/backend/read-models/today/application/get_today_recent_people_test.ts",
        "packages/backend/read-models/today/application/get_today_reminders_test.ts",
        "packages/backend/read-models/today/application/get_today_tasks_test.ts",
        "packages/backend/read-models/search/application/search_workspace_test.ts",
        "packages/backend/read-models/calendar-feed/application/read_calendar_feed_test.ts",
        "packages/backend/modules/integrations/application/calendar_feed_test.ts",
        "packages/backend/modules/integrations/transport/http/calendar_feed_test.ts",
        "packages/backend/modules/api-access/application/calendar_feed_tokens_test.ts",
        "packages/backend/modules/api-access/transport/http/calendar_feed_test.ts",
        "packages/backend/read-models/notifications/application/list_notifications_test.ts",
        "packages/backend/modules/workspaces/domain/invitation_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personal_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personalization_rules_test.ts",
        "packages/backend/modules/workspaces/domain/registration_rules_test.ts",
        "packages/backend/modules/workspaces/domain/roles_test.ts",
        "packages/backend/modules/workspaces/domain/session_rules_test.ts",
        "packages/backend/modules/workspaces/domain/settings_rules_test.ts",
        "packages/backend/modules/workspaces/domain/ui_state_rules_test.ts",
        "packages/backend/modules/workspaces/domain/workspace_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/application/recent_people_test.ts",
        "packages/backend/modules/workspaces/application/register_first_workspace_test.ts",
        "packages/backend/modules/workspaces/application/protected_session_test.ts",
        "packages/backend/modules/workspaces/application/invite_member_test.ts",
        "packages/backend/modules/workspaces/application/member_ui_state_test.ts",
        "packages/backend/modules/workspaces/application/settings_management_test.ts",
        "packages/backend/modules/workspaces/application/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/application/workspace_lifecycle_test.ts",
        "packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail_test.ts",
        "packages/backend/modules/workspaces/adapters/mail/smtp_reminder_mail_test.ts",
        "packages/contracts/client_test.ts",
        "packages/contracts/registry_test.ts",
        "packages/contracts/today_test.ts",
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
        "tools/e2e_tls_test.ts",
        "tools/gateway_contract_test.ts",
        "tools/migrations/baseline_test.ts",
        "tools/postgres_gate_test.ts",
        "tools/product/PRODUCT-001/release_contract_test.ts",
        "tests/integration/registration_postgres_test.ts",
        "tests/integration/registration_takeover_postgres_test.ts",
        "tests/integration/registration_mail_ceiling_postgres_test.ts",
        "tests/integration/authentication_budget_postgres_test.ts",
        "tests/integration/authentication_sign_in_postgres_test.ts",
        "tests/integration/files_postgres_test.ts",
        "tests/integration/avatars_postgres_test.ts",
        "tests/integration/people_favorites_postgres_test.ts",
        "tests/integration/people_directory_capacity_postgres_test.ts",
        "tests/integration/person_merge_postgres_test.ts",
        "tests/integration/people_bulk_postgres_test.ts",
        "tests/integration/files_object_store_postgres_test.ts",
        "tests/integration/gifts_postgres_test.ts",
        "tests/integration/governance_postgres_test.ts",
        "tests/integration/import_postgres_test.ts",
        "tests/integration/import_extra_postgres_test.ts",
        "tests/integration/import_business_postgres_test.ts",
        "tests/integration/contact_import_postgres_test.ts",
        "tests/integration/export_postgres_test.ts",
        "tests/integration/contact_export_postgres_test.ts",
        "tests/integration/interactions_activities_postgres_test.ts",
        "tests/integration/interactions_communications_postgres_test.ts",
        "tests/integration/invitation_postgres_test.ts",
        "tests/integration/invitation_mail_relay_postgres_test.ts",
        "tests/integration/journal_postgres_test.ts",
        "tests/integration/life_events_postgres_test.ts",
        "tests/integration/people_directory_postgres_test.ts",
        "tests/integration/people_profile_postgres_test.ts",
        "tests/integration/people_lifecycle_postgres_test.ts",
        "tests/integration/people_dates_postgres_test.ts",
        "tests/integration/people_facts_postgres_test.ts",
        "tests/integration/people_relationships_postgres_test.ts",
        "tests/integration/personal_lifecycle_postgres_test.ts",
        "tests/integration/planning_tasks_postgres_test.ts",
        "tests/integration/planning_today_postgres_test.ts",
        "tests/integration/planning_reminders_postgres_test.ts",
        "tests/integration/planning_cadences_postgres_test.ts",
        "tests/integration/planning_delivery_postgres_test.ts",
        "tests/integration/planning_email_delivery_postgres_test.ts",
        "tests/integration/planning_edit_delete_postgres_test.ts",
        "tests/integration/settings_preferences_postgres_test.ts",
        "tests/integration/settings_personalization_postgres_test.ts",
        "tests/integration/time_preferences_postgres_test.ts",
        "tests/integration/migrations_postgres_test.ts",
        "tests/integration/workspace_isolation_postgres_test.ts",
        "tests/integration/read_models_reports_postgres_test.ts",
        "tests/integration/read_models_today_postgres_test.ts",
        "tests/integration/search_postgres_test.ts",
        "tests/integration/calendar_feed_postgres_test.ts",
        "tests/integration/notifications_postgres_test.ts",
      ],
    },
  },
  {
    id: "api-access",
    unit: {
      tests: [
        "packages/backend/modules/api-access/transport/http/routes_test.ts",
        "packages/backend/modules/api-access/transport/http/calendar_feed_test.ts",
        "packages/backend/modules/api-access/application/api_token_management_test.ts",
        "packages/backend/modules/api-access/application/calendar_feed_tokens_test.ts",
        // The signed sign-in device token (AUD-A3).
        "packages/backend/modules/api-access/application/sign_in_device_test.ts",
        "packages/backend/modules/api-access/domain/token_rules_test.ts",
        // Request-log retention (AUD-A2).
        "packages/backend/modules/api-access/application/request_log_retention_test.ts",
        "packages/contracts/api_tokens_test.ts",
      ],
    },
    integration: [
      "tests/integration/api_tokens_postgres_test.ts",
      // SECA-04 (AUD-A2): request-log rows outlive no throttle or budget.
      "tests/integration/request_log_retention_postgres_test.ts",
    ],
    coverage: {
      directory: "api-access",
      postgres: true,
      permissions: { env: "all", net: "all" },
      tests: [
        "packages/backend/modules/api-access/transport/http/routes_test.ts",
        "packages/backend/modules/api-access/transport/http/calendar_feed_test.ts",
        "packages/backend/modules/people/transport/http/directory_test.ts",
        "packages/backend/modules/api-access/application/api_token_management_test.ts",
        "packages/backend/modules/api-access/application/calendar_feed_tokens_test.ts",
        "packages/backend/modules/api-access/domain/token_rules_test.ts",
        "tests/integration/api_tokens_postgres_test.ts",
        "tests/integration/calendar_feed_postgres_test.ts",
      ],
      include: [
        "packages/backend/modules/api-access/transport/http/routes.ts",
        "packages/backend/modules/api-access/transport/http/calendar_feed.ts",
        "packages/backend/modules/api-access/adapters/crypto/api_token_secrets.ts",
        "packages/backend/modules/api-access/adapters/postgres/api_token_repository.ts",
        "packages/backend/modules/api-access/application/api_token_management.ts",
        "packages/backend/modules/api-access/application/calendar_feed_tokens.ts",
        "packages/backend/modules/api-access/application/token_authentication.ts",
        "packages/backend/modules/api-access/application/audit_events.ts",
        "packages/backend/modules/api-access/domain",
      ],
    },
  },
  {
    // The api-access domain is pure: what a personal access token's text is,
    // which permissions exist, and everything about a presented one that can
    // be decided before its secret is hashed. It is measured on its own at the
    // bar the shared kernel keeps; the suite's unit home is `api-access`, and
    // the wider set sits at the repository floor because it measures the HTTP
    // surface and the adapters too, so this module declares coverage alone.
    id: "api-access-domain",
    coverage: {
      directory: "api-access-domain",
      threshold: 95,
      tests: ["packages/backend/modules/api-access/domain/token_rules_test.ts"],
      include: ["packages/backend/modules/api-access/domain"],
    },
  },
  {
    // The MCP endpoint (ADR 0009, MCP-C1): the kit that serves it, the tool
    // catalog it serves, and the PostgreSQL suite that drives it over the
    // real composition as an MCP client would.
    id: "mcp",
    unit: {
      tests: [
        "packages/mcp-kit/endpoint_test.ts",
        "packages/mcp-kit/tool_call_test.ts",
        "packages/mcp-kit/catalog_request_test.ts",
        "packages/contracts/tools/define_test.ts",
        "packages/contracts/tools/mod_test.ts",
      ],
    },
    integration: ["tests/integration/mcp_postgres_test.ts"],
    coverage: {
      directory: "mcp",
      tests: [
        "packages/mcp-kit/endpoint_test.ts",
        "packages/mcp-kit/tool_call_test.ts",
        "packages/mcp-kit/catalog_request_test.ts",
        "packages/contracts/tools/define_test.ts",
        "packages/contracts/tools/mod_test.ts",
      ],
      include: ["packages/mcp-kit", "packages/contracts/tools"],
    },
  },
  {
    id: "integrations",
    unit: {
      tests: [
        "packages/backend/modules/integrations/transport/http/routes_test.ts",
        "packages/backend/modules/integrations/domain/dav_rules_test.ts",
        "packages/backend/modules/integrations/domain/ical_test.ts",
        "packages/backend/modules/integrations/application/dav_sync_test.ts",
        "packages/backend/modules/integrations/adapters/dav/http_dav_client_test.ts",
        "packages/backend/modules/integrations/adapters/crypto/dav_secret_box_test.ts",
        "packages/contracts/integrations_test.ts",
      ],
    },
    integration: ["tests/integration/dav_postgres_test.ts"],
    coverage: {
      directory: "integrations",
      postgres: true,
      permissions: { env: "all", net: "all" },
      tests: [
        "packages/backend/modules/integrations/transport/http/routes_test.ts",
        "packages/backend/modules/integrations/domain/dav_rules_test.ts",
        "packages/backend/modules/integrations/domain/ical_test.ts",
        "packages/backend/modules/integrations/application/dav_sync_test.ts",
        "packages/backend/modules/integrations/adapters/dav/http_dav_client_test.ts",
        "packages/backend/modules/integrations/adapters/crypto/dav_secret_box_test.ts",
        "packages/backend/modules/people/application/create_person_test.ts",
        "packages/backend/modules/people/application/lifecycle_person_test.ts",
        "packages/backend/modules/planning/application/task_management_test.ts",
        "packages/contracts/integrations_test.ts",
        "tests/integration/dav_postgres_test.ts",
      ],
      include: [
        "packages/backend/modules/integrations/transport/http/routes.ts",
        "packages/backend/modules/integrations/adapters/crypto/dav_secret_box.ts",
        "packages/backend/modules/integrations/adapters/dav/http_dav_client.ts",
        "packages/backend/modules/integrations/adapters/postgres/dav_repository.ts",
        "packages/backend/modules/integrations/application/dav_sync.ts",
        "packages/backend/modules/integrations/application/dav_context.ts",
        "packages/backend/modules/integrations/application/dav_subscriptions.ts",
        "packages/backend/modules/integrations/application/dav_synchronize.ts",
        "packages/backend/modules/integrations/application/audit_events.ts",
        "packages/backend/modules/integrations/domain",
        "packages/backend/modules/people/application/create_person.ts",
        "packages/backend/modules/people/application/lifecycle_person.ts",
        "packages/backend/modules/planning/application/task_management.ts",
      ],
    },
  },
  {
    // The integrations domain is pure: what a DAV subscription may point at,
    // the identity a remote object keeps across runs, and what a member is
    // told when somebody else's server refuses. It is measured on its own at
    // the bar the shared kernel keeps; the suite's unit home is
    // `integrations`, and the wider set sits at the repository floor because
    // it measures the HTTP surface, the transport, and two other modules'
    // boundaries too, so this module declares coverage alone.
    id: "integrations-domain",
    coverage: {
      directory: "integrations-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/integrations/domain/dav_rules_test.ts",
        "packages/backend/modules/integrations/domain/ical_test.ts",
      ],
      include: ["packages/backend/modules/integrations/domain"],
    },
  },
  {
    id: "planning",
    unit: {
      tests: [
        "packages/backend/modules/planning/transport/http/routes_test.ts",
        "apps/worker/composition_test.ts",
        "apps/worker/main_test.ts",
        "packages/backend/modules/planning/domain/cadence_test.ts",
        "packages/backend/modules/planning/domain/cursors_test.ts",
        "packages/backend/modules/planning/domain/delivery_rules_test.ts",
        "packages/backend/modules/planning/domain/recurrence_test.ts",
        "packages/backend/modules/planning/domain/reminder_rules_test.ts",
        "packages/backend/modules/planning/domain/task_rules_test.ts",
        "packages/backend/modules/planning/application/task_management_test.ts",
        "packages/backend/modules/planning/application/reminder_management_test.ts",
        "packages/backend/modules/planning/application/reminder_delivery_test.ts",
        "packages/backend/modules/planning/adapters/in_app/reminder_delivery_test.ts",
        "packages/backend/read-models/today/application/get_today_attention_test.ts",
        "packages/backend/read-models/today/application/get_today_tasks_test.ts",
        "packages/backend/read-models/today/application/get_today_reminders_test.ts",
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
      "packages/backend/modules/planning/transport/http/routes_test.ts",
      "tools/contracts/planning_contract_test.ts",
    ],
    integration: [
      "tests/integration/planning_tasks_postgres_test.ts",
      "tests/integration/planning_today_postgres_test.ts",
      "tests/integration/planning_reminders_postgres_test.ts",
      "tests/integration/planning_cadences_postgres_test.ts",
      "tests/integration/planning_delivery_postgres_test.ts",
      "tests/integration/planning_email_delivery_postgres_test.ts",
      // Deleting tasks, reminders, and cadences and editing reminders (MCP-D2).
      "tests/integration/planning_edit_delete_postgres_test.ts",
      // Personal tokens on the reminder and Today planning routes (MCP-B5).
      "tests/integration/api_tokens_planning_postgres_test.ts",
      // The worker loop under a cut database connection (BEQ-09).
      "tests/integration/worker_resilience_postgres_test.ts",
    ],
    coverage: {
      directory: "planning",
      postgres: true,
      permissions: {
        read: [...SCHEMA_READS],
        env: [...APPLICATION_DATABASE_ENV, ...FIXTURE_DATABASE_ENV],
        net: "all",
        // The reminder email suite starts, and removes, its own Mailpit.
        run: ["docker"],
      },
      tests: [
        "packages/backend/modules/planning/transport/http/routes_test.ts",
        "packages/backend/modules/planning/domain/cadence_test.ts",
        "packages/backend/modules/planning/domain/cursors_test.ts",
        "packages/backend/modules/planning/domain/delivery_rules_test.ts",
        "packages/backend/modules/planning/domain/recurrence_test.ts",
        "packages/backend/modules/planning/domain/reminder_rules_test.ts",
        "packages/backend/modules/planning/domain/task_rules_test.ts",
        "packages/backend/modules/planning/application/task_management_test.ts",
        "packages/backend/modules/planning/application/reminder_management_test.ts",
        "packages/backend/modules/planning/application/reminder_delivery_test.ts",
        "packages/backend/modules/planning/adapters/in_app/reminder_delivery_test.ts",
        "packages/backend/read-models/audit-history/application/list_audit_history_test.ts",
        "packages/backend/read-models/today/application/get_today_attention_test.ts",
        "packages/backend/read-models/today/application/get_today_tasks_test.ts",
        "packages/backend/read-models/today/application/get_today_reminders_test.ts",
        "tools/contracts/planning_contract_test.ts",
        "tests/integration/planning_tasks_postgres_test.ts",
        "tests/integration/planning_today_postgres_test.ts",
        "tests/integration/planning_reminders_postgres_test.ts",
        "tests/integration/planning_cadences_postgres_test.ts",
        "tests/integration/planning_delivery_postgres_test.ts",
        "tests/integration/planning_email_delivery_postgres_test.ts",
        "tests/integration/planning_edit_delete_postgres_test.ts",
        "tests/integration/read_models_today_postgres_test.ts",
      ],
      include: [
        "packages/backend/modules/planning/transport/http/routes.ts",
        "packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts",
        "packages/backend/modules/planning/adapters/postgres/task_repository.ts",
        "packages/backend/modules/planning/adapters/postgres/reminder_repository.ts",
        "packages/backend/modules/planning/application/task_management.ts",
        "packages/backend/modules/planning/application/task_context.ts",
        "packages/backend/modules/planning/application/task_listing.ts",
        "packages/backend/modules/planning/application/task_writes.ts",
        "packages/backend/modules/planning/application/reminder_management.ts",
        "packages/backend/modules/planning/application/reminder_context.ts",
        "packages/backend/modules/planning/application/reminder_definitions.ts",
        "packages/backend/modules/planning/application/reminder_cadences.ts",
        "packages/backend/modules/planning/application/reminder_occurrences.ts",
        "packages/backend/modules/planning/application/reminder_delivery.ts",
        "packages/backend/modules/planning/application/audit_events.ts",
        "packages/backend/modules/planning/domain",
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
    // Planning's domain is pure: the calendar arithmetic a recurrence obeys,
    // the cadence interval, the task and reminder rules, the signed task
    // cursor, and what a provider's answer means. It is measured on its own at
    // the bar the shared kernel keeps; the suites' unit home is `planning`, so
    // this module declares coverage alone.
    id: "planning-domain",
    coverage: {
      directory: "planning-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/planning/domain/cadence_test.ts",
        "packages/backend/modules/planning/domain/cursors_test.ts",
        "packages/backend/modules/planning/domain/delivery_rules_test.ts",
        "packages/backend/modules/planning/domain/recurrence_test.ts",
        "packages/backend/modules/planning/domain/reminder_rules_test.ts",
        "packages/backend/modules/planning/domain/task_rules_test.ts",
      ],
      include: ["packages/backend/modules/planning/domain"],
    },
  },
  {
    // The relationship graph's own suite, which used to live in the `api` unit
    // set, and the domain the inverse-label and cursor rules moved into.
    id: "relationships",
    unit: {
      tests: [
        "packages/backend/modules/relationships/domain/cursors_test.ts",
        "packages/backend/modules/relationships/domain/relationship_rules_test.ts",
        "packages/backend/modules/relationships/application/manage_relationships_test.ts",
      ],
      permissions: {
        // The suite proves relationships and governance have no import edge by
        // reading the module graph with `deno info`.
        run: ["deno"],
      },
    },
    // Relationship writes under a personal token (MCP-B3).
    integration: [
      "tests/integration/api_tokens_relationships_postgres_test.ts",
    ],
    coverage: {
      directory: "relationships-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/relationships/domain/cursors_test.ts",
        "packages/backend/modules/relationships/domain/relationship_rules_test.ts",
      ],
      include: ["packages/backend/modules/relationships/domain"],
    },
  },
  {
    // The interactions module's domain is pure: what an activity, a note, a
    // call, and a conversation are, the canonical order a conversation's
    // messages read in, and the two deterministic identifier derivations that
    // make recording idempotent. It is measured on its own at the bar the
    // shared kernel keeps, and the module's use-case suite, which used to live
    // in the `api` unit set, lives here too so it has exactly one unit home.
    id: "interactions",
    unit: {
      tests: [
        "packages/backend/modules/interactions/domain/communication_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_changes_test.ts",
        "packages/backend/modules/interactions/application/record_interaction_test.ts",
        "packages/backend/modules/interactions/application/interaction_changes_test.ts",
      ],
    },
    integration: [
      // MCP-B4: personal tokens on interaction history and its Today regions.
      "tests/integration/api_tokens_interactions_postgres_test.ts",
      // MCP-D1: editing and deleting notes, activities, calls, and
      // conversations, by session and by an interactions:write token.
      "tests/integration/interactions_edit_delete_postgres_test.ts",
    ],
    coverage: {
      directory: "interactions-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/interactions/domain/communication_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_rules_test.ts",
        "packages/backend/modules/interactions/domain/interaction_changes_test.ts",
      ],
      include: ["packages/backend/modules/interactions/domain"],
    },
  },
  {
    id: "governance",
    unit: {
      tests: [
        "packages/backend/modules/governance/transport/http/routes_test.ts",
        "packages/backend/modules/governance/domain/legal_rules_test.ts",
        "packages/backend/modules/governance/application/legal_acceptance_test.ts",
        "packages/backend/modules/governance/application/historical_audit_import_test.ts",
        "packages/backend/modules/governance/adapters/postgres/audit_event_recorder_test.ts",
        "tools/contracts/governance_contract_test.ts",
      ],
    },
    contract: [
      "packages/backend/modules/governance/transport/http/routes_test.ts",
      "tools/contracts/governance_contract_test.ts",
    ],
    coverage: {
      directory: "governance",
      tests: [
        "packages/backend/modules/workspaces/transport/http/authentication_test.ts",
        "packages/backend/modules/governance/transport/http/routes_test.ts",
        "packages/backend/modules/governance/domain/legal_rules_test.ts",
        "packages/backend/modules/governance/application/legal_acceptance_test.ts",
        "packages/backend/modules/governance/application/historical_audit_import_test.ts",
        "packages/backend/modules/governance/adapters/postgres/audit_event_recorder_test.ts",
        "tools/contracts/governance_contract_test.ts",
      ],
      include: [
        "packages/backend/modules/governance/transport/http/routes.ts",
        "packages/backend/modules/governance/application/legal_acceptance.ts",
        "packages/backend/modules/governance/application/historical_audit_import.ts",
        "packages/backend/modules/governance/domain",
      ],
    },
  },
  {
    // Governance keeps deliberately little in its domain: the two documents a
    // visitor may read, and the fact that an acceptance records the address it
    // was made from only when there is one. Which documents a member still
    // owes is a question about rows, and the repository answers it. What is
    // here is measured on its own at the bar the shared kernel keeps; the
    // suite's unit home is `governance`, whose wider set measures the HTTP
    // surface too, so this module declares coverage alone.
    id: "governance-domain",
    coverage: {
      directory: "governance-domain",
      threshold: 95,
      tests: ["packages/backend/modules/governance/domain/legal_rules_test.ts"],
      include: ["packages/backend/modules/governance/domain"],
    },
  },
  {
    id: "gifts",
    unit: {
      tests: [
        "packages/backend/modules/gifts/transport/http/routes_test.ts",
        "packages/backend/modules/gifts/domain/cursors_test.ts",
        "packages/backend/modules/gifts/domain/gift_rules_test.ts",
        "packages/backend/modules/gifts/domain/recurring_debts_test.ts",
        "packages/backend/modules/gifts/domain/gift_edits_test.ts",
        "packages/backend/modules/gifts/application/gift_management_test.ts",
        "packages/backend/modules/gifts/application/recurring_debts_test.ts",
        "packages/backend/modules/gifts/application/gift_edits_test.ts",
        "packages/contracts/gifts_test.ts",
      ],
    },
    integration: [
      "tests/integration/gifts_postgres_test.ts",
      // MCP-B7: personal tokens on gifts and debts.
      "tests/integration/api_tokens_gifts_postgres_test.ts",
      // MCP-D3: edits, gift deletion, retry keys, and revisions.
      "tests/integration/gifts_edits_postgres_test.ts",
    ],
    coverage: {
      directory: "gifts",
      tests: [
        "packages/backend/modules/gifts/transport/http/routes_test.ts",
        "packages/backend/modules/gifts/domain/cursors_test.ts",
        "packages/backend/modules/gifts/domain/gift_rules_test.ts",
        "packages/backend/modules/gifts/domain/recurring_debts_test.ts",
        "packages/backend/modules/gifts/domain/gift_edits_test.ts",
        "packages/backend/modules/gifts/application/gift_management_test.ts",
        "packages/backend/modules/gifts/application/recurring_debts_test.ts",
        "packages/backend/modules/gifts/application/gift_edits_test.ts",
      ],
      include: [
        "packages/backend/modules/gifts/transport/http/routes.ts",
        "packages/backend/modules/gifts/application/gift_management.ts",
        "packages/backend/modules/gifts/application/gift_context.ts",
        "packages/backend/modules/gifts/application/gift_listing.ts",
        "packages/backend/modules/gifts/application/gift_writes.ts",
        "packages/backend/modules/gifts/application/gift_edits.ts",
        "packages/backend/modules/gifts/application/debt_settlements.ts",
        "packages/backend/modules/gifts/application/recurring_debts.ts",
        "packages/backend/modules/gifts/domain",
      ],
    },
  },
  {
    // The gifts domain is pure: what a gift and a debt are, where each status
    // may move, and what an amount of money is. It is measured on its own at
    // the bar the shared kernel keeps; the suite's unit home is `gifts`, and
    // the wider `gifts` set sits at the repository floor because it measures
    // the HTTP surface too, so this module declares coverage alone.
    id: "gifts-domain",
    coverage: {
      directory: "gifts-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/gifts/domain/cursors_test.ts",
        "packages/backend/modules/gifts/domain/gift_rules_test.ts",
        "packages/backend/modules/gifts/domain/recurring_debts_test.ts",
        "packages/backend/modules/gifts/domain/gift_edits_test.ts",
      ],
      include: ["packages/backend/modules/gifts/domain"],
    },
  },
  {
    // The files module's domain is pure: what may be uploaded, what a reader
    // is allowed to see of a stored file, and the checksum recorded against
    // the object so a later read can prove it fetched what was stored. It is
    // measured on its own at the bar the shared kernel keeps, and the module's
    // two suites, which used to live in the `api` unit set, live here too so
    // each has exactly one unit home.
    id: "files",
    unit: {
      tests: [
        "packages/backend/modules/files/domain/cursors_test.ts",
        "packages/backend/modules/files/domain/file_rules_test.ts",
        "packages/backend/modules/files/adapters/object_storage/s3_compatible_object_storage_test.ts",
        "packages/backend/modules/files/adapters/scanning/declared_media_scanner_test.ts",
        "packages/backend/modules/files/adapters/crypto/file_identifiers_test.ts",
        "packages/backend/modules/files/application/person_files_test.ts",
      ],
      permissions: {
        // The object-storage suite runs the S3 client against loopback
        // servers it starts itself (GAP-037, MCP-E4).
        net: ["127.0.0.1"],
      },
    },
    coverage: {
      directory: "files-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/files/domain/cursors_test.ts",
        "packages/backend/modules/files/domain/file_rules_test.ts",
      ],
      include: ["packages/backend/modules/files/domain"],
    },
  },
  {
    id: "storage",
    unit: {
      tests: [
        "packages/backend/modules/files/application/storage_settings_test.ts",
      ],
    },
    coverage: {
      directory: "storage",
      tests: [
        "packages/backend/modules/files/application/storage_settings_test.ts",
        "packages/backend/modules/files/transport/http/routes_test.ts",
        "apps/api/file_storage_config_test.ts",
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
        "packages/backend/modules/journal/transport/http/routes_test.ts",
        "packages/backend/modules/journal/transport/http/life_events_test.ts",
        "packages/backend/modules/journal/domain/cursors_test.ts",
        "packages/backend/modules/journal/domain/journal_rules_test.ts",
        "packages/backend/modules/journal/domain/life_event_rules_test.ts",
        "packages/backend/modules/journal/application/journal_management_test.ts",
        "packages/backend/modules/journal/application/life_events_test.ts",
        "packages/contracts/journal_test.ts",
      ],
      permissions: { read: ["packages/contracts"] },
    },
    contract: [
      "packages/backend/modules/journal/transport/http/routes_test.ts",
      "packages/backend/modules/journal/transport/http/life_events_test.ts",
      "packages/contracts/journal_test.ts",
    ],
    integration: [
      "tests/integration/journal_postgres_test.ts",
      "tests/integration/life_events_postgres_test.ts",
      "tests/integration/api_tokens_journal_postgres_test.ts",
    ],
    coverage: {
      directory: "journal",
      tests: [
        "packages/backend/modules/journal/transport/http/routes_test.ts",
        "packages/backend/modules/journal/transport/http/life_events_test.ts",
        "packages/backend/modules/journal/domain/cursors_test.ts",
        "packages/backend/modules/journal/domain/journal_rules_test.ts",
        "packages/backend/modules/journal/domain/life_event_rules_test.ts",
        "packages/backend/modules/journal/application/journal_management_test.ts",
        "packages/backend/modules/journal/application/life_events_test.ts",
      ],
      include: [
        "packages/backend/modules/journal/transport/http/routes.ts",
        "packages/backend/modules/journal/transport/http/life_events.ts",
        "packages/backend/modules/journal/application/journal_management.ts",
        "packages/backend/modules/journal/application/life_events.ts",
        "packages/backend/modules/journal/domain",
        "packages/backend/read-models/journal-timeline/application/list_journal_timeline.ts",
      ],
    },
  },
  {
    // The journal domain is pure: what a post and a day rating have to say for
    // themselves, and what counts as a day. It is measured on its own at the
    // bar the shared kernel keeps; the suite's unit home is `journal`, and the
    // wider `journal` set sits at the repository floor because it measures the
    // HTTP surface and a read model too, so this module declares coverage
    // alone.
    id: "journal-domain",
    coverage: {
      directory: "journal-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/journal/domain/cursors_test.ts",
        "packages/backend/modules/journal/domain/journal_rules_test.ts",
        "packages/backend/modules/journal/domain/life_event_rules_test.ts",
      ],
      include: ["packages/backend/modules/journal/domain"],
    },
  },
  {
    // Workspace search (GAP-048, `SEARCH-001`): the `search` read model over
    // people, notes, activities, journal posts, and tasks, and the route the
    // people surface serves it on. Its visibility rules exist only in SQL, so
    // the set measures the PostgreSQL suite beside the unit ones. Names match
    // across scripts and keyboard layouts by one set of rules the API and the
    // palette share (`packages/contracts/schemas/name_search.ts`).
    id: "search",
    unit: {
      tests: [
        "packages/backend/read-models/search/application/search_workspace_test.ts",
        "packages/backend/modules/people/transport/http/search_test.ts",
        "packages/contracts/name_search_test.ts",
      ],
      permissions: { read: ["packages/contracts"] },
    },
    contract: [
      "packages/backend/modules/people/transport/http/search_test.ts",
    ],
    integration: ["tests/integration/search_postgres_test.ts"],
    coverage: {
      directory: "search",
      postgres: true,
      permissions: {
        read: [...SCHEMA_READS, "packages/contracts"],
        env: [...APPLICATION_DATABASE_ENV, ...FIXTURE_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "packages/backend/read-models/search/application/search_workspace_test.ts",
        "packages/backend/modules/people/transport/http/search_test.ts",
        "packages/contracts/name_search_test.ts",
        "packages/backend/platform/postgres/name_match_test.ts",
        "tests/integration/search_postgres_test.ts",
      ],
      include: [
        "packages/backend/read-models/search/application",
        "packages/backend/read-models/search/adapters",
        "packages/backend/modules/people/transport/http/search.ts",
        "packages/contracts/schemas/name_search.ts",
        "packages/backend/platform/postgres/name_match.ts",
      ],
    },
  },
  {
    // The calendar feed (GAP-052, `INTEGRATION-002`): the `calendar-feed` read
    // model, the integrations use case and route that publish it as
    // iCalendar, and the PostgreSQL suite that drives the whole subscription
    // through the configured API. Its visibility rules exist only in SQL, so
    // the set measures the PostgreSQL suite beside the unit ones.
    id: "calendar-feed",
    unit: {
      tests: [
        "packages/backend/read-models/calendar-feed/application/read_calendar_feed_test.ts",
        "packages/backend/modules/integrations/application/calendar_feed_test.ts",
        "packages/backend/modules/integrations/transport/http/calendar_feed_test.ts",
      ],
    },
    integration: ["tests/integration/calendar_feed_postgres_test.ts"],
    coverage: {
      directory: "calendar-feed",
      postgres: true,
      permissions: { env: "all", net: "all" },
      tests: [
        "packages/backend/read-models/calendar-feed/application/read_calendar_feed_test.ts",
        "packages/backend/modules/integrations/application/calendar_feed_test.ts",
        "packages/backend/modules/integrations/transport/http/calendar_feed_test.ts",
        "packages/backend/modules/integrations/domain/ical_test.ts",
        "tests/integration/calendar_feed_postgres_test.ts",
      ],
      include: [
        "packages/backend/read-models/calendar-feed/application",
        "packages/backend/read-models/calendar-feed/adapters",
        "packages/backend/modules/integrations/application/calendar_feed.ts",
        "packages/backend/modules/integrations/transport/http/calendar_feed.ts",
        "packages/backend/modules/integrations/domain/ical.ts",
        "packages/backend/modules/integrations/domain/calendar_feed_rules.ts",
      ],
    },
  },
  {
    // The member's notification feed (GAP-053, `TODAY-002`): the
    // `notifications` read model and the route planning serves it on. Its
    // scoping exists only in SQL, so the set measures the PostgreSQL suite
    // beside the unit ones.
    id: "notifications",
    unit: {
      tests: [
        "packages/backend/read-models/notifications/application/list_notifications_test.ts",
        "packages/backend/modules/planning/transport/http/notifications_test.ts",
      ],
      permissions: { read: ["packages/contracts"] },
    },
    contract: [
      "packages/backend/modules/planning/transport/http/notifications_test.ts",
    ],
    integration: ["tests/integration/notifications_postgres_test.ts"],
    coverage: {
      directory: "notifications",
      postgres: true,
      permissions: {
        read: [...SCHEMA_READS, "packages/contracts"],
        env: [...APPLICATION_DATABASE_ENV, ...FIXTURE_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "packages/backend/read-models/notifications/application/list_notifications_test.ts",
        "packages/backend/modules/planning/transport/http/notifications_test.ts",
        "tests/integration/notifications_postgres_test.ts",
      ],
      include: [
        "packages/backend/read-models/notifications/application",
        "packages/backend/read-models/notifications/adapters",
        "packages/backend/modules/planning/transport/http/notifications.ts",
      ],
    },
  },
  {
    id: "imports",
    unit: {
      tests: [
        "packages/backend/modules/import-export/transport/http/imports_test.ts",
        "packages/backend/modules/import-export/application/import_management_test.ts",
        "packages/backend/modules/import-export/application/business_import_test.ts",
        "packages/backend/modules/import-export/application/contact_import_management_test.ts",
        "tools/architecture/APP-009A/import_ownership_boundary_test.ts",
      ],
      permissions: {
        read: [
          "packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
          ...OWNERSHIP_BOUNDARY_READS,
        ],
      },
    },
    integration: [
      "tests/integration/import_postgres_test.ts",
      "tests/integration/import_extra_postgres_test.ts",
      "tests/integration/import_business_postgres_test.ts",
      "tests/integration/contact_import_postgres_test.ts",
    ],
    coverage: {
      directory: "imports",
      permissions: {
        read: [
          "packages/backend/modules/import-export/adapters/postgres/import_repository.ts",
          ...OWNERSHIP_BOUNDARY_READS,
          "packages/backend/modules/import-export/domain/formats/fixtures",
        ],
      },
      tests: [
        "packages/backend/modules/import-export/transport/http/imports_test.ts",
        "packages/backend/modules/import-export/domain/formats/canonical_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_sql_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_business_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_contact_types_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_catalog_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_extra_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_audit_test.ts",
        "packages/backend/modules/import-export/domain/business_entities_test.ts",
        "packages/backend/modules/import-export/domain/formats/contact_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/csv_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_parse_test.ts",
        "packages/backend/modules/import-export/domain/contact_import_test.ts",
        "packages/backend/modules/import-export/domain/contact_type_mapping_test.ts",
        "packages/backend/modules/import-export/domain/monica_choices_test.ts",
        "packages/backend/modules/import-export/domain/import_rules_test.ts",
        "packages/backend/modules/import-export/application/import_management_test.ts",
        "packages/backend/modules/import-export/application/business_import_test.ts",
        "packages/backend/modules/import-export/application/contact_import_management_test.ts",
        "tools/architecture/APP-009A/import_ownership_boundary_test.ts",
      ],
      include: [
        "packages/backend/modules/import-export/transport/http/imports.ts",
        // The source profile and the staging rules the use case delegates to.
        // The whole domain has its own set at the shared kernel's bar; this
        // one measures the import half beside the HTTP surface that uses it.
        "packages/backend/modules/import-export/domain/formats/canonical.ts",
        "packages/backend/modules/import-export/domain/formats/monica_source.ts",
        "packages/backend/modules/import-export/domain/formats/monica_sql.ts",
        "packages/backend/modules/import-export/domain/formats/monica_business.ts",
        "packages/backend/modules/import-export/domain/formats/monica_contact_types.ts",
        "packages/backend/modules/import-export/domain/formats/monica_extra.ts",
        "packages/backend/modules/import-export/domain/formats/monica_audit.ts",
        "packages/backend/modules/import-export/domain/formats/monica_emotions.ts",
        "packages/backend/modules/import-export/domain/business_entities.ts",
        "packages/backend/modules/import-export/application/business_import.ts",
        "packages/backend/modules/import-export/domain/formats/monica_details.ts",
        // The vCard and CSV sources beside it (GAP-050).
        "packages/backend/modules/import-export/domain/formats/contact_source.ts",
        "packages/backend/modules/import-export/domain/formats/csv.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_parse.ts",
        "packages/backend/modules/import-export/domain/contact_import.ts",
        "packages/backend/modules/import-export/domain/contact_type_mapping.ts",
        "packages/backend/modules/import-export/domain/monica_choices.ts",
        "packages/backend/modules/import-export/domain/import_rules.ts",
        "packages/backend/modules/import-export/application/contact_staging.ts",
        "packages/backend/modules/import-export/application/import_management.ts",
        "packages/backend/modules/import-export/application/import_commit.ts",
        "packages/backend/modules/import-export/application/import_context.ts",
        "packages/backend/modules/import-export/application/import_reads.ts",
        "packages/backend/modules/import-export/application/import_staging.ts",
      ],
    },
  },
  {
    id: "exports",
    unit: {
      tests: [
        "packages/backend/modules/import-export/transport/http/exports_test.ts",
        "packages/backend/modules/import-export/application/export_management_test.ts",
      ],
    },
    contract: [
      "packages/backend/modules/import-export/transport/http/exports_test.ts",
    ],
    integration: [
      "tests/integration/export_postgres_test.ts",
      "tests/integration/contact_export_postgres_test.ts",
    ],
    coverage: {
      directory: "exports",
      tests: [
        "packages/backend/modules/import-export/transport/http/exports_test.ts",
        "packages/backend/modules/import-export/domain/export_rules_test.ts",
        "packages/backend/modules/import-export/domain/formats/portable_json_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_test.ts",
        "packages/backend/modules/import-export/domain/formats/contacts_export_test.ts",
        "packages/backend/modules/import-export/domain/formats/zip_test.ts",
        "packages/backend/modules/import-export/application/export_management_test.ts",
      ],
      include: [
        "packages/backend/modules/import-export/transport/http/exports.ts",
        // The two output formats and the export records. `formats/canonical.ts`
        // is measured by the `imports` set, and the whole domain has its own
        // set at the shared kernel's bar.
        "packages/backend/modules/import-export/domain/export_rules.ts",
        "packages/backend/modules/import-export/domain/formats/portable_json.ts",
        "packages/backend/modules/import-export/domain/formats/vcard.ts",
        // The CSV archive and all-people vCard formats (GAP-050).
        "packages/backend/modules/import-export/domain/formats/contacts_export.ts",
        "packages/backend/modules/import-export/domain/formats/zip.ts",
        "packages/backend/modules/import-export/application/export_management.ts",
        "packages/backend/modules/import-export/application/export_artifact.ts",
        "packages/backend/modules/import-export/application/export_context.ts",
        "packages/backend/modules/import-export/application/export_downloads.ts",
      ],
    },
  },
  {
    // The import-export domain is where the ticket's named work landed: the
    // Monica JSON source profile, the portable JSON and vCard export formats,
    // the canonical rendering both halves sign their work with, and the
    // staging and acceptance rules around them. GAP-050 adds vCard and CSV
    // siblings under `domain/formats/`, so this set is declared to measure the
    // whole directory rather than a list of files, and the two use-case suites
    // keep their homes in `imports` and `exports`.
    id: "import-export",
    unit: {
      tests: [
        "packages/backend/modules/import-export/domain/export_rules_test.ts",
        "packages/backend/modules/import-export/domain/formats/canonical_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_sql_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_business_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_contact_types_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_catalog_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_extra_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_audit_test.ts",
        "packages/backend/modules/import-export/domain/business_entities_test.ts",
        "packages/backend/modules/import-export/domain/formats/portable_json_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_test.ts",
        "packages/backend/modules/import-export/domain/import_rules_test.ts",
        "packages/backend/modules/import-export/domain/contact_import_test.ts",
        "packages/backend/modules/import-export/domain/contact_type_mapping_test.ts",
        "packages/backend/modules/import-export/domain/monica_choices_test.ts",
        "packages/backend/modules/import-export/domain/formats/contact_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/contacts_export_test.ts",
        "packages/backend/modules/import-export/domain/formats/csv_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_parse_test.ts",
        "packages/backend/modules/import-export/domain/formats/zip_test.ts",
      ],
      // The vCard and CSV parser suites read their fixture files (GAP-050).
      permissions: {
        read: [
          "packages/backend/modules/import-export/domain/formats/fixtures",
        ],
      },
    },
    coverage: {
      directory: "import-export-domain",
      threshold: 95,
      permissions: {
        read: [
          "packages/backend/modules/import-export/domain/formats/fixtures",
        ],
      },
      tests: [
        "packages/backend/modules/import-export/domain/export_rules_test.ts",
        "packages/backend/modules/import-export/domain/formats/canonical_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_sql_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_business_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_contact_types_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_catalog_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_extra_test.ts",
        "packages/backend/modules/import-export/domain/formats/monica_audit_test.ts",
        "packages/backend/modules/import-export/domain/business_entities_test.ts",
        "packages/backend/modules/import-export/domain/formats/portable_json_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_test.ts",
        "packages/backend/modules/import-export/domain/import_rules_test.ts",
        "packages/backend/modules/import-export/domain/contact_import_test.ts",
        "packages/backend/modules/import-export/domain/contact_type_mapping_test.ts",
        "packages/backend/modules/import-export/domain/monica_choices_test.ts",
        "packages/backend/modules/import-export/domain/formats/contact_source_test.ts",
        "packages/backend/modules/import-export/domain/formats/contacts_export_test.ts",
        "packages/backend/modules/import-export/domain/formats/csv_test.ts",
        "packages/backend/modules/import-export/domain/formats/vcard_parse_test.ts",
        "packages/backend/modules/import-export/domain/formats/zip_test.ts",
      ],
      include: ["packages/backend/modules/import-export/domain"],
    },
  },
  {
    id: "lifecycle",
    unit: {
      tests: [
        "packages/backend/modules/workspaces/transport/http/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/application/personal_lifecycle_test.ts",
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
        env: [...APPLICATION_DATABASE_ENV, ...FIXTURE_DATABASE_ENV],
        net: "all",
      },
      tests: [
        "packages/backend/modules/workspaces/transport/http/personal_lifecycle_test.ts",
        "packages/backend/modules/workspaces/domain/personal_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/application/personal_lifecycle_test.ts",
        "packages/contracts/personal_lifecycle_test.ts",
        "tests/integration/personal_lifecycle_postgres_test.ts",
      ],
      include: [
        "packages/backend/modules/workspaces/transport/http/personal_lifecycle.ts",
        "packages/backend/modules/identity/adapters/postgres/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/application/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/domain/personal_lifecycle_rules.ts",
        "packages/backend/modules/workspaces/adapters/postgres/personal_lifecycle.ts",
        "packages/backend/modules/workspaces/application/audit_events.ts",
      ],
    },
  },
  {
    id: "workspace-lifecycle",
    unit: {
      tests: [
        "packages/backend/modules/workspaces/transport/http/workspace_lifecycle_test.ts",
        "packages/backend/modules/workspaces/application/workspace_lifecycle_test.ts",
        "packages/contracts/workspace_lifecycle_test.ts",
      ],
      permissions: { env: "all", net: "all" },
    },
    integration: [
      "tests/integration/workspace_lifecycle_impact_postgres_test.ts",
      "tests/integration/workspace_lifecycle_erasure_postgres_test.ts",
    ],
    coverage: {
      directory: "workspace-lifecycle",
      permissions: { env: "all", net: "all" },
      tests: [
        "packages/backend/modules/workspaces/transport/http/workspace_lifecycle_test.ts",
        "apps/worker/composition_test.ts",
        "apps/worker/main_test.ts",
        "packages/backend/modules/workspaces/domain/workspace_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/application/workspace_lifecycle_test.ts",
        "packages/contracts/workspace_lifecycle_test.ts",
      ],
      include: [
        "packages/backend/modules/workspaces/transport/http/workspace_lifecycle.ts",
        // The worker is one deployable: its entry point and composition belong
        // to the same measured surface, so no worker file escapes coverage.
        "apps/worker",
        "packages/backend/modules/workspaces/application/workspace_lifecycle.ts",
        "packages/backend/modules/workspaces/application/workspace_lifecycle_context.ts",
        "packages/backend/modules/workspaces/domain/workspace_lifecycle_rules.ts",
      ],
    },
  },
  {
    // The identity domain is deliberately small, and the file says why: almost
    // everything identity knows is enforced by a unique index or by a
    // cryptographic adapter, and a second opinion about a credential is a way
    // to be wrong. What is here — what a conflict is called, how long a reset
    // link lives, and the constant-time window that stops the request endpoint
    // revealing whether an address is registered — is measured at the bar the
    // shared kernel keeps, and the module's two suites, which used to live in
    // the `api` unit set, live here too so each has exactly one unit home.
    id: "identity",
    unit: {
      tests: [
        "packages/backend/modules/identity/domain/identity_rules_test.ts",
        "packages/backend/modules/identity/adapters/crypto/argon2id_test.ts",
        "packages/backend/modules/identity/adapters/crypto/totp_test.ts",
        "packages/backend/modules/identity/adapters/postgres/authentication_test.ts",
        "packages/backend/modules/identity/application/password_recovery_test.ts",
        // Retention (AUD-A2).
        "packages/backend/modules/identity/application/authentication_retention_test.ts",
      ],
    },
    // Registration and verification are identity's PostgreSQL boundary: the
    // pending identity, the registrant verifier, and the takeover sequences
    // the 2026-11-07 audit replayed (AUD-A1).
    integration: [
      "tests/integration/registration_postgres_test.ts",
      "tests/integration/registration_takeover_postgres_test.ts",
      // SECA-03 (AUD-M3): the per-address registration and reset ceilings.
      "tests/integration/registration_mail_ceiling_postgres_test.ts",
      // SECA-04 (AUD-A2): provisioning at verification, and the purge.
      "tests/integration/authentication_retention_postgres_test.ts",
      // SECA-06 (AUD-A4): the MFA challenge is a durable session row.
      "tests/integration/mfa_challenge_postgres_test.ts",
      // SECA-07, SECA-09, SECT-06 (AUD-K4): the session cookie and sign-out.
      "tests/integration/session_cookie_postgres_test.ts",
    ],
    coverage: {
      directory: "identity-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/identity/domain/identity_rules_test.ts",
      ],
      include: ["packages/backend/modules/identity/domain"],
    },
  },
  {
    // The workspaces domain is the largest in the repository, because this is
    // the module that decides who anybody is: the three roles, how a sign-in
    // ends and what that means to the throttle, what a new workspace starts
    // with, what an invitation and a member list are, what may be
    // personalized, what destroying a workspace would cost and how that is
    // proved not to have changed, what stops somebody leaving, and how a
    // member's own interface state is read back defensively. It is measured on
    // its own at the bar the shared kernel keeps, and the module's eight
    // suites, which used to live in the `api` unit set, live here too so each
    // has exactly one unit home. `personal_lifecycle_test.ts` and
    // `workspace_lifecycle_test.ts` keep theirs in `lifecycle` and
    // `workspace-lifecycle`.
    id: "workspaces",
    unit: {
      tests: [
        "packages/backend/modules/workspaces/adapters/mail/smtp_verification_mail_test.ts",
        "packages/backend/modules/workspaces/adapters/mail/smtp_reminder_mail_test.ts",
        "packages/backend/modules/workspaces/application/member_ui_state_test.ts",
        "packages/backend/modules/workspaces/application/actor_admission_test.ts",
        "packages/backend/modules/workspaces/domain/invitation_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personal_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personalization_rules_test.ts",
        "packages/backend/modules/workspaces/domain/registration_rules_test.ts",
        "packages/backend/modules/workspaces/domain/roles_test.ts",
        "packages/backend/modules/workspaces/domain/session_rules_test.ts",
        "packages/backend/modules/workspaces/domain/settings_rules_test.ts",
        "packages/backend/modules/workspaces/domain/ui_state_rules_test.ts",
        "packages/backend/modules/workspaces/domain/workspace_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/application/invite_member_test.ts",
        "packages/backend/modules/workspaces/application/personalization_test.ts",
        "packages/backend/modules/workspaces/application/protected_session_test.ts",
        "packages/backend/modules/workspaces/application/recent_people_test.ts",
        "packages/backend/modules/workspaces/application/register_first_workspace_test.ts",
        "packages/backend/modules/workspaces/application/registration_retention_test.ts",
        "packages/backend/modules/workspaces/application/settings_management_test.ts",
      ],
      permissions: {
        // Two suites read an adapter back to prove it does not reach into
        // another module's tables, and the SMTP suite runs its transport
        // against a loopback server it starts itself.
        read: ["packages/backend/modules/workspaces/adapters"],
        net: ["127.0.0.1"],
      },
    },
    integration: [
      "tests/integration/invitation_postgres_test.ts",
      // SECA-03 (AUD-M3): the invitation quota, recipient cap, and inviter age.
      "tests/integration/invitation_mail_relay_postgres_test.ts",
    ],
    coverage: {
      directory: "workspaces-domain",
      threshold: 95,
      tests: [
        "packages/backend/modules/workspaces/domain/invitation_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personal_lifecycle_rules_test.ts",
        "packages/backend/modules/workspaces/domain/personalization_rules_test.ts",
        "packages/backend/modules/workspaces/domain/registration_rules_test.ts",
        "packages/backend/modules/workspaces/domain/roles_test.ts",
        "packages/backend/modules/workspaces/domain/session_rules_test.ts",
        "packages/backend/modules/workspaces/domain/settings_rules_test.ts",
        "packages/backend/modules/workspaces/domain/ui_state_rules_test.ts",
        "packages/backend/modules/workspaces/domain/workspace_lifecycle_rules_test.ts",
      ],
      include: ["packages/backend/modules/workspaces/domain"],
    },
  },
  {
    id: "contracts-build",
    unit: {
      tests: [
        "tools/contracts/api_reference_test.ts",
        "tools/contracts/tool_catalog_test.ts",
      ],
      // Same permissions as contracts:check: debug enumerates process.env and
      // Redocly discovers local configuration. Keep these out of API unit tests.
      permissions: { env: "all", read: "all" },
    },
    contract: ["tools/contracts/api_reference_test.ts"],
    coverage: {
      directory: "contracts-build",
      tests: [
        "tools/contracts/api_reference_test.ts",
        "tools/contracts/tool_catalog_test.ts",
      ],
      include: [
        "tools/contracts/external.ts",
        "tools/contracts/tool_catalog.ts",
      ],
      permissions: { env: "all", read: "all" },
    },
  },
  {
    id: "web",
    unit: { runner: "vitest", tests: WEB_TESTS },
    coverage: {
      runner: "vitest",
      directory: "web",
      tests: WEB_TESTS,
      // The vanilla modules, the feature registries and shared parts they
      // and the islands read (GAP-028), the React islands with their kit
      // (ADR 0006), and the vendored shadcn/ui components they render.
      include: [
        "apps/web/src/lib/*.ts",
        "apps/web/src/features/**/*.ts",
        "apps/web/src/features/**/*.tsx",
        "apps/web/src/islands/**/*.ts",
        "apps/web/src/islands/**/*.tsx",
        "apps/web/src/components/ui/*.ts",
        "apps/web/src/components/ui/*.tsx",
        "apps/web/src/pages/docs/api/openapi.json.ts",
      ],
    },
  },
  {
    id: "gateway",
    unit: {
      tests: ["tools/gateway_log_capture_test.ts"],
      permissions: {
        read: ["gateway/nginx.conf", "gateway/security_headers.conf"],
        // The run-scoped TLS material the gateway mounts (`e2e_tls.ts`).
        write: [".tls/e2e"],
        net: ["127.0.0.1"],
        run: ["docker"],
      },
    },
  },
  {
    id: "tasks",
    unit: {
      tests: [
        "tools/tasks/manifest_test.ts",
        "tools/pipeline_contract_test.ts",
        "tools/source_hygiene_test.ts",
        // MCP-R3: no production UUID check narrows the accepted versions.
        "tools/uuid_version_contract_test.ts",
        "tools/architecture/check_boundaries_test.ts",
        "tools/product/flow_traceability_test.ts",
      ],
      permissions: {
        read: [
          ".github",
          ".tool-versions",
          "Dockerfile.api",
          "Dockerfile.web",
          "deno.json",
          "lefthook.yml",
          "package.json",
          "pnpm-workspace.yaml",
          "vitest.config.ts",
          "compose.yaml",
          "docs/architecture",
          "docs/planning/private-production-profile.json",
          "docs/product/user-flows.yaml",
          "personal-crm-schema/v10",
          "personal-crm-schema/v11",
          "personal-crm-schema/v12",
          "personal-crm-schema/v13",
          "personal-crm-schema/v14",
          "personal-crm-schema/v15",
          "personal-crm-schema/v16",
          "apps",
          "packages",
          "tools",
          "tests",
          "gateway",
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
          "tests/e2e/perf.PERF-001.spec.ts",
          "tests/integration/planning_delivery_postgres_test.ts",
          "packages/backend/modules/people/transport/http/directory_test.ts",
          "packages/backend/read-models/people-directory/application/list_people_test.ts",
          "tests/integration/people_directory_capacity_postgres_test.ts",
          "packages/backend/modules/import-export/application/import_management_test.ts",
          "packages/backend/modules/import-export/application/business_import_test.ts",
          "packages/backend/modules/import-export/application/export_management_test.ts",
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
        "tools/operations/dokploy_preflight_test.ts",
        "tools/operations/dokploy_storage_init_test.ts",
      ],
      permissions: {
        read: [
          "docs/planning/private-production-profile.json",
          "docs/planning/mvp-capacity-profile.json",
          "gateway/nginx.conf",
          ".artifacts/private-production-recovery",
        ],
        write: [".artifacts/private-production-recovery"],
        // The recovery client's isolation test talks to a loopback store.
        net: ["127.0.0.1"],
      },
    },
  },
  {
    id: "operations-compose",
    unit: {
      tests: [
        "tools/operations/private_production_compose_test.ts",
        "tools/operations/dokploy_compose_test.ts",
        "tools/operations/object_storage_compose_test.ts",
      ],
      permissions: { run: ["docker"], read: ["gateway", "Dockerfile.web"] },
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
        env: ["DATABASE_URL", ...POSTGRES_ENV],
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
    id: "web-build",
    onDemand: {
      reason:
        "GAP-026, GAP-027, and GAP-028 prove what `astro build` ships to the browser — public pages load no React, the palette's and the person page's islands' hydrated bytes, each page's modulepreload links (FER-02), and the Tailwind utilities the variants compile to — so it reads apps/web/dist and can only run after a build. The `build` verb runs it right after `astro build`.",
    },
    unit: {
      tests: ["tools/web_build_output_test.ts"],
      permissions: {
        read: [
          "apps/web/dist/client",
          "apps/web/dist/server",
          "apps/web/src/styles",
          "gateway/security_headers.conf",
          // The MCP guide renders one entry per catalog tool (MCP-C3).
          "packages/contracts/mcp/tools.json",
        ],
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
  "contracts-build",
  "shared-kernel",
  "people",
  "api",
  "api-access",
  "mcp",
  "integrations",
  "planning",
  "relationships",
  "interactions",
  "governance",
  "gifts",
  "journal",
  "search",
  "calendar-feed",
  "notifications",
  "imports",
  "exports",
  "import-export",
  "lifecycle",
  "workspace-lifecycle",
  "identity",
  "workspaces",
  "files",
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
  "contracts-build",
  "shared-kernel",
  "people",
  "api",
  "api-access",
  "api-access-domain",
  "mcp",
  "integrations",
  "integrations-domain",
  "planning",
  "planning-domain",
  "relationships",
  "interactions",
  "governance",
  "governance-domain",
  "gifts",
  "gifts-domain",
  "files",
  "storage",
  "journal",
  "journal-domain",
  "search",
  "calendar-feed",
  "notifications",
  "imports",
  "exports",
  "import-export",
  "identity",
  "workspaces",
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

/**
 * The environment names the S3 SDK (`@aws-sdk/client-s3`) reads however it is
 * configured: two Lambda probes in `@aws/lambda-invoke-store` when it loads,
 * and its Node-version warning switch whenever it builds a client. A process
 * that loads the SDK ignores exactly these, so they read as unset; none is
 * granted (MCP-E4). The API and worker commands carry the same list.
 */
export const OBJECT_STORAGE_SDK_IGNORED_ENV = [
  "AWS_LAMBDA_BENCHMARK_MODE",
  "AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA",
  "AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED",
] as const;

function scopeFlag(name: string, scope: PermissionScope | undefined): string[] {
  if (scope === undefined) return [];
  if (scope === "all") return [`--allow-${name}`];
  if (scope.length === 0) return [];
  return [`--allow-${name}=${scope.join(",")}`];
}

/**
 * Renders a permission set as Deno command-line flags. Any Deno set may load
 * the S3 SDK through a composition root, and ignoring a name grants nothing,
 * so every set ignores the SDK's unconditional probes alike.
 */
export function permissionFlags(permissions: Permissions = {}): string[] {
  return [
    ...scopeFlag("read", permissions.read),
    ...scopeFlag("write", permissions.write),
    ...scopeFlag("env", permissions.env),
    `--ignore-env=${OBJECT_STORAGE_SDK_IGNORED_ENV.join(",")}`,
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
        entry.name.endsWith("_test.ts") || entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test.tsx")
      ) {
        found.push(path);
      }
    }
  }
  for (const base of ["apps", "packages", "tools", "tests"]) await walk(base);
  return found.sort();
}

/**
 * The web suites' shared scaffolding (GAP-030): renderers, the `fetch` stub,
 * fixtures, and the axe helper. Like a `.test-helper.ts`, it is neither
 * production nor a suite, so no coverage set measures it.
 */
export const WEB_TEST_SUPPORT = "apps/web/src/testing";

/**
 * Walks the repository for every production TypeScript module, the React
 * islands' `.tsx` included.
 */
export async function listProductionFiles(root: URL): Promise<string[]> {
  const ignored = IGNORED_DIRECTORIES;
  const found: string[] = [];
  async function walk(relative: string): Promise<void> {
    for await (const entry of Deno.readDir(new URL(relative, root))) {
      if (ignored.has(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory) {
        if (path !== WEB_TEST_SUPPORT) await walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) {
        continue;
      }
      if (entry.name.endsWith(".d.ts")) continue;
      if (
        entry.name.endsWith("_test.ts") || entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test.tsx")
      ) {
        continue;
      }
      if (entry.name.endsWith(".test-helper.ts")) continue;
      found.push(path);
    }
  }
  for (const base of ["apps", "packages"]) await walk(base);
  return found.sort();
}

/**
 * A suite placed directly at a backend unit root: a module's or a read
 * model's own folder.
 */
const BACKEND_UNIT_ROOT =
  /^packages\/backend\/(?:modules|read-models)\/[^/]+\/[^/]+_test\.ts$/;

/**
 * Backend unit suites placed at a module or read-model root (GAP-034). A unit
 * suite sits next to the file it exercises — `application/x.ts` beside
 * `application/x_test.ts`, `domain/x.ts` beside `domain/x_test.ts` — and no
 * suite sits at a unit root.
 */
export function misplacedBackendTests(tests: readonly string[]): string[] {
  return tests.filter((test) => BACKEND_UNIT_ROOT.test(test));
}
