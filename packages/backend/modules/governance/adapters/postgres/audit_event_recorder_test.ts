import {
  type CompiledQuery,
  type DatabaseConnection,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
} from "kysely";
import {
  assert,
  assertEquals,
  assertRejects,
} from "../../../../testing/assert.ts";
import { PostgresAuditEventRecorder } from "./audit_event_recorder.ts";

Deno.test("historical recorder binds actor snapshot and distinct source dates with no live actor", async () => {
  const queries: CompiledQuery[] = [];
  let inserted = true;
  class Driver extends DummyDriver {
    override async acquireConnection(): Promise<DatabaseConnection> {
      const connection = await super.acquireConnection();
      return {
        ...connection,
        streamQuery: connection.streamQuery.bind(connection),
        executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
          queries.push(query);
          return Promise.resolve({
            rows: (inserted ? [{ id: "event-id" }] : []) as R[],
          });
        },
      };
    }
  }
  const database = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  const recorder = new PostgresAuditEventRecorder();
  const command = {
    id: "event-id",
    workspaceId: "workspace",
    personId: "person",
    reminderId: "reminder",
    data: {
      action: "reminder.sent",
      actorNameSnapshot: "Legacy Author",
      occurredAt: "2020-01-01T00:00:00.000Z",
      createdAt: "2020-01-02T00:00:00.000Z",
      visibleOnDashboard: false,
      payload: { source: { table: "reminders_sent" } },
    },
    transaction: { opaque: database },
  };
  await recorder.recordImported(command);
  assert(
    queries[0]!.sql.includes("actor_member_id, actor_name_snapshot"),
    "snapshot column is persisted",
  );
  assert(queries[0]!.sql.includes("::uuid, null,"), "actor is explicitly null");
  assertEquals(queries[0]!.parameters, [
    "event-id",
    "workspace",
    "Legacy Author",
    "person",
    "reminder",
    "reminder",
    "reminder.sent",
    JSON.stringify(command.data.payload),
    command.data.occurredAt,
    false,
    command.data.createdAt,
  ]);
  const { reminderId: _reminderId, ...personEvent } = command;
  await recorder.recordImported(personEvent);
  const { personId: _personId, ...anonymous } = personEvent;
  await recorder.recordImported(anonymous);
  inserted = false;
  await assertRejects(
    () => recorder.recordImported(command),
    "missing insert must fail the transaction",
  );
  await database.destroy();
});
