import type { VerificationMail } from "../../public.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SmtpVerificationMailOptions {
  readonly connectTimeoutMs?: number;
  readonly from: string;
  readonly environment: string;
  readonly host: string;
  readonly port: number;
  readonly readTimeoutMs?: number;
  readonly webOrigin: string;
  readonly writeTimeoutMs?: number;
}

export function plainSmtpPolicy(environment: string, host: string): void {
  if (environment !== "development" && environment !== "test") {
    throw new Error(
      "Plain SMTP is available only for development/test capture delivery.",
    );
  }
  if (
    host !== "127.0.0.1" && host !== "localhost" && host !== "::1" &&
    host !== "mailpit"
  ) {
    throw new Error("Plain SMTP host must be an explicit local capture host.");
  }
}

function safeSender(value: string): string {
  const mailbox =
    /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
  if (value.length > 254 || !mailbox.test(value)) {
    throw new Error("SMTP_FROM must be one safe mailbox address.");
  }
  return value;
}

interface SmtpTimeouts {
  readonly connectTimeoutMs: number;
  readonly readTimeoutMs: number;
  readonly writeTimeoutMs: number;
}

export function smtpTimeouts(
  options: Pick<
    SmtpVerificationMailOptions,
    "connectTimeoutMs" | "readTimeoutMs" | "writeTimeoutMs"
  >,
): SmtpTimeouts {
  const resolved = {
    connectTimeoutMs: options.connectTimeoutMs ?? 5_000,
    readTimeoutMs: options.readTimeoutMs ?? 5_000,
    writeTimeoutMs: options.writeTimeoutMs ?? 5_000,
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isFinite(value) || value < 1 || value > 30_000) {
      throw new Error(`${name} must be between 1 and 30000 milliseconds.`);
    }
  }
  return resolved;
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out.`)),
      timeoutMs,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function safeHeader(value: string): string {
  if (value.includes("\r") || value.includes("\n")) {
    throw new Error("Invalid mail header.");
  }
  return value;
}

export function buildVerificationMessage(
  options: Pick<SmtpVerificationMailOptions, "from" | "webOrigin">,
  message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  },
): string {
  const verificationUrl = new URL("/auth/verify-email", options.webOrigin);
  verificationUrl.searchParams.set("token", message.token);
  return [
    `From: Kinship <${safeHeader(options.from)}>`,
    `To: ${safeHeader(message.email)}`,
    "Subject: Verify your Kinship email",
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    "Finish creating your private Kinship workspace:",
    verificationUrl.toString(),
    "",
    `This single-use link expires at ${message.expiresAt.toISOString()}.`,
    "If you did not request this, you can ignore this email.",
  ].join("\r\n");
}

async function readReply(
  connection: Deno.TcpConn,
  timeoutMs: number,
): Promise<number> {
  const buffer = new Uint8Array(2_048);
  let reply = "";
  while (true) {
    const size = await withTimeout(
      connection.read(buffer),
      timeoutMs,
      "SMTP read",
    );
    if (size === null) throw new Error("SMTP connection closed unexpectedly.");
    reply += decoder.decode(buffer.subarray(0, size));
    const lines = reply.split("\r\n").filter(Boolean);
    const finalLine = lines.at(-1);
    if (finalLine && /^\d{3} /.test(finalLine)) {
      return Number(finalLine.slice(0, 3));
    }
  }
}

async function command(
  connection: Deno.TcpConn,
  value: string,
  acceptedCodes: readonly number[],
  timeouts: Pick<SmtpTimeouts, "readTimeoutMs" | "writeTimeoutMs">,
): Promise<void> {
  await withTimeout(
    connection.write(encoder.encode(`${value}\r\n`)),
    timeouts.writeTimeoutMs,
    "SMTP write",
  );
  const code = await readReply(connection, timeouts.readTimeoutMs);
  if (!acceptedCodes.includes(code)) throw new Error("SMTP delivery rejected.");
}

export class SmtpVerificationMail implements VerificationMail {
  readonly #timeouts: SmtpTimeouts;

  constructor(private readonly options: SmtpVerificationMailOptions) {
    plainSmtpPolicy(options.environment, options.host);
    if (
      !Number.isInteger(options.port) || options.port < 1 ||
      options.port > 65_535
    ) {
      throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
    }
    safeSender(options.from);
    this.#timeouts = smtpTimeouts(options);
  }

  async sendVerification(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void> {
    const pendingConnection = Deno.connect({
      hostname: this.options.host,
      port: this.options.port,
      transport: "tcp",
    });
    let connection: Deno.TcpConn;
    try {
      connection = await withTimeout(
        pendingConnection,
        this.#timeouts.connectTimeoutMs,
        "SMTP connect",
      );
    } catch (error) {
      pendingConnection.then((late) => late.close(), () => undefined);
      throw error;
    }
    try {
      const greeting = await readReply(
        connection,
        this.#timeouts.readTimeoutMs,
      );
      if (greeting !== 220) throw new Error("SMTP service unavailable.");
      await command(connection, "EHLO kinship.local", [250], this.#timeouts);
      await command(
        connection,
        `MAIL FROM:<${safeHeader(this.options.from)}>`,
        [250],
        this.#timeouts,
      );
      await command(
        connection,
        `RCPT TO:<${safeHeader(message.email)}>`,
        [250, 251],
        this.#timeouts,
      );
      await command(connection, "DATA", [354], this.#timeouts);
      const body = buildVerificationMessage(this.options, message)
        .replaceAll("\r\n.", "\r\n..");
      await command(connection, `${body}\r\n.`, [250], this.#timeouts);
      await command(connection, "QUIT", [221], this.#timeouts);
    } finally {
      connection.close();
    }
  }
}
