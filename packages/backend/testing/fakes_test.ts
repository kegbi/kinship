import type { AuditEventRecorder } from "../shared-kernel/audit_event.ts";
import type { ObjectStorage } from "../modules/files/public.ts";
import type { PeopleActor } from "../modules/people/public.ts";
import { assert, assertEquals } from "./assert.ts";
import { actor } from "./fixtures.ts";
import {
  fakeMail,
  fakeObjectStore,
  fixedClock,
  inMemoryRepository,
  recordingAudit,
  recordingLogger,
  sequentialIds,
} from "./fakes.ts";
import type { Logger } from "../shared-kernel/telemetry.ts";

Deno.test("[GAP-014] the fixed clock never moves and hands out its own Date", () => {
  const clock = fixedClock("2026-08-23T10:00:00.000Z");
  const first = clock.now();
  first.setUTCFullYear(1999);
  assertEquals(clock.now().toISOString(), "2026-08-23T10:00:00.000Z");
  assertEquals(
    fixedClock(new Date("2026-08-23T10:00:00.000Z")).now().toISOString(),
    "2026-08-23T10:00:00.000Z",
  );
});

Deno.test("[GAP-014] sequential identifiers are deterministic under both port spellings", () => {
  const ids = sequentialIds();
  assertEquals(ids.create(), "00000000-0000-4000-8000-000000000001");
  assertEquals(ids.next(), "00000000-0000-4000-8000-000000000002");
  assertEquals(ids.issued.length, 2);

  const offset = sequentialIds({
    prefix: "10000000-0000-4000-8000-",
    start: 7,
  });
  assertEquals(offset.create(), "10000000-0000-4000-8000-000000000007");
  assertEquals(offset.create(), "10000000-0000-4000-8000-000000000008");
});

Deno.test("[GAP-014] the recording audit satisfies the kernel recorder and keeps every action", async () => {
  const recorder = recordingAudit();
  // The point of the default type argument: the real `…AuditFrom` factories
  // take exactly this port.
  const kernel: AuditEventRecorder = recorder;
  const transaction = { opaque: {} };
  const event = {
    action: "created",
    occurredAt: new Date("2026-08-23T10:00:00.000Z"),
    payload: {},
    subjectType: "gift",
    visibleOnDashboard: true,
  };
  const id = await kernel.record({ event, transaction });
  assertEquals(id, "0a000000-0000-4000-8000-000000000001");
  assertEquals(
    await kernel.recordWhen({ event, transaction, when: false }),
    undefined,
  );
  assert(
    await kernel.recordWhen({ event, transaction, when: true }) !== undefined,
    "a held condition writes",
  );
  await kernel.assertRecorded({ event, transaction });
  await recorder.assertPostcondition({ event, transaction });
  await recorder.assertFailurePostcondition({ event, transaction });
  assertEquals(recorder.actions, ["created", "created"]);
  assertEquals(recorder.commands.length, 2);
});

Deno.test("[GAP-014] the recording audit reads a module port's own action name", async () => {
  const audit = recordingAudit<{ readonly action?: string }>();
  await audit.record({ action: "changed" });
  await audit.record({});
  assertEquals(audit.actions, ["changed", ""]);
});

Deno.test("[GAP-014] the in-memory repository stores, finds, lists, and deletes by key", () => {
  interface Row {
    readonly id: string;
    readonly name: string;
  }
  const rows = inMemoryRepository<Row>((row) => row.id);
  assertEquals(rows.size, 0);
  assertEquals(rows.save({ id: "a", name: "Ada" }), { id: "a", name: "Ada" });
  rows.save({ id: "b", name: "Grace" });
  rows.save({ id: "a", name: "Ada Lovelace" });
  assertEquals(rows.size, 2);
  assertEquals(rows.find("a")?.name, "Ada Lovelace");
  assertEquals(rows.find("missing"), undefined);
  assertEquals(rows.list().map((row) => row.id), ["a", "b"]);
  assertEquals(rows.list((row) => row.id === "b").length, 1);
  assert(rows.delete("b"), "an existing key is removed");
  assert(!rows.delete("b"), "a removed key is gone");
  rows.entries.set("c", { id: "c", name: "Seeded" });
  assertEquals(rows.size, 2);
  rows.clear();
  assertEquals(rows.size, 0);
});

Deno.test("[GAP-014] the fake mail captures each single-use message once", async () => {
  const mail = fakeMail();
  const expiresAt = new Date("2026-08-23T10:00:00.000Z");
  await mail.sendVerification({
    email: "ada@example.test",
    expiresAt,
    token: "v",
  });
  await mail.sendInvitation({
    email: "grace@example.test",
    expiresAt,
    token: "i",
    workspaceName: "Family",
  });
  await mail.sendPasswordReset({
    email: "ada@example.test",
    expiresAt,
    token: "p",
  });
  assertEquals(mail.sent.map((message) => message.kind), [
    "verification",
    "invitation",
    "password-reset",
  ]);
  assertEquals(mail.last("invitation")?.workspaceName, "Family");
  assertEquals(mail.last("verification")?.token, "v");
  assertEquals(fakeMail().last("verification"), undefined);
});

Deno.test("[GAP-014] the fake object store keeps bytes by key and records every call", async () => {
  const store: ObjectStorage = fakeObjectStore();
  const fake = fakeObjectStore({ bucket: "named" });
  assertEquals(store.bucket, "test-files");
  assertEquals(fake.bucket, "named");
  assertEquals(await store.health(), "available");

  const bytes = new Uint8Array([1, 2, 3]);
  await fake.put({ bytes, key: "objects/one", mimeType: "application/pdf" });
  await fake.put({ bytes, key: "other/two" });
  bytes[0] = 9;
  assertEquals([...(await fake.get({ key: "objects/one" })) ?? []], [1, 2, 3]);
  assertEquals(await fake.get({ key: "absent" }), undefined);
  assertEquals(fake.list("objects/"), ["objects/one"]);
  assertEquals(fake.list().length, 2);
  await fake.remove({ key: "objects/one" });
  assertEquals(fake.objects.size, 1);
  assertEquals(fake.calls, [
    "put:objects/one",
    "put:other/two",
    "get:objects/one",
    "get:absent",
    "remove:objects/one",
  ]);
});

Deno.test("[GAP-014] the fixture actor satisfies a module's own actor type", () => {
  const people: PeopleActor = actor();
  assertEquals(people.role, "member");
});

Deno.test("[GAP-039] the recording logger satisfies the kernel port and keeps every event", () => {
  const recorder = recordingLogger();
  const kernel: Logger = recorder;
  kernel.log({
    event: "api.request",
    method: "GET",
    route: "/api/v1/people",
    status: 200,
    duration_ms: 3,
  });
  kernel.log({
    event: "worker.job",
    job: "reminder-delivery",
    request_id: "run-1",
    attempt: 1,
    outcome: "sent",
    duration_ms: 5,
  });

  assertEquals(
    recorder.events.map((event) => event.event),
    ["api.request", "worker.job"],
    "each event, in order, exactly as it was logged",
  );
});
