import {
  buildVerificationMessage,
  plainSmtpPolicy,
  smtpTimeouts,
  SmtpVerificationMail,
} from "./smtp_verification_mail.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("verification email contains only a safe single-use browser URL", () => {
  const mail = buildVerificationMessage(
    { from: "hello@kinship.test", webOrigin: "http://127.0.0.1:4321" },
    {
      email: "owner@example.test",
      expiresAt: new Date("2026-08-15T12:00:00Z"),
      token: "raw token / private",
    },
  );
  assert(mail.includes("To: owner@example.test"), "recipient is addressed");
  assert(
    mail.includes(
      "http://127.0.0.1:4321/auth/verify-email?token=raw+token+%2F+private",
    ),
    "token exists only in an encoded browser URL",
  );
  assert(!mail.includes("password"), "mail must not contain password material");
});

Deno.test("SMTP read timeout closes a stalled connection promptly", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const server = listener.accept().then(async (connection) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      connection.close();
    }
  });
  const mail = new SmtpVerificationMail({
    connectTimeoutMs: 50,
    environment: "test",
    from: "hello@kinship.test",
    host: "127.0.0.1",
    port,
    readTimeoutMs: 20,
    webOrigin: "http://127.0.0.1:4321",
    writeTimeoutMs: 50,
  });
  const started = Date.now();
  let error: unknown;
  try {
    await mail.sendVerification({
      email: "owner@example.test",
      expiresAt: new Date("2026-08-15T12:00:00Z"),
      token: "private-token",
    });
  } catch (caught) {
    error = caught;
  } finally {
    listener.close();
    await server;
  }
  assert(
    error instanceof Error && error.message === "SMTP read timed out.",
    "stalled SMTP reads fail with the bounded transport error",
  );
  assert(Date.now() - started < 500, "stalled provider cannot hang delivery");
});

Deno.test("SMTP operations require positive bounded timeouts", () => {
  const defaults = smtpTimeouts({});
  assert(
    defaults.connectTimeoutMs === 5_000 && defaults.readTimeoutMs === 5_000 &&
      defaults.writeTimeoutMs === 5_000,
    "SMTP operations have bounded defaults",
  );
  for (const invalid of [0, -1, 30_001, Number.NaN]) {
    let rejected = false;
    try {
      smtpTimeouts({ connectTimeoutMs: invalid });
    } catch {
      rejected = true;
    }
    assert(rejected, `invalid timeout ${invalid} must fail configuration`);
  }
});

Deno.test("plain SMTP is restricted to explicit local capture environments", () => {
  for (
    const allowed of [
      ["development", "127.0.0.1"],
      ["test", "localhost"],
      ["test", "mailpit"],
    ] as const
  ) {
    plainSmtpPolicy(allowed[0], allowed[1]);
  }
  for (
    const rejected of [
      ["production", "mailpit"],
      ["production", "smtp.example.com"],
      ["development", "smtp.example.com"],
    ] as const
  ) {
    let failed = false;
    try {
      plainSmtpPolicy(rejected[0], rejected[1]);
    } catch {
      failed = true;
    }
    assert(failed, `${rejected.join("/")} must fail closed`);
  }
});

Deno.test("SMTP configuration rejects invalid ports before delivery", () => {
  for (const port of [Number.NaN, 8.5, 0, 65_536]) {
    let error: unknown;
    try {
      new SmtpVerificationMail({
        environment: "test",
        from: "hello@kinship.test",
        host: "127.0.0.1",
        port,
        webOrigin: "http://127.0.0.1:4321",
      });
    } catch (caught) {
      error = caught;
    }
    assert(
      error instanceof Error &&
        error.message === "SMTP_PORT must be an integer between 1 and 65535.",
      `invalid SMTP port ${port} must fail configuration`,
    );
  }
});

Deno.test("SMTP configuration accepts only one safe sender mailbox", () => {
  new SmtpVerificationMail({
    environment: "test",
    from: "hello@kinship.local",
    host: "127.0.0.1",
    port: 1025,
    webOrigin: "http://127.0.0.1:4321",
  });

  for (
    const from of [
      "",
      "not-an-address",
      "hello@example.test,other@example.test",
      "Kinship <hello@example.test>",
      "hello@example.test\r\nBcc: attacker@example.test",
      "hello @example.test",
    ]
  ) {
    let error: unknown;
    try {
      new SmtpVerificationMail({
        environment: "test",
        from,
        host: "127.0.0.1",
        port: 1025,
        webOrigin: "http://127.0.0.1:4321",
      });
    } catch (caught) {
      error = caught;
    }
    assert(
      error instanceof Error &&
        error.message === "SMTP_FROM must be one safe mailbox address.",
      `invalid SMTP sender ${JSON.stringify(from)} must fail configuration`,
    );
  }
});
