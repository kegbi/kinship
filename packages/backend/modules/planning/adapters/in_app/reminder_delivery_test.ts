import { InAppReminderDelivery } from "./reminder_delivery.ts";

Deno.test("PLANNING-002 in-app provider delegates delivery and reconciliation to durable effect storage", async () => {
  const calls: string[] = [];
  const provider = new InAppReminderDelivery({
    record: (command) => {
      calls.push(`record:${command.occurrenceId}:${command.idempotencyKey}`);
      return Promise.resolve({
        receipt: "durable-receipt",
        status: "confirmed",
      });
    },
    reconcile: (command) => {
      calls.push(`reconcile:${command.occurrenceId}:${command.idempotencyKey}`);
      return Promise.resolve({
        receipt: "durable-receipt",
        status: "confirmed",
      });
    },
  });
  const command = {
    body: "Call Ada",
    idempotencyKey: "stable-key",
    occurrenceId: crypto.randomUUID(),
    recipientMemberId: crypto.randomUUID(),
    title: "Reminder",
  };
  const delivered = await provider.deliver(command);
  const reconciled = await provider.reconcile(command);
  if (
    delivered.status !== "confirmed" || reconciled.status !== "confirmed" ||
    calls.join(",") !==
      `record:${command.occurrenceId}:stable-key,reconcile:${command.occurrenceId}:stable-key`
  ) {
    throw new Error(JSON.stringify({ calls, delivered, reconciled }));
  }
});
