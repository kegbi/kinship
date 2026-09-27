/**
 * What each planning suite loads (GAP-035): a configured app, pool, and
 * mailbox, the reminder-delivery wiring and fake provider the worker tests
 * drive, and the fixtures that create people, tasks, and reminders through the
 * API.
 *
 * Deno loads every test file in its own worker isolate, so each suite that
 * imports this module evaluates it afresh and owns its own app, pools, and
 * mailbox; nothing here is shared between suites. Each suite closes its own
 * instance in its final test, most of them through `closeResources()`.
 */

import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { type PeopleActor } from "../../packages/backend/modules/people/public.ts";
import { type ReminderDeliveryProvider } from "../../packages/backend/modules/planning/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/adapters/postgres/people_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresReminderDeliveryRepository } from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  openSql,
  requireDatabaseUrl,
  revocableActor as revocableActorFor,
} from "../support/database.ts";
import { apiSupport, type SignedInFixture } from "../support/api.ts";
import { createPerson as createPersonThroughApi } from "../support/fixtures.ts";

export const databaseUrl = requireDatabaseUrl();
export const sql = openSql(databaseUrl);
export const mail = new CapturedVerificationMail();
export const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", "http://localhost"),
);
export const deliveryConnection = connectDatabase(databaseUrl);
export const deliveryRepository = new PostgresReminderDeliveryRepository(
  deliveryConnection.db,
  new PostgresActorRevalidation(),
  new PostgresReminderDeliveryPreferences(),
);
export const deliveryTransaction = new PostgresPeopleTransaction(
  deliveryConnection.db,
);
const api = apiSupport(configured.app, mail, sql);

export class DurableFakeProvider implements ReminderDeliveryProvider {
  readonly effects = new Map<string, string>();
  throwAfterNextEffect = false;

  async deliver(command: Parameters<ReminderDeliveryProvider["deliver"]>[0]) {
    const existing = this.effects.get(command.idempotencyKey);
    if (existing) {
      return {
        receipt: existing,
        status: "confirmed" as const,
      };
    }
    const receipt = `fake:${command.occurrenceId}`;
    this.effects.set(command.idempotencyKey, receipt);
    await sql`
      update crm.reminder_occurrences set provider_receipt = ${receipt},
        provider_result_state = 'confirmed', provider_effect_at = now(),
        visible_at = now(), updated_at = now()
      where id = ${command.occurrenceId}::uuid
        and provider_idempotency_key = ${command.idempotencyKey}
    `;
    if (this.throwAfterNextEffect) {
      this.throwAfterNextEffect = false;
      throw new Error("effect committed before timeout");
    }
    return { receipt, status: "confirmed" as const };
  }

  reconcile(command: Parameters<ReminderDeliveryProvider["reconcile"]>[0]) {
    const receipt = this.effects.get(command.idempotencyKey);
    return Promise.resolve(
      receipt
        ? { receipt, status: "confirmed" as const }
        : { code: "not-found", status: "transient" as const },
    );
  }
}

export type Fixture = SignedInFixture;

export function register(
  email: string,
  workspaceName: string,
): Promise<Fixture> {
  return api.register(email, workspaceName, {
    firstName: "Planning",
    lastName: "Tester",
  });
}

export function request(
  fixture: Fixture,
  path: string,
  method: "GET" | "PATCH" | "POST" | "PUT" = "GET",
  body?: unknown,
): Promise<Response> {
  return api.request(fixture, path, method, body);
}

export function createPerson(
  fixture: Fixture,
  givenName: string,
): Promise<string> {
  return createPersonThroughApi(api, fixture, givenName);
}

export async function createTask(
  fixture: Fixture,
  title: string,
  personId?: string,
  dueAt?: string,
): Promise<{ readonly id: string; readonly updatedAt: string }> {
  const response = await request(fixture, "/api/v1/tasks", "POST", {
    ...(dueAt ? { dueAt } : {}),
    ...(personId ? { personId } : {}),
    requestId: crypto.randomUUID(),
    title,
  });
  const body = await response.json() as {
    readonly task: { readonly id: string; readonly updatedAt: string };
  };
  assert(
    response.status === 201,
    `${title} task created: ${JSON.stringify(body)}`,
  );
  return body.task;
}

export interface CreatedReminder {
  readonly reminder: {
    readonly id: string;
    readonly nextOccurrence?: {
      readonly deliverAt: string;
      readonly id: string;
      readonly occursOn: string;
    };
  };
}

export function futureReminderAnchor(now = Temporal.Now.instant()): string {
  return now.toZonedDateTimeISO("UTC").toPlainDate().add({ days: 2 })
    .toString();
}

export async function createReminder(
  fixture: Fixture,
  personId: string,
  title: string,
): Promise<CreatedReminder["reminder"]> {
  const anchor = futureReminderAnchor();
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: anchor,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title,
  });
  const body = await created.json() as CreatedReminder;
  assert(
    created.status === 201 && body.reminder.nextOccurrence,
    `${title} reminder created: ${JSON.stringify(body)}`,
  );
  return body.reminder;
}

/**
 * A workspace, member, and person written straight to PostgreSQL, so a test can
 * hold an actor context whose membership it revokes without touching sessions.
 */
export function revocableActor(
  name: string,
): Promise<PeopleActor & { readonly personId: string }> {
  return revocableActorFor(sql, name, {
    firstName: "Planning",
    personName: "Planning subject",
    role: "member",
    workspaceName: `${name} circle`,
  });
}

/** Closes the app and every pool this suite's instance of the module opened. */
export async function closeResources(): Promise<void> {
  await sql.end();
  await configured.close();
  await deliveryConnection.destroy();
}
