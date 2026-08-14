import { createPasswordRecovery } from "./password_recovery.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function recoveryFixture(options: {
  readonly deliveryEmail?: string;
  readonly mail: () => Promise<void>;
}) {
  let releaseWindow = (): void => undefined;
  const window = new Promise<void>((resolve) => {
    releaseWindow = resolve;
  });
  const recovery = createPasswordRecovery({
    clock: { now: () => new Date("2026-08-14T12:00:00.000Z") },
    deliveryWindowMilliseconds: 750,
    delay: () => window,
    hasher: {
      hash: () => Promise.resolve("hash"),
      needsUpgrade: () => false,
      verify: () => Promise.resolve(true),
    },
    ids: { create: () => "00000000-0000-4000-8000-000000000001" },
    mail: { sendPasswordReset: options.mail },
    repository: {
      createRequest: () =>
        Promise.resolve(
          options.deliveryEmail ? { deliveryEmail: options.deliveryEmail } : {},
        ),
      resetPassword: () => Promise.resolve("reset"),
    },
    tokens: {
      create: () => Promise.resolve({ hash: "token-hash", raw: "token" }),
      hash: () => Promise.resolve("token-hash"),
    },
    transaction: { run: (work) => work({ opaque: "transaction" }) },
  });
  return { recovery, releaseWindow };
}

Deno.test("password recovery waits the same bounded public window after successful delivery", async () => {
  let sent = false;
  const fixture = recoveryFixture({
    deliveryEmail: "owner@example.test",
    mail: () => {
      sent = true;
      return Promise.resolve();
    },
  });
  const request = fixture.recovery.request({ email: "owner@example.test" });
  for (let turn = 0; turn < 5 && !sent; turn += 1) await Promise.resolve();
  assert(sent, "delivery starts only after durable request commit");
  let settled = false;
  void request.then(() => settled = true);
  await Promise.resolve();
  assert(!settled, "fast provider cannot shorten the public timing window");
  fixture.releaseWindow();
  const result = await request;
  assert(
    result.delivery === "delivered",
    "internal delivery effect is truthful",
  );
});

Deno.test("password recovery contains provider failures and unknown identities in the same window", async () => {
  const failed = recoveryFixture({
    deliveryEmail: "owner@example.test",
    mail: () => Promise.reject(new Error("private SMTP detail")),
  });
  const unknown = recoveryFixture({
    mail: () => Promise.reject(new Error("must not send")),
  });
  const failedRequest = failed.recovery.request({
    email: "owner@example.test",
  });
  const unknownRequest = unknown.recovery.request({
    email: "absent@example.test",
  });
  await Promise.resolve();
  failed.releaseWindow();
  unknown.releaseWindow();
  const [failedResult, unknownResult] = await Promise.all([
    failedRequest,
    unknownRequest,
  ]);
  assert(failedResult.delivery === "failed", "provider failure is observed");
  assert(
    unknownResult.delivery === "not-applicable",
    "unknown identity is never sent mail",
  );
});
