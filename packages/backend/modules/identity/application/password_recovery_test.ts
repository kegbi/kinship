import { createPasswordRecovery } from "./password_recovery.ts";
import { assert } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";

function recoveryFixture(options: {
  readonly changed?: (email: string) => Promise<void>;
  readonly deliveryEmail?: string;
  readonly mail: () => Promise<void>;
  readonly reset?: "expired" | "invalid";
}) {
  let releaseWindow = (): void => undefined;
  const window = new Promise<void>((resolve) => {
    releaseWindow = resolve;
  });
  const recovery = createPasswordRecovery({
    clock: fixedClock("2026-08-14T12:00:00.000Z"),
    deliveryWindowMilliseconds: 750,
    delay: () => window,
    hasher: {
      hash: () => Promise.resolve("hash"),
      needsUpgrade: () => false,
      verify: () => Promise.resolve(true),
    },
    ids: { create: () => "00000000-0000-4000-8000-000000000001" },
    mail: {
      sendPasswordChanged: (message) =>
        options.changed?.(message.email) ?? Promise.resolve(),
      sendPasswordReset: options.mail,
    },
    repository: {
      createRequest: () =>
        Promise.resolve(
          options.deliveryEmail ? { deliveryEmail: options.deliveryEmail } : {},
        ),
      resetPassword: () =>
        Promise.resolve(
          options.reset ?? {
            email: "owner@example.test",
            status: "reset" as const,
          },
        ),
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

Deno.test("AUD-A1 a completed reset tells the address its password changed", async () => {
  const told: string[] = [];
  const { recovery } = recoveryFixture({
    changed: (email) => {
      told.push(email);
      return Promise.resolve();
    },
    mail: () => Promise.resolve(),
  });
  const outcome = await recovery.reset({
    password: "a brand new passphrase",
    token: "token",
  });
  assert(outcome === "reset", "the reset completes");
  assert(told.join(",") === "owner@example.test", "the address is told once");
});

Deno.test("AUD-A1 a failed password-changed notice does not undo the reset", async () => {
  const { recovery } = recoveryFixture({
    changed: () => Promise.reject(new Error("provider detail")),
    mail: () => Promise.resolve(),
  });
  assert(
    await recovery.reset({ password: "a brand new passphrase", token: "t" }) ===
      "reset",
    "the password is already replaced",
  );
});

Deno.test("AUD-A1 a refused reset tells nobody", async () => {
  for (const refusal of ["expired", "invalid"] as const) {
    const told: string[] = [];
    const { recovery } = recoveryFixture({
      changed: (email) => {
        told.push(email);
        return Promise.resolve();
      },
      mail: () => Promise.resolve(),
      reset: refusal,
    });
    assert(
      await recovery.reset({
        password: "a brand new passphrase",
        token: "t",
      }) ===
        refusal,
      `${refusal} is answered as before`,
    );
    assert(told.length === 0, `${refusal} sends no notice`);
  }
});
