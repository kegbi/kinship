import {
  buildReminderMessage,
  SmtpReminderMail,
} from "./smtp_reminder_mail.ts";
import {
  assert,
  assertEquals,
  assertThrows,
} from "../../../../testing/assert.ts";

const options = {
  environment: "test",
  from: "hello@kinship.test",
  host: "127.0.0.1",
  port: 1025,
  webOrigin: "https://kinship.test",
};

/** The decoded text of every base64 part of a MIME message. */
function decodedParts(message: string): string {
  return message.split(/\r\n\r\n/).slice(1).map((part) => {
    const body = part.split("\r\n--")[0]!.replaceAll("\r\n", "");
    try {
      return new TextDecoder().decode(Uint8Array.fromBase64(body));
    } catch {
      return "";
    }
  }).join("\n");
}

Deno.test("[PLANNING-003] a reminder email carries its title, body, and an absolute person link", () => {
  const message = buildReminderMessage(options, {
    idempotencyKey: "reminder-occurrence:5f1c",
    items: [{
      body: "Reminder for Call Ada",
      personId: "11111111-1111-4111-8111-111111111111",
      title: "Call Ada",
    }],
    to: "owner@example.test",
  });
  assert(message.includes("To: owner@example.test\r\n"), "recipient");
  assert(message.includes("Subject: Reminder: Call Ada\r\n"), message);
  assert(
    message.includes("Message-ID: <reminder-occurrence.5f1c@kinship.test>"),
    "the idempotency key names the message",
  );
  assert(
    message.includes("Content-Type: multipart/alternative;"),
    "plain text and HTML parts",
  );
  const text = decodedParts(message);
  assert(text.includes("Call Ada"), text);
  assert(text.includes("Reminder for Call Ada"), text);
  assert(
    text.includes(
      "https://kinship.test/app/people/11111111-1111-4111-8111-111111111111",
    ),
    text,
  );
  assert(!/token|password/i.test(text), "no secret material");
});

