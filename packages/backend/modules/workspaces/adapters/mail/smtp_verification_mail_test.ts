import {
  buildInvitationMessage,
  buildVerificationMessage,
  invitationWorkspaceLabel,
  plainSmtpPolicy,
  resolveSmtpVerificationMailOptions,
  smtpTimeouts,
  SmtpVerificationMail,
} from "./smtp_verification_mail.ts";
import { assert, assertThrows } from "../../../../testing/assert.ts";

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

Deno.test("invitation email carries one encoded path token and an expiry", () => {
  const mail = buildInvitationMessage(
    { from: "hello@kinship.test", webOrigin: "https://kinship.test" },
    {
      email: "invitee@example.test",
      expiresAt: new Date("2026-08-22T12:00:00Z"),
      token: "raw/private token",
      workspaceName: "Family circle",
    },
  );
  assert(
    mail.includes("https://kinship.test/invite/raw%2Fprivate%20token"),
    "token is encoded into the cataloged route",
  );
  assert(mail.includes("2026-08-22T12:00:00.000Z"), "expiry is explicit");
  assert(
    !mail.includes("token_hash"),
    "storage material never enters delivery",
  );
});

Deno.test("[AUD-M3] SECA-03 an invitation's Subject is fixed and its workspace name is truncated and defused in the body", () => {
  const names = [
    "Security alert: sign in at https://kinship-login.evil.example now",
    "Verify at www.evil.example/login or kinship-login.evil.example today",
    "mailto:victim@example.test ftp://files.evil.example",
    "Ünïcode wörkspace — family",
    `Long ${"x".repeat(200)}`,
    "Family circle",
  ];
  for (const workspaceName of names) {
    const mail = buildInvitationMessage(
      { from: "hello@kinship.test", webOrigin: "https://kinship.test" },
      {
        email: "invitee@example.test",
        expiresAt: new Date("2026-08-22T12:00:00Z"),
        token: "raw-token",
        workspaceName,
      },
    );
    const [headers = "", body = ""] = mail.split("\r\n\r\n");
    const subjects = headers.split("\r\n").filter((line) =>
      line.startsWith("Subject:")
    );
    assert(
      subjects.length === 1 &&
        subjects[0] === "Subject: You were invited to a Kinship workspace",
      `the Subject is fixed for ${JSON.stringify(workspaceName)}`,
    );
    assert(
      !headers.includes(workspaceName.slice(0, 12)),
      "the workspace name appears in no header",
    );
    const links = body.match(/[a-z][a-z0-9+.-]*:\/\/\S+|www\.\S+/gi) ?? [];
    assert(
      links.length === 1 &&
        links[0] === "https://kinship.test/invite/raw-token",
      `the only link in the body is the invitation, got ${
        JSON.stringify(links)
      }`,
    );
    for (const host of ["evil.example", "@example.test"]) {
      assert(!body.includes(host), `${host} is neutralized in the body`);
    }
    const line = body.split("\r\n").find((candidate) =>
      candidate.startsWith("You were invited")
    ) ?? "";
    const named = /“(.*)”/.exec(line)?.[1] ?? "";
    assert(
      named.length > 0 && [...named].length <= 60,
      `the workspace name is quoted and truncated, got ${JSON.stringify(line)}`,
    );
  }
  const plain = buildInvitationMessage(
    { from: "hello@kinship.test", webOrigin: "https://kinship.test" },
    {
      email: "invitee@example.test",
      expiresAt: new Date("2026-08-22T12:00:00Z"),
      token: "raw-token",
      workspaceName: "Family circle",
    },
  );
  assert(
    plain.includes("“Family circle”"),
    "an ordinary name is shown unchanged in the body",
  );
  // Lookalike dots, bare addresses, and a mark hidden after a dot are links
  // to a mail client too.
  for (
    const [name, expected] of [
      ["login at evil\u3002com", "login at [link removed]"],
      ["login at evil\uFF0Ecom", "login at [link removed]"],
      ["login at evil\uFF61com", "login at [link removed]"],
      ["login at 203.0.113.5", "login at [link removed]"],
      ["visit 192.168.10.20/login", "visit [link removed]"],
      ["localhost:8080/x", "[link removed]"],
      ["evil.\u0301com", "[link removed]"],
      ["evil\u0301.com", "[link removed]"],
      ["Smith Family", "Smith Family"],
      ["St. Mary's", "St. Mary's"],
      ["The Smiths. Friends and family", "The Smiths. Friends and family"],
    ] as const
  ) {
    const label = invitationWorkspaceLabel(name);
    assert(
      label === expected,
      `${JSON.stringify(name)} is quoted as ${JSON.stringify(expected)}, got ${
        JSON.stringify(label)
      }`,
    );
  }
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
    assertThrows(() => {
      smtpTimeouts({ connectTimeoutMs: invalid });
    }, `invalid timeout ${invalid} must fail configuration`);
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
    assertThrows(() => {
      plainSmtpPolicy(rejected[0], rejected[1]);
    }, `${rejected.join("/")} must fail closed`);
  }
});

