/**
 * Reminder email delivery against real PostgreSQL and a real SMTP capture
 * (PLANNING-003): a disposable, pinned Mailpit container started with
 * `docker run`, the way the object-store suite starts its RustFS, reached
 * through the product's `SmtpReminderMail` and driven by the product's
 * delivery worker over the product's repository.
 *
 * - an immediate email arrives once, with the reminder and a person link;
 * - a digest member's due reminders arrive as one email;
 * - a provider that refuses before the message leaves is retried and sends
 *   exactly once;
 * - an answer lost after the message was written is reconciled and never
 *   sent again, and neither is an attempt a crashed worker left behind;
 * - `both` generates one occurrence of each channel, and a member without a
 *   verified address keeps in-app reminders whatever they chose.
 *
 * The final test removes the container and closes the suite's resources.
 */

import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { InAppReminderDelivery } from "../../packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import {
  createReminderDeliveryWorker,
  digestIdempotencyKey,
  reminderDeliveryAuditFrom,
  type ReminderDeliveryChannel,
} from "../../packages/backend/modules/planning/public.ts";
import { SmtpReminderMail } from "../../packages/backend/modules/workspaces/adapters/mail/smtp_reminder_mail.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { addMembership } from "../support/database.ts";
import {
  closeResources,
  createPerson,
  createReminder,
  deliveryConnection,
  deliveryRepository,
  deliveryTransaction,
  type Fixture,
  futureReminderAnchor,
  register,
  request,
  sql,
} from "./planning.test-helper.ts";

/** The Mailpit image `compose.support.yaml` pins for local and test mail. */
const MAILPIT_IMAGE =
  "axllent/mailpit:v1.30.6@sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d";
const WEB_ORIGIN = "http://127.0.0.1:4321";
const container = `kinship-reminder-mailpit-${Deno.pid}-${Date.now()}`;