Deno.test("[PLANNING-003] a digest lists every reminder with its own link and escapes HTML", () => {
  const message = buildReminderMessage(options, {
    digestDate: "2026-10-20",
    idempotencyKey: "digest:abc",
    items: [
      { body: "First", personId: "person-a", title: "<b>Ada</b>" },
      { body: "Second", title: "Grace" },
    ],
    to: "owner@example.test",
  });
  assert(
    message.includes("Subject: Your Kinship reminders for 2026-10-20\r\n"),
    message,
  );
  const text = decodedParts(message);
  assert(text.includes("2 reminders"), text);
  assert(text.includes("https://kinship.test/app/people/person-a"), text);
  assert(text.includes("&lt;b&gt;Ada&lt;/b&gt;"), "the HTML part escapes");
  assert(!text.includes("<b>Ada</b></"), "raw markup never reaches HTML");
  assertEquals(
    text.match(/\/app\/people\//g)?.length,
    2,
    "only the reminder with a person links, once per part",
  );
});

Deno.test("[PLANNING-003] a subject outside ASCII is encoded and a header break is refused", () => {
  const message = buildReminderMessage(options, {
    idempotencyKey: "key",
    items: [{ body: "", title: "Café\r\nBcc: attacker@example.test" }],
    to: "owner@example.test",
  });
  const subject = message.split("\r\n").find((line) =>
    line.startsWith("Subject:")
  );
  assert(subject?.startsWith("Subject: =?UTF-8?B?"), `${subject}`);
  assert(!message.includes("\r\nBcc:"), "no injected header");
});

function scripted(
  replies: readonly string[],
  observed: string[] = [],
): ConstructorParameters<typeof SmtpReminderMail>[1] {
  const queue = [...replies];
  return () =>
    Promise.resolve({
      close: () => undefined,
      read: (buffer) => {
        const reply = queue.shift();
        if (reply === undefined) {
          return new Promise<number | null>(() => undefined);
        }
        if (reply === "") return Promise.resolve(null);
        const bytes = new TextEncoder().encode(reply);
        buffer.set(bytes);
        return Promise.resolve(bytes.length);
      },
      write: (buffer) => {
        observed.push(new TextDecoder().decode(buffer));
        return Promise.resolve(buffer.length);
      },
    });
}

const accepted = [
  "220 ready\r\n",
  "250 hello\r\n",
  "250 sender\r\n",
  "250 recipient\r\n",
  "354 content\r\n",
  "250 queued\r\n",
  "221 bye\r\n",
];

const message = {
  idempotencyKey: "key-1",
  items: [{ body: "body", title: "Call Ada" }],
  to: "owner@example.test",
};

Deno.test("[PLANNING-003] an accepted reminder email is confirmed with a stable receipt", async () => {
  const commands: string[] = [];
  const mail = new SmtpReminderMail(options, scripted(accepted, commands));
  assertEquals(await mail.send(message), {
    receipt: "smtp:key-1@kinship.test",
    status: "confirmed",
  });
  assert(commands.includes("RCPT TO:<owner@example.test>\r\n"), "recipient");
});

Deno.test("[PLANNING-003] an accepted email whose goodbye fails is still confirmed", async () => {
  const mail = new SmtpReminderMail(
    options,
    scripted(accepted.slice(0, -1).concat("")),
  );
  assertEquals((await mail.send(message)).status, "confirmed");
});

Deno.test("[PLANNING-003] SMTP refusals before the message is taken are never ambiguous", async () => {
  const unreachable = new SmtpReminderMail(
    options,
    () => Promise.reject(new Error("connection refused")),
  );
  assertEquals(await unreachable.send(message), {
    code: "smtp-unavailable",
    status: "transient",
  });
  const refused = new SmtpReminderMail(
    options,
    scripted([...accepted.slice(0, 3), "550 no such user\r\n"]),
  );
  assertEquals(await refused.send(message), {
    code: "smtp-rejected",
    status: "rejected",
  });
  const deferred = new SmtpReminderMail(
    options,
    scripted([...accepted.slice(0, 5), "451 try later\r\n"]),
  );
  assertEquals(await deferred.send(message), {
    code: "smtp-unavailable",
    status: "transient",
  });
});

Deno.test("[PLANNING-003] a lost answer to the message itself is ambiguous and cannot be reconciled", async () => {
  const mail = new SmtpReminderMail(
    { ...options, readTimeoutMs: 20 },
    scripted(accepted.slice(0, 5)),
  );
  assertEquals(await mail.send(message), {
    code: "smtp-unconfirmed",
    status: "ambiguous",
  });
  assertEquals(await mail.reconcile({ idempotencyKey: "key-1" }), {
    code: "smtp-unreconcilable",
    status: "ambiguous",
  });
});

Deno.test("[PLANNING-003] a message that cannot be built is rejected, never ambiguous", async () => {
  const commands: string[] = [];
  const mail = new SmtpReminderMail(options, scripted(accepted, commands));
  assertEquals(
    await mail.send({
      ...message,
      to: "owner@example.test\r\nBcc: attacker@example.test",
    }),
    { code: "reminder-mail-invalid", status: "rejected" },
  );
  assertEquals(commands, [], "nothing reached the server");
});

Deno.test("[PLANNING-003] the worker refuses a public origin it cannot link to", () => {
  for (const webOrigin of ["not an origin", "ftp://kinship.test", ""]) {
    assertThrows(
      () => new SmtpReminderMail({ ...options, webOrigin }),
      `${JSON.stringify(webOrigin)} is refused at configuration load`,
    );
  }
});

Deno.test("[PLANNING-003] a long non-ASCII subject folds into bounded encoded words", () => {
  const title = "Позвонить Аде ".repeat(15) + "😀 end";
  const built = buildReminderMessage(options, {
    idempotencyKey: "key",
    items: [{ body: "", title }],
    to: "owner@example.test",
  });
  const headers = built.split("\r\n\r\n")[0]!;
  const subject = headers.match(/^Subject:(?:.*)(?:\r\n[ \t].*)*/m)?.[0] ?? "";
  const lines = subject.split("\r\n");
  assert(lines.length > 1, "a long subject folds");
  for (const line of lines) {
    assert(line.length < 998, `header line of ${line.length} characters`);
    for (const word of line.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) {
      assert(word.length <= 75, `encoded word of ${word.length} characters`);
    }
  }
  const decoded = lines.flatMap((line) =>
    line.match(/=\?UTF-8\?B\?([^?]*)\?=/g) ?? []
  ).map((word) => word.slice(10, -2));
  const bytes = decoded.flatMap((part) => [...Uint8Array.fromBase64(part)]);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(bytes),
  );
  assert(
    text.startsWith("Reminder: Позвонить Аде") && text.endsWith("😀 end"),
    "every encoded word holds whole characters and the subject survives",
  );
  const long = buildReminderMessage(options, {
    idempotencyKey: "key",
    items: [{ body: "", title: "😀".repeat(2_000) }],
    to: "owner@example.test",
  });
  const longSubject = long.split("\r\n\r\n")[0]!.match(
    /^Subject:(?:.*)(?:\r\n[ \t].*)*/m,
  )?.[0] ?? "";
  const cut = new TextDecoder("utf-8", { fatal: true }).decode(
    new Uint8Array(
      (longSubject.match(/=\?UTF-8\?B\?([^?]*)\?=/g) ?? []).flatMap((
        word,
      ) => [...Uint8Array.fromBase64(word.slice(10, -2))]),
    ),
  );
  assert(
    [...cut].length === 300 && cut.endsWith("…"),
    `a very long title is cut at a character boundary: ${[...cut].length}`,
  );
});