Deno.test("production SMTP requires an explicit TLS transport and paired credentials", () => {
  const values = new Map<string, string>([
    ["APP_ENV", "production"],
    ["PUBLIC_WEB_ORIGIN", "https://kinship.example"],
    ["SMTP_FROM", "hello@kinship.example"],
    ["SMTP_HOST", "smtp.example"],
    ["SMTP_PASSWORD", "private-password"],
    ["SMTP_PORT", "465"],
    ["SMTP_SECURITY", "tls"],
    ["SMTP_USERNAME", "private-user"],
  ]);
  const options = resolveSmtpVerificationMailOptions({
    get: (name) => values.get(name),
  });
  new SmtpVerificationMail(options);
  assert(options.security === "tls", "production SMTP uses implicit TLS");

  for (const name of ["SMTP_PASSWORD", "SMTP_USERNAME"] as const) {
    const incomplete = new Map(values);
    incomplete.delete(name);
    let error: unknown;
    try {
      new SmtpVerificationMail(resolveSmtpVerificationMailOptions({
        get: (requested) => incomplete.get(requested),
      }));
    } catch (caught) {
      error = caught;
    }
    assert(
      error instanceof Error &&
        error.message ===
          "SMTP_USERNAME and SMTP_PASSWORD must be configured together.",
      `${name} cannot be configured without its pair`,
    );
  }

  values.set("SMTP_SECURITY", "starttls");
  let invalidSecurity: unknown;
  try {
    resolveSmtpVerificationMailOptions({ get: (name) => values.get(name) });
  } catch (caught) {
    invalidSecurity = caught;
  }
  assert(
    invalidSecurity instanceof Error &&
      invalidSecurity.message === "SMTP_SECURITY must be plain or tls.",
    "unsupported transport fails configuration",
  );
});