async function docker(
  args: readonly string[],
  capture = false,
): Promise<string> {
  const output = await new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: capture ? "piped" : "null",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `docker ${args[0]} failed with exit code ${output.code}: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  return capture ? new TextDecoder().decode(output.stdout).trim() : "";
}

async function publishedPort(port: number): Promise<number> {
  const mapped = Number(
    (await docker(["port", container, `${port}/tcp`], true)).match(
      /:(\d+)$/,
    )?.[1],
  );
  assert(
    Number.isInteger(mapped) && mapped > 0,
    `Mailpit published no ${port}`,
  );
  return mapped;
}

/** Starts the disposable mailbox; a failed start never leaves it running. */
async function startMailpit() {
  await docker([
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "--publish",
    "127.0.0.1::1025",
    "--publish",
    "127.0.0.1::8025",
    MAILPIT_IMAGE,
  ]);
  try {
    const smtpPort = await publishedPort(1025);
    const api = `http://127.0.0.1:${await publishedPort(8025)}`;
    // Mailpit answers its API once it is ready; the probe is retried here,
    // never in product code.
    for (let attempt = 0;; attempt++) {
      const ready = await fetch(`${api}/readyz`).then(
        (response) => response.ok,
        () => false,
      );
      if (ready) break;
      if (attempt === 120) throw new Error("Disposable Mailpit did not start.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { api, smtpPort };
  } catch (error) {
    await docker(["rm", "--force", container]).catch(() => undefined);
    throw error;
  }
}

const mailpit = await startMailpit();

const mail = new SmtpReminderMail({
  environment: "test",
  from: "hello@kinship.test",
  host: "127.0.0.1",
  port: mailpit.smtpPort,
  readTimeoutMs: 2_000,
  webOrigin: WEB_ORIGIN,
});

/** An SMTP transport pointed at a port nothing listens on. */
function unreachableMail(): SmtpReminderMail {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return new SmtpReminderMail({
    connectTimeoutMs: 500,
    environment: "test",
    from: "hello@kinship.test",
    host: "127.0.0.1",
    port,
    webOrigin: WEB_ORIGIN,
  });
}

function worker(channel: ReminderDeliveryChannel = mail) {
  return createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    email: { channel, ledger: deliveryRepository },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
}

interface Message {
  readonly ID: string;
  readonly Subject: string;
}

/** Every message Mailpit captured for `address`. */
async function messagesTo(address: string): Promise<readonly Message[]> {
  const response = await fetch(
    `${mailpit.api}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  const body = await response.json() as { messages?: Message[] };
  return body.messages ?? [];
}

async function messageText(id: string): Promise<string> {
  const response = await fetch(`${mailpit.api}/api/v1/message/${id}`);
  return ((await response.json()) as { Text?: string }).Text ?? "";
}

async function choose(
  fixture: Fixture,
  delivery: {
    readonly digestTime?: string | null;
    readonly reminderDelivery: string;
  },
): Promise<void> {
  const response = await request(
    fixture,
    "/api/v1/settings/preferences",
    "PUT",
    {
      contactNameOrder: "given_family_nickname",
      contactSortOrder: "given_name_asc",
      fluidLayout: false,
      locale: "en",
      measurementSystem: "metric",
      temperatureScale: "celsius",
      ...delivery,
    },
  );
  assert(
    response.status === 200,
    `delivery preference saved: ${response.status}`,
  );
}

interface OccurrenceState {
  readonly channel: string;
  readonly id: string;
  readonly provider_receipt: string | null;
  readonly provider_result_state: string;
  readonly status: string;
}

async function occurrencesOf(reminderId: string): Promise<OccurrenceState[]> {
  return await sql<OccurrenceState[]>`
    select id::text, channel, status, provider_result_state, provider_receipt
    from crm.reminder_occurrences where reminder_id = ${reminderId}::uuid
    order by channel, id
  `;
}

/** Makes every pending occurrence of the reminders due now. */
async function dueNow(...reminderIds: string[]): Promise<void> {
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where reminder_id = any(${reminderIds}::uuid[]) and status = 'pending'
  `;
}

async function signedUp(label: string) {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const fixture = await register(email, `${label} circle`);
  const personId = await createPerson(fixture, "Ada");
  return { email, fixture, personId };
}

Deno.test("[PLANNING-003] an immediate reminder email arrives once with a link to the person", async () => {
  const { email, fixture, personId } = await signedUp("email-now");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const reminder = await createReminder(fixture, personId, "Call Ada by email");
  const [occurrence] = await occurrencesOf(reminder.id);
  assertEquals(occurrence?.channel, "email", "email is generated alone");
  await dueNow(reminder.id);

  const tick = await worker().tick({ limit: 100, owner: "email-now" });
  assert(
    tick.results.some((item) =>
      item.id === occurrence?.id && item.status === "sent"
    ),
    JSON.stringify(tick),
  );
  const messages = await messagesTo(email);
  assertEquals(messages.length, 1, "one email");
  assertEquals(messages[0]?.Subject, "Reminder: Call Ada by email - today");
  const text = await messageText(messages[0]!.ID);
  assert(
    text.includes("Call Ada by email") &&
      text.includes(`${WEB_ORIGIN}/app/people/${personId}`),
    text,
  );

  await worker().tick({ limit: 100, owner: "email-now-again" });
  assertEquals((await messagesTo(email)).length, 1, "never sent twice");
  const [audit] = await sql<{ readonly payload: Record<string, unknown> }[]>`
    select payload from crm.audit_events
    where subject_id = ${occurrence!.id}::uuid
      and action = 'planning.reminder-delivered'
  `;
  assertEquals(audit?.payload.channel, "email", "the audit names the channel");
});

Deno.test("[PLANNING-003] a digest member's due reminders arrive together in one email", async () => {
  const { email, fixture, personId } = await signedUp("email-digest");
  await choose(fixture, { digestTime: "00:00", reminderDelivery: "email" });
  const first = await createReminder(fixture, personId, "Digest first");
  const second = await createReminder(fixture, personId, "Digest second");
  // Both came due before today's local 00:00, so today's digest carries them.
  await sql`
    update crm.reminder_occurrences
    set deliver_at = date_trunc('day', now()) - interval '1 hour'
    where reminder_id = any(${[first.id, second.id]}::uuid[])
  `;

  await worker().tick({ limit: 100, owner: "digest" });
  const messages = await messagesTo(email);
  assertEquals(messages.length, 1, "one digest email");
  assert(
    messages[0]?.Subject.startsWith("Your Kinship reminders for "),
    `${messages[0]?.Subject}`,
  );
  const text = await messageText(messages[0]!.ID);
  assert(
    text.includes("2 reminders") && text.includes("Digest first") &&
      text.includes("Digest second") &&
      text.includes(`${WEB_ORIGIN}/app/people/${personId}`),
    text,
  );
  const states = [
    ...await occurrencesOf(first.id),
    ...await occurrencesOf(second.id),
  ];
  assert(
    states.every((state) => state.status === "sent") &&
      new Set(states.map((state) => state.provider_receipt)).size === 1,
    `every digest occurrence shares one receipt: ${JSON.stringify(states)}`,
  );
  const audits = await sql<{ readonly count: number }[]>`
    select (payload ->> 'occurrenceCount')::int as count from crm.audit_events
    where subject_id = any(${states.map((state) => state.id)}::uuid[])
      and action = 'planning.reminder-delivered'
  `;
  assertEquals(audits.map((audit) => audit.count), [2, 2]);
});

Deno.test("[PLANNING-003] a refused send is retried and delivered exactly once", async () => {
  const { email, fixture, personId } = await signedUp("email-retry");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const reminder = await createReminder(fixture, personId, "Retry reminder");
  await dueNow(reminder.id);

  await worker(unreachableMail()).tick({
    limit: 100,
    owner: "retry-down",
  });
  const [failed] = await occurrencesOf(reminder.id);
  assert(
    failed?.status === "retry" &&
      failed.provider_result_state === "unattempted",
    `a refusal before sending is retried as unattempted: ${
      JSON.stringify(failed)
    }`,
  );
  assertEquals((await messagesTo(email)).length, 0);

  await sql`
    update crm.reminder_occurrences set next_attempt_at = now() - interval '1 second'
    where id = ${failed.id}::uuid
  `;
  await worker().tick({ limit: 100, owner: "retry-up" });
  const [sent] = await occurrencesOf(reminder.id);
  assertEquals(sent?.status, "sent");
  assertEquals((await messagesTo(email)).length, 1, "exactly one email");
});

Deno.test("[PLANNING-003] an ambiguous send is reconciled and never sent again", async () => {
  const { email, fixture, personId } = await signedUp("email-ambiguous");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const reminder = await createReminder(
    fixture,
    personId,
    "Ambiguous reminder",
  );
  await dueNow(reminder.id);

  // The message reaches the server, and its answer is lost on the way back.
  const lostAnswer: ReminderDeliveryChannel = {
    reconcile: (command) => mail.reconcile(command),
    send: async (message) => {
      await mail.send(message);
      throw new Error("answer lost after DATA");
    },
  };
  await worker(lostAnswer).tick({ limit: 100, owner: "ambiguous" });
  const [ambiguous] = await occurrencesOf(reminder.id);
  assert(
    ambiguous?.status === "retry" &&
      ambiguous.provider_result_state === "ambiguous",
    JSON.stringify(ambiguous),
  );
  await sql`
    update crm.reminder_occurrences set next_attempt_at = now() - interval '1 second'
    where id = ${ambiguous.id}::uuid
  `;
  await worker().tick({ limit: 100, maxAttempts: 2, owner: "reconcile" });
  const [reconciled] = await occurrencesOf(reminder.id);
  assertEquals(reconciled?.status, "manual_attention");
  assertEquals((await messagesTo(email)).length, 1, "never sent twice");
});

Deno.test("[PLANNING-003] an attempt a crashed worker left behind is reconciled, not resent", async () => {
  const { email, fixture, personId } = await signedUp("email-crash");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const reminder = await createReminder(fixture, personId, "Crashed reminder");
  await dueNow(reminder.id);
  const claims = await deliveryRepository.claimDue({
    channels: ["email"],
    leaseExpiresAt: new Date(Date.now() + 60_000),
    limit: 100,
    now: new Date(),
    owner: "crashed-worker",
  });
  const claim = claims.find((item) => item.title === "Crashed reminder");
  assert(claim, "the crashed worker held the claim");
  const marked = await deliveryRepository.markAttempted({
    claims: [claim],
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assertEquals(marked.recordedIds, [claim.id], "the live claim is recorded");
  const [renewed] = await sql<{ readonly renewed: boolean }[]>`
    select lease_expires_at > now() + interval '90 seconds' as renewed
    from crm.reminder_occurrences where id = ${claim.id}::uuid
  `;
  assert(renewed?.renewed, "recording the attempt renewed the lease");
  // The worker dies here, before it hears from SMTP or finalizes.
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${claim.id}::uuid
  `;
  await worker().tick({ limit: 100, owner: "recovering-worker" });
  const [recovered] = await occurrencesOf(reminder.id);
  assert(
    recovered?.provider_result_state === "ambiguous" &&
      recovered.status === "retry",
    JSON.stringify(recovered),
  );
  assertEquals((await messagesTo(email)).length, 0, "nothing was resent");
});

Deno.test("[PLANNING-003] a claim whose token or lease was lost records nothing and sends nothing", async () => {
  const { email, fixture, personId } = await signedUp("email-lost-lease");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const expired = await createReminder(fixture, personId, "Expired lease");
  const stolen = await createReminder(fixture, personId, "Stolen claim");
  await dueNow(expired.id, stolen.id);
  const claims = (await deliveryRepository.claimDue({
    channels: ["email"],
    leaseExpiresAt: new Date(Date.now() + 60_000),
    limit: 100,
    now: new Date(),
    owner: "slow-worker",
  })).filter((claim) =>
    claim.title === "Expired lease" || claim.title === "Stolen claim"
  );
  assertEquals(claims.length, 2, "the slow worker held both claims");
  const expiredClaim = claims.find((claim) => claim.title === "Expired lease")!;
  const stolenClaim = claims.find((claim) => claim.title === "Stolen claim")!;
  // One lease runs out; the other claim is taken over by another worker.
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${expiredClaim.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set claim_token = gen_random_uuid()
    where id = ${stolenClaim.id}::uuid
  `;
  assertEquals(
    await deliveryRepository.renewLeases({
      claims,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    }),
    [],
    "a lost claim's lease is not renewed",
  );
  const marked = await deliveryRepository.markAttempted({
    claims,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assertEquals(marked.recordedIds, [], "neither claim was still held");
  const states = [
    ...await occurrencesOf(expired.id),
    ...await occurrencesOf(stolen.id),
  ];
  assert(
    states.every((state) => state.provider_result_state === "unattempted"),
    `a lost claim was recorded: ${JSON.stringify(states)}`,
  );

  // The worker that holds nothing sends nothing.
  const stale = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    email: { channel: mail, ledger: deliveryRepository },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: {
      claimDue: () => Promise.resolve(claims),
      finalize: (command) => deliveryRepository.finalize(command),
      replenish: () => Promise.resolve(),
    },
    transaction: deliveryTransaction,
  });
  const tick = await stale.tick({ owner: "slow-worker" });
  assertEquals(
    tick.results.map((item) => item.status),
    ["stale-claim", "stale-claim"],
  );
  assertEquals((await messagesTo(email)).length, 0, "no email was sent");
});

Deno.test("[PLANNING-003] a recorded digest stores the key it is sent under", async () => {
  const { fixture, personId } = await signedUp("email-digest-key");
  await choose(fixture, { digestTime: "00:00", reminderDelivery: "email" });
  const reminder = await createReminder(fixture, personId, "Keyed digest");
  await sql`
    update crm.reminder_occurrences
    set deliver_at = date_trunc('day', now()) - interval '1 hour'
    where reminder_id = ${reminder.id}::uuid
  `;
  const [claim] = (await deliveryRepository.claimDue({
    channels: ["email"],
    leaseExpiresAt: new Date(Date.now() + 60_000),
    limit: 100,
    now: new Date(),
    owner: "digest-key",
  })).filter((item) => item.title === "Keyed digest");
  assert(claim?.digestDate, "the claim is a digest claim");
  const marked = await deliveryRepository.markAttempted({
    claims: [claim],
    digest: { localDate: claim.digestDate, memberId: claim.memberId },
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assertEquals(marked.recordedIds, [claim.id]);
  assertEquals(
    marked.attemptKey,
    await digestIdempotencyKey({
      localDate: claim.digestDate,
      memberId: claim.memberId,
      occurrenceIds: [claim.id],
    }),
  );
  // The worker dies before it hears back; the next claim reconciles with it.
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${claim.id}::uuid
  `;
  const [again] = (await deliveryRepository.claimDue({
    channels: ["email"],
    leaseExpiresAt: new Date(Date.now() + 60_000),
    limit: 100,
    now: new Date(),
    owner: "digest-key-recovery",
  })).filter((item) => item.id === claim.id);
  assertEquals(again?.providerResultState, "ambiguous");
  assertEquals(again?.attemptKey, marked.attemptKey);
});

Deno.test("[PLANNING-003] a digest's attempt key does not outlive a failed attempt", async () => {
  /** One digest occurrence, claimed and recorded under its attempt key. */
  const recordedDigest = async (label: string) => {
    const { fixture, personId } = await signedUp(label);
    await choose(fixture, { digestTime: "00:00", reminderDelivery: "email" });
    const reminder = await createReminder(fixture, personId, label);
    await sql`
      update crm.reminder_occurrences
      set deliver_at = date_trunc('day', now()) - interval '1 hour'
      where reminder_id = ${reminder.id}::uuid
    `;
    const [claim] = (await deliveryRepository.claimDue({
      channels: ["email"],
      leaseExpiresAt: new Date(Date.now() + 60_000),
      limit: 100,
      now: new Date(),
      owner: label,
    })).filter((item) => item.title === label);
    assert(claim?.digestDate, `${label} is a digest claim`);
    const marked = await deliveryRepository.markAttempted({
      claims: [claim],
      digest: { localDate: claim.digestDate, memberId: claim.memberId },
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    });
    assert(marked.attemptKey, `${label} recorded an attempt key`);
    return { claim, reminderId: reminder.id };
  };
  const finalized = async (
    digest: Awaited<ReturnType<typeof recordedDigest>>,
    outcome: {
      readonly providerResultState: "ambiguous" | "confirmed" | "rejected";
      readonly receipt?: string;
      readonly status: "failed" | "manual_attention" | "sent";
    },
  ) => {
    const updated = await deliveryTransaction.run((transaction) =>
      deliveryRepository.finalize({
        claimToken: digest.claim.claimToken,
        id: digest.claim.id,
        now: new Date(),
        transaction,
        ...outcome,
      })
    );
    assert(updated, "the held claim was finalized");
    const [state] = await occurrencesOf(digest.reminderId);
    return state;
  };

  const rejected = await finalized(await recordedDigest("digest-rejected"), {
    providerResultState: "rejected",
    status: "failed",
  });
  assertEquals(rejected?.provider_receipt, null, "a rejected digest's key");
  const unresolved = await finalized(await recordedDigest("digest-manual"), {
    providerResultState: "ambiguous",
    status: "manual_attention",
  });
  assertEquals(
    unresolved?.provider_receipt,
    null,
    "a manual-attention digest's key",
  );
  const delivered = await finalized(await recordedDigest("digest-delivered"), {
    providerResultState: "confirmed",
    receipt: "smtp:digest-delivered",
    status: "sent",
  });
  assertEquals(delivered?.provider_receipt, "smtp:digest-delivered");
});

Deno.test("[REL-072] a digest left needing attention keeps its sent key in the failure audit", async () => {
  const { email, fixture, personId } = await signedUp("digest-attention");
  await choose(fixture, { digestTime: "00:00", reminderDelivery: "email" });
  const reminder = await createReminder(fixture, personId, "Attention digest");
  await sql`
    update crm.reminder_occurrences
    set deliver_at = date_trunc('day', now()) - interval '1 hour'
    where reminder_id = ${reminder.id}::uuid
  `;
  // This member's digest leaves, and its answer is lost on the way back.
  const sentKeys: string[] = [];
  const lostAnswer: ReminderDeliveryChannel = {
    reconcile: (command) => mail.reconcile(command),
    send: (message) => {
      if (message.to !== email) return mail.send(message);
      sentKeys.push(message.idempotencyKey);
      return Promise.reject(new Error("answer lost after DATA"));
    },
  };
  await worker(lostAnswer).tick({
    limit: 100,
    maxAttempts: 1,
    owner: "digest-attention",
  });

  assertEquals(sentKeys.length, 1, "the digest was sent once");
  const [state] = await occurrencesOf(reminder.id);
  assertEquals(state?.status, "manual_attention");
  assertEquals(state?.provider_receipt, null, "finalize cleared the key");
  const audits = await sql<{ readonly key: string | null }[]>`
    select payload ->> 'attemptKey' as key from crm.audit_events
    where subject_id = ${state!.id}::uuid
      and action = 'planning.reminder-failed'
  `;
  assertEquals(audits.map((audit) => audit.key), sentKeys);
});

Deno.test("[PLANNING-003] both channels, and an unverified member keeps in-app reminders", async () => {
  const both = await signedUp("email-both");
  await choose(both.fixture, { reminderDelivery: "both" });
  const reminder = await createReminder(both.fixture, both.personId, "Both");
  assertEquals(
    (await occurrencesOf(reminder.id)).map((state) => state.channel),
    ["email", "in_app"],
  );

  // A member with no preferences row chose nothing, which is in-app.
  const unset = await signedUp("email-unset");
  await sql`
    delete from crm.member_preferences
    where member_id = ${unset.fixture.memberId}::uuid
  `;
  const unsetReminder = await createReminder(
    unset.fixture,
    unset.personId,
    "Unset",
  );
  assertEquals(
    (await occurrencesOf(unsetReminder.id)).map((state) => state.channel),
    ["in_app"],
  );

  // An unverified member cannot sign in, so the fallback is observed where
  // it matters: the worker's rolling window, minting for a member whose
  // address stopped being verified after they chose email.
  const unverified = await signedUp("email-unverified");
  await choose(unverified.fixture, { reminderDelivery: "email" });
  const created = await request(
    unverified.fixture,
    "/api/v1/reminders",
    "POST",
    {
      anchorOn: futureReminderAnchor(),
      personId: unverified.personId,
      recurrenceInterval: 1,
      recurrenceUnit: "week",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: "Weekly unverified",
    },
  );
  assert(created.status === 201, `weekly reminder created: ${created.status}`);
  const weekly = (await created.json() as { reminder: { id: string } })
    .reminder;
  const minted = await occurrencesOf(weekly.id);
  assert(
    minted.length > 1 && minted.every((state) => state.channel === "email"),
    `a verified member's window is email: ${JSON.stringify(minted)}`,
  );
  await sql`
    update crm.users set email_verified_at = null
    where lower(email) = lower(${unverified.email})
  `;
  // Keep only the earliest occurrence, so the window has dates to refill.
  await sql`
    delete from crm.reminder_occurrences
    where reminder_id = ${weekly.id}::uuid and id <> (
      select id from crm.reminder_occurrences
      where reminder_id = ${weekly.id}::uuid
      order by occurs_on limit 1
    )
  `;
  await worker().tick({ limit: 100, owner: "unverified-window" });
  // The kept email notice is waiting too, so it moves to the app as well.
  const refilled = await occurrencesOf(weekly.id);
  assert(
    refilled.length > 1 &&
      refilled.every((state) => state.channel === "in_app"),
    `no reminder is lost to an address that is no longer verified: ${
      JSON.stringify(refilled)
    }`,
  );
});

Deno.test("[PLANNING-003] an important date's reminders follow each member's delivery choice", async () => {
  const owner = await signedUp("email-dates-owner");
  await choose(owner.fixture, { reminderDelivery: "both" });
  const workspaceId = owner.fixture.workspaceId;
  const member = async (label: string, verified: boolean, choice: string) => {
    const userId = crypto.randomUUID();
    await sql`
      insert into crm.users (id, email, first_name, status, email_verified_at)
      values (${userId}, ${`${label}-${userId}@example.test`}, ${label},
        'active', ${verified ? new Date() : null})
    `;
    const memberId = await addMembership(sql, userId, workspaceId, "member");
    await sql`
      update crm.member_preferences set reminder_delivery = ${choice}
      where member_id = ${memberId}::uuid
    `;
    return memberId;
  };
  const emailOnly = await member("email-only", true, "email");
  const unverified = await member("unverified", false, "email");

  const created = await request(
    owner.fixture,
    `/api/v1/people/${owner.personId}/dates`,
    "POST",
    {
      day: 14,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 3,
      precision: "month_day",
    },
  );
  assert(created.status === 201, `birthday saved: ${created.status}`);
  const channels = await sql<{
    readonly channels: string;
    readonly member_id: string;
  }[]>`
    select occurrence.member_id::text,
      string_agg(distinct occurrence.channel, ',' order by occurrence.channel)
        as channels
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    join crm.person_dates date on date.id = reminder.person_date_id
    where date.person_id = ${owner.personId}::uuid
    group by occurrence.member_id
  `;
  const byMember = new Map(
    channels.map((row) => [row.member_id, row.channels]),
  );
  assertEquals(byMember.get(owner.fixture.memberId), "email,in_app", "both");
  assertEquals(byMember.get(emailOnly), "email", "email only");
  assertEquals(
    byMember.get(unverified),
    "in_app",
    "an unverified member keeps in-app reminders",
  );
});

Deno.test("[PLANNING-003] an advance notice email names the date it is for and how far ahead", async () => {
  const { email, fixture, personId } = await signedUp("email-lead");
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  await sql`
    insert into crm.reminder_rules (workspace_id, days_before, is_active)
    values (${fixture.workspaceId}::uuid, 30, true)
  `;
  const created = await request(
    fixture,
    `/api/v1/people/${personId}/dates`,
    "POST",
    {
      day: 2,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 12,
      precision: "month_day",
    },
  );
  assert(created.status === 201, `birthday saved: ${created.status}`);
  // The worker mints the date's lead notices; then only the 30-day one is due.
  await worker().tick({ limit: 100, owner: "email-lead-mint" });
  const [notice] = await sql<
    { readonly id: string; readonly occurs_on: string }[]
  >`
    select occurrence.id::text, occurrence.occurs_on::text
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    join crm.person_dates date on date.id = reminder.person_date_id
    where date.person_id = ${personId}::uuid and occurrence.channel = 'email'
      and occurrence.lead_time_days = 30 and occurrence.status = 'pending'
    order by occurrence.occurs_on limit 1
  `;
  assert(notice, "a 30-day email notice was minted");
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${notice.id}::uuid
  `;
  await worker().tick({ limit: 100, owner: "email-lead" });
  const messages = await messagesTo(email);
  assertEquals(messages.length, 1, "only the due notice is sent");
  const on = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${notice.occurs_on}T12:00:00Z`));
  const subject = messages[0]?.Subject ?? "";
  assert(subject.endsWith(" - in 30 days, on December 2"), subject);
  const text = await messageText(messages[0]!.ID);
  assert(text.includes("Advance notice: this is coming up in 30 days."), text);
  assert(text.includes(`When: ${on} (in 30 days)`), text);
  assert(
    text.includes(
      `${WEB_ORIGIN}/app/settings/personalization?section=reminder-rules`,
    ),
    text,
  );
});

Deno.test("[PLANNING-003] a delivery change re-channels every notification not yet sent", async () => {
  const { email, fixture, personId } = await signedUp("email-switch");
  await choose(fixture, { digestTime: null, reminderDelivery: "in_app" });
  const once = await createReminder(fixture, personId, "Switch once");
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: futureReminderAnchor(),
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "week",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Switch weekly",
  });
  assert(created.status === 201, `weekly reminder created: ${created.status}`);
  const weekly = (await created.json() as { reminder: { id: string } })
    .reminder;
  // One notice already went out in the app; a later choice never touches it.
  const [delivered] = await occurrencesOf(weekly.id);
  await sql`
    update crm.reminder_occurrences set status = 'sent',
      deliver_at = now() - interval '1 day', sent_at = now(),
      attempt_count = 1, provider_result_state = 'confirmed',
      provider_receipt = 'in-app', provider_effect_at = now(),
      visible_at = now()
    where id = ${delivered!.id}::uuid
  `;
  const reminders = [once.id, weekly.id];
  /** Each date's channels that are still waiting to be sent. */
  const waiting = async () =>
    await sql<{ readonly channels: string }[]>`
      select string_agg(channel, ',' order by channel) as channels
      from crm.reminder_occurrences
      where reminder_id = any(${reminders}::uuid[]) and status = 'pending'
      group by reminder_id, occurs_on, coalesce(lead_time_days, -1)
    `;
  const pendingDates = (await waiting()).length;
  assert(pendingDates > 2, `dates are scheduled: ${pendingDates}`);
  const settle = async (choice: string) => {
    await choose(fixture, { digestTime: null, reminderDelivery: choice });
    await worker().tick({ limit: 100, owner: `email-switch-${choice}` });
    return (await waiting()).map((row) => row.channels);
  };

  for (
    const [choice, expected] of [
      ["both", "email,in_app"],
      ["email", "email"],
      ["in_app", "in_app"],
    ] as const
  ) {
    const channels = await settle(choice);
    assertEquals(
      channels.length,
      pendingDates,
      `${choice} keeps every scheduled date`,
    );
    assert(
      channels.every((value) => value === expected),
      `${choice} applies to every waiting notice: ${JSON.stringify(channels)}`,
    );
  }
  const [kept] = await sql<{ readonly status: string }[]>`
    select status from crm.reminder_occurrences
    where id = ${delivered!.id}::uuid
  `;
  assertEquals(kept?.status, "sent", "a notice already sent stays as it was");
  assertEquals((await messagesTo(email)).length, 0, "nothing was due");
});

Deno.test("[PLANNING-003] a re-channel never leaves a date without a live notice", async () => {
  const weeklyFor = async (label: string) => {
    const member = await signedUp(label);
    await choose(member.fixture, {
      digestTime: null,
      reminderDelivery: "in_app",
    });
    const created = await request(
      member.fixture,
      "/api/v1/reminders",
      "POST",
      {
        anchorOn: futureReminderAnchor(),
        personId: member.personId,
        recurrenceInterval: 1,
        recurrenceUnit: "week",
        requestId: crypto.randomUUID(),
        sendTime: "09:00",
        title: `${label} weekly`,
      },
    );
    assert(created.status === 201, `weekly reminder: ${created.status}`);
    const reminder = (await created.json() as { reminder: { id: string } })
      .reminder;
    return { ...member, reminderId: reminder.id };
  };
  const member = await weeklyFor("email-keep");
  const neighbour = await weeklyFor("email-neighbour");
  const dates = await sql<
    { readonly id: string; readonly occurs_on: string }[]
  >`
    select id::text, occurs_on::text from crm.reminder_occurrences
    where reminder_id = ${member.reminderId}::uuid order by occurs_on
  `;
  const [cancelledDate, attemptedDate] = [dates[1]!, dates[2]!];
  // A copy left cancelled on the channel about to be chosen, as reactivating
  // a reminder or an import leaves one, holds that date's unique key.
  await sql`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      title_snapshot, created_at, updated_at
    , workspace_id)
    select reminder_id, member_id, occurs_on, deliver_at, 'email',
      'cancelled', title_snapshot, now(), now(),
        (select scope.workspace_id from crm.reminders scope where scope.id = reminder_id)
    from crm.reminder_occurrences where id = ${cancelledDate.id}::uuid
  `;
  // A notice already attempted is the provider's to settle, not the choice's.
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      last_attempt_at = now(), next_attempt_at = deliver_at
    where id = ${attemptedDate.id}::uuid
  `;

  await choose(member.fixture, { digestTime: null, reminderDelivery: "email" });
  await worker().tick({ limit: 100, owner: "email-keep" });

  const live = await sql<{ readonly channels: string }[]>`
    select coalesce(string_agg(occurrence.channel, ','
      order by occurrence.channel) filter (
        where occurrence.status in ('pending', 'retry')
      ), '') as channels
    from crm.reminder_occurrences occurrence
    where occurrence.reminder_id = ${member.reminderId}::uuid
      and occurrence.occurs_on = ${cancelledDate.occurs_on}::date
  `;
  assertEquals(
    live[0]?.channels,
    "email",
    "the cancelled email copy is revived instead of the date going silent",
  );
  const [attempted] = await sql<{ readonly status: string }[]>`
    select status from crm.reminder_occurrences
    where id = ${attemptedDate.id}::uuid
  `;
  assertEquals(attempted?.status, "retry", "an attempted notice is kept");
  const neighbours = await occurrencesOf(neighbour.reminderId);
  assert(
    neighbours.length > 1 &&
      neighbours.every((state) => state.channel === "in_app"),
    `another workspace's member keeps their own choice: ${
      JSON.stringify(neighbours)
    }`,
  );
});

Deno.test("[AUD-W1] a delivery change re-channels waiting notices in the same save", async () => {
  const { fixture, personId } = await signedUp("email-inline");
  await choose(fixture, { digestTime: null, reminderDelivery: "in_app" });
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: futureReminderAnchor(),
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "week",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Inline weekly",
  });
  assert(created.status === 201, `weekly reminder created: ${created.status}`);
  const weekly = (await created.json() as { reminder: { id: string } })
    .reminder;
  // No worker runs after the choice is saved.
  await choose(fixture, { digestTime: null, reminderDelivery: "email" });
  const waiting = (await occurrencesOf(weekly.id))
    .filter((state) => state.status === "pending");
  assert(
    waiting.length > 1 && waiting.every((state) => state.channel === "email"),
    `the saved choice applies to every waiting notice: ${
      JSON.stringify(waiting)
    }`,
  );
});

Deno.test("[AUD-W1] a delivery change saved during a replenishment is not reverted", async () => {
  const { fixture, personId } = await signedUp("email-race");
  await choose(fixture, { digestTime: null, reminderDelivery: "in_app" });
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: futureReminderAnchor(),
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "week",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Race weekly",
  });
  assert(created.status === 201, `weekly reminder created: ${created.status}`);
  const weekly = (await created.json() as { reminder: { id: string } })
    .reminder;
  // The window fell short, so the replenishment also tops it up.
  await sql`
    delete from crm.reminder_occurrences
    where reminder_id = ${weekly.id}::uuid and occurs_on > (
      select min(occurs_on) + 14 from crm.reminder_occurrences
      where reminder_id = ${weekly.id}::uuid
    )
  `;
  // The replenishment's first read of delivery choices stalls after it has
  // read them, while the member saves the opposite choice.
  let release!: () => void;
  const latch = new Promise<void>((resolve) => release = resolve);
  let reads = 0;
  const preferences = new PostgresReminderDeliveryPreferences();
  const stalled = new PostgresReminderDeliveryRepository(
    deliveryConnection.db,
    new PostgresActorRevalidation(),
    {
      listDeliveryPreferences: async (command) => {
        const choices = await preferences.listDeliveryPreferences(command);
        if (reads++ === 0) await latch;
        return choices;
      },
    },
  );
  const replenishing = stalled.replenish({ now: new Date() });
  while (reads === 0) await new Promise((resolve) => setTimeout(resolve, 10));
  const saving = choose(fixture, {
    digestTime: null,
    reminderDelivery: "email",
  });
  // A save that waits for the replenishment is released with it.
  await Promise.race([
    saving,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  release();
  await Promise.all([replenishing, saving]);

  const waiting = (await occurrencesOf(weekly.id))
    .filter((state) => state.status === "pending");
  assert(
    waiting.length >= 8 && waiting.every((state) => state.channel === "email"),
    `every waiting notice is on the channel saved last: ${
      JSON.stringify(waiting.map((state) => state.channel))
    }`,
  );
});

Deno.test({
  name: "[PLANNING-003] Mailpit and PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await docker(["rm", "--force", container]);
    await closeResources();
  },
});
