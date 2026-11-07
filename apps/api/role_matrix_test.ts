/**
 * The authorization matrix, executed (AUD-K5, SECT-08).
 *
 * `docs/architecture/authorization-matrix.yaml` says which roles hold each
 * permission, and `packages/contracts/routes/permissions.ts` says which
 * permission each route exercises. This suite reads both and probes every
 * route of every role-granted permission as an owner, an admin, and a plain
 * member, against the real use cases: `composeApiServices` composes every
 * module exactly as the deployment does, over a database that refuses every
 * connection. Only the session and the legal guard are stood in for, so the
 * request arrives as the role being probed with nothing outstanding.
 *
 * A role the matrix denies must be refused with 403 before any of its work
 * reaches the database. A role the matrix grants must not be refused: its
 * request goes on to the database, which is unavailable, and it answers
 * whatever an outage or a missing record answers — anything but 403. A use
 * case that decides a role only after it has read something would answer a
 * denied role with the outage instead, and fails here as drift: the role
 * decision belongs in front of the first read, where a stale membership
 * cannot be what lets a request through.
 */

import { parse as parseYaml } from "@std/yaml";
import {
  type DatabaseConnection,
  type Driver,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import {
  type ApiServices,
  CapturedVerificationMail,
  composeApiServices,
  createApiApp,
} from "./composition.ts";
import { SAMPLE_ORIGIN, sampleRequest } from "./route_probe.test-helper.ts";
import { API_ROUTES } from "../../packages/contracts/routes/mod.ts";
import {
  PERMISSION_IDS,
  type PermissionId,
  ROUTE_PERMISSIONS,
} from "../../packages/contracts/routes/permissions.ts";
import type { ApplicationDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { fakeObjectStore } from "../../packages/backend/testing/fakes.ts";
import { sessionActor } from "../../packages/backend/testing/fixtures.ts";

const ROLES = ["owner", "admin", "member"] as const;
type Role = typeof ROLES[number];

/** One permission as the matrix states it. */
interface MatrixPermission {
  readonly id: string;
  readonly roles?: readonly Role[];
  readonly principals?: readonly string[];
}

const MATRIX = parseYaml(
  await Deno.readTextFile(
    new URL(
      "../../docs/architecture/authorization-matrix.yaml",
      import.meta.url,
    ),
  ),
) as { readonly permissions: readonly MatrixPermission[] };

/**
 * Role-granted permissions no route exercises yet, and why. Each is a gap the
 * matrix states on purpose; a permission that gains a route leaves this list.
 */
const UNROUTED: Readonly<Record<string, string>> = {
  "billing.manage": "the optional billing module has no route yet",
};

/**
 * Routes whose refusal is itself written to the audit trail, in the same
 * transaction as the decision: without a database the refusal is an outage.
 * These are probed over a database that accepts every statement and finds
 * nothing instead, so the refusal can be recorded and answered.
 */
const AUDITED_REFUSALS: Readonly<Record<string, string>> = {
  deleteWorkspace: "an attempted workspace delete is audited, refused or not",
  resetWorkspace: "an attempted workspace reset is audited, refused or not",
};

/** A database that accepts every statement and finds nothing. */
function emptyDatabase(): Kysely<ApplicationDatabase> {
  return new Kysely<ApplicationDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

/** A database that answers every connection with a refusal. */
function unavailableDatabase(): Kysely<ApplicationDatabase> {
  const refused = () =>
    Promise.reject(new Error("the role table has no database"));
  const driver: Driver = {
    acquireConnection: refused as () => Promise<DatabaseConnection>,
    beginTransaction: refused,
    commitTransaction: refused,
    destroy: () => Promise.resolve(),
    init: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    rollbackTransaction: refused,
  };
  return new Kysely<ApplicationDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

/** A local keyset of one repeated byte. */
function keyset(fill: number) {
  return {
    activeKeyId: "role-table",
    keys: new Map([["role-table", new Uint8Array(32).fill(fill)]]),
  };
}

/**
 * The deployment's services, with a session that is whichever role the
 * cookie names and a legal guard with nothing outstanding.
 */
function roleServices(database: Kysely<ApplicationDatabase>): ApiServices {
  const services = composeApiServices(database, {
    davEnabled: true,
    davKeyset: keyset(0x69),
    mail: new CapturedVerificationMail(),
    mfaKeyset: keyset(0x4b),
    objectStore: fakeObjectStore(),
    policy: { origin: SAMPLE_ORIGIN, secureCookie: false },
    subjectKeyset: {
      activeVersion: 1,
      keys: new Map([[1, new Uint8Array(32).fill(0x52)]]),
    },
  });
  const sessions = services.protectedSessions;
  const legal = services.legal;
  assert(sessions !== undefined && legal !== undefined, "composed in full");
  return {
    ...services,
    legal: {
      ...legal,
      requirements: () => Promise.resolve({ documents: [], status: "ready" }),
    } as typeof legal,
    protectedSessions: {
      ...sessions,
      resolve: (command: { readonly sessionToken: string }) =>
        Promise.resolve(
          sessionActor({ role: command.sessionToken as Role }),
        ),
    } as typeof sessions,
  };
}

/** Whether this role's request for this route was refused for its role. */
type Probe = (operationId: string, role: Role) => Promise<boolean>;

/**
 * The probe the suite runs: every route over the unavailable database, apart
 * from the audited refusals, which run over the empty one.
 */
function probe(): Probe {
  const unavailable = createApiApp(roleServices(unavailableDatabase()));
  const empty = createApiApp(roleServices(emptyDatabase()));
  const routes = new Map(API_ROUTES.map((route) => [route.operationId, route]));
  return async (operationId, role) => {
    const route = routes.get(operationId);
    assert(route !== undefined, `${operationId} is not a registered route`);
    const { path, init } = sampleRequest(route);
    const app = operationId in AUDITED_REFUSALS ? empty : unavailable;
    const response = await app.request(path, {
      ...init,
      headers: { ...init.headers, Cookie: `kinship_session=${role}` },
    });
    await response.body?.cancel();
    return response.status === 403;
  };
}

/**
 * Every disagreement between the matrix and the running app, as
 * `permission operationId role: matrix grants|denies, app allows|refuses`.
 */
async function roleDrift(
  permissions: readonly MatrixPermission[],
  probe: Probe,
): Promise<readonly string[]> {
  const drift: string[] = [];
  for (const permission of permissions) {
    if (!permission.roles) continue;
    const routes = Object.entries(ROUTE_PERMISSIONS)
      .filter(([, granted]) => granted === permission.id)
      .map(([operationId]) => operationId);
    if (routes.length === 0 && !(permission.id in UNROUTED)) {
      drift.push(`${permission.id}: no route exercises it`);
    }
    for (const operationId of routes) {
      for (const role of ROLES) {
        const granted = permission.roles.includes(role);
        const refused = await probe(operationId, role);
        if (granted === refused) {
          drift.push(
            `${permission.id} ${operationId} ${role}: matrix ${
              granted ? "grants" : "denies"
            }, app ${refused ? "refuses" : "allows"}`,
          );
        }
      }
    }
  }
  return drift;
}

Deno.test("[AUD-K5] the permission table maps every route to one permission of the matrix", () => {
  const matrixIds = MATRIX.permissions.map((permission) => permission.id);
  assert(
    JSON.stringify(matrixIds) === JSON.stringify(PERMISSION_IDS),
    `the table's permission ids must be the matrix's: ${matrixIds.join(", ")}`,
  );

  const registered = API_ROUTES.map((route) => route.operationId).sort();
  const mapped = Object.keys(ROUTE_PERMISSIONS).sort();
  assert(
    JSON.stringify(registered) === JSON.stringify(mapped),
    `unmapped: ${
      registered.filter((id) => !mapped.includes(id)).join(", ")
    }; unregistered: ${
      mapped.filter((id) => !registered.includes(id)).join(", ")
    }`,
  );

  for (const route of API_ROUTES) {
    const permission = ROUTE_PERMISSIONS[route.operationId];
    assert(
      route.security === undefined || permission !== "public",
      `${route.operationId} has a security requirement and cannot be public`,
    );
  }
  for (const [id, reason] of Object.entries(UNROUTED)) {
    assert(
      PERMISSION_IDS.includes(id as PermissionId) &&
        !Object.values(ROUTE_PERMISSIONS).includes(id as PermissionId),
      `${id} (${reason}) must be a matrix permission no route exercises`,
    );
  }
});

Deno.test("[AUD-K5] every route answers owner, admin, and member as the matrix says", async () => {
  const drift = await roleDrift(MATRIX.permissions, probe());
  assert(
    drift.length === 0,
    `the app and the authorization matrix disagree:\n${drift.join("\n")}`,
  );
});

Deno.test("[AUD-K5] the role table fails on a seeded mismatch", async () => {
  const seeded = MATRIX.permissions
    .filter((permission) =>
      permission.id === "data.export" || permission.id === "people.delete"
    )
    .map((permission) =>
      permission.id === "data.export"
        ? { ...permission, roles: ["owner", "admin", "member"] as const }
        : { ...permission, roles: ["owner"] as const }
    );

  const drift = await roleDrift(seeded, probe());
  assert(
    JSON.stringify(drift) ===
      JSON.stringify([
        "people.delete deletePerson admin: matrix denies, app allows",
        "people.delete deletePerson member: matrix denies, app allows",
        "data.export listExports member: matrix grants, app refuses",
        "data.export createWorkspaceExport member: matrix grants, app refuses",
        "data.export downloadExport member: matrix grants, app refuses",
        "data.export createExportDownload member: matrix grants, app refuses",
      ]),
    `the seeded mismatch must be reported exactly:\n${drift.join("\n")}`,
  );
});