Deno.test("authenticated TLS SMTP delivers without exposing credentials in results", async () => {
  const replies = [
    "220 ready\r\n",
    "250 hello\r\n",
    "334 username\r\n",
    "334 password\r\n",
    "235 authenticated\r\n",
    "250 sender\r\n",
    "250 recipient\r\n",
    "354 content\r\n",
    "250 queued\r\n",
    "221 bye\r\n",
  ];
  const commands: string[] = [];
  let closed = false;
  const mail = new SmtpVerificationMail({
    environment: "production",
    from: "hello@kinship.example",
    host: "smtp.example",
    password: "private-password",
    port: 465,
    security: "tls",
    username: "private-user",
    webOrigin: "https://kinship.example",
  }, (security, host, port) => {
    assert(
      security === "tls" && host === "smtp.example" && port === 465,
      "connector receives the validated TLS endpoint",
    );
    return Promise.resolve({
      close: () => closed = true,
      read: (buffer) => {
        const reply = new TextEncoder().encode(replies.shift()!);
        buffer.set(reply);
        return Promise.resolve(reply.length);
      },
      write: (buffer) => {
        commands.push(new TextDecoder().decode(buffer));
        return Promise.resolve(buffer.length);
      },
    });
  });

  await mail.sendPasswordReset({
    email: "owner@example.test",
    expiresAt: new Date("2026-08-24T12:00:00Z"),
    token: "reset-token",
  });

  assert(closed, "successful provider connection is closed");
  assert(commands[0] === "EHLO kinship.local\r\n", "SMTP greeting is sent");
  assert(commands[1] === "AUTH LOGIN\r\n", "authentication is explicit");
  assert(
    commands[2] === "cHJpdmF0ZS11c2Vy\r\n" &&
      commands[3] === "cHJpdmF0ZS1wYXNzd29yZA==\r\n",
    "credentials are encoded only inside the encrypted SMTP session",
  );
  assert(
    commands.some((value) => value.includes("/auth/reset-password?token=")),
    "password recovery uses the delivered browser route",
  );
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

/** An adapter whose provider accepts everything and records each message. */
function recordingMail(messages: string[]): SmtpVerificationMail {
  return new SmtpVerificationMail({
    environment: "test",
    from: "hello@kinship.test",
    host: "127.0.0.1",
    port: 1025,
    webOrigin: "https://kinship.example",
  }, () => {
    const replies = [
      "220 ready\r\n",
      "250 hello\r\n",
      "250 sender\r\n",
      "250 recipient\r\n",
      "354 content\r\n",
      "250 queued\r\n",
      "221 bye\r\n",
    ];
    return Promise.resolve({
      close: () => undefined,
      read: (buffer) => {
        const reply = new TextEncoder().encode(replies.shift()!);
        buffer.set(reply);
        return Promise.resolve(reply.length);
      },
      write: (buffer) => {
        messages.push(new TextDecoder().decode(buffer));
        return Promise.resolve(buffer.length);
      },
    });
  });
}

Deno.test("AUD-A1 an existing account is told, with a reset link and no verification link", async () => {
  const messages: string[] = [];
  await recordingMail(messages).sendAccountExists({
    email: "owner@example.test",
    reset: {
      expiresAt: new Date("2026-08-24T12:00:00Z"),
      token: "reset token / private",
    },
  });
  const body = messages.find((value) => value.startsWith("From:")) ?? "";
  assert(
    body.includes("Subject: You already have a Kinship account") &&
      body.includes("To: owner@example.test"),
    "the owner is addressed",
  );
  assert(
    body.includes(
      "https://kinship.example/auth/reset-password?token=reset+token+%2F+private",
    ) && body.includes("https://kinship.example/auth/sign-in"),
    "the email links to sign-in and to an encoded single-use reset",
  );
  assert(
    !body.includes("/auth/verify-email"),
    "an existing account is never sent a verification link",
  );
  assert(body.includes("2026-08-24T12:00:00.000Z"), "the expiry is stated");
});

Deno.test("AUD-A1 an existing account with no reset to issue is told without a link", async () => {
  const messages: string[] = [];
  await recordingMail(messages).sendAccountExists({
    email: "owner@example.test",
  });
  const body = messages.find((value) => value.startsWith("From:")) ?? "";
  assert(
    body.includes("Subject: You already have a Kinship account") &&
      body.includes("https://kinship.example/auth/forgot-password") &&
      !body.includes("token=") && !body.includes("expires at"),
    "the owner is told and pointed at the forgot-password page",
  );
});

Deno.test("AUD-A1 a password change is announced to the address", async () => {
  const messages: string[] = [];
  await recordingMail(messages).sendPasswordChanged({
    email: "owner@example.test",
  });
  const body = messages.find((value) => value.startsWith("From:")) ?? "";
  assert(
    body.includes("Subject: Your Kinship password was changed") &&
      body.includes("To: owner@example.test") &&
      body.includes("https://kinship.example/auth/forgot-password"),
    "the address is told and offered a way back in",
  );
  assert(!body.includes("token="), "the notice carries no credential");
});

Deno.test("[AUD-K6] SMTP without APP_ENV is production and refuses plain capture delivery", () => {
  for (const unset of [undefined, ""]) {
    const options = resolveSmtpVerificationMailOptions({
      get: (name) => name === "APP_ENV" ? unset : undefined,
    });
    assert(
      options.environment === "production",
      `APP_ENV=${JSON.stringify(unset)} resolves as production`,
    );
    assertThrows(() => {
      new SmtpVerificationMail(options);
    }, "an unset APP_ENV never permits plain SMTP");
  }
});
