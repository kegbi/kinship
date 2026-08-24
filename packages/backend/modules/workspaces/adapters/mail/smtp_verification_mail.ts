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
  readonly security?: "plain" | "tls";
  readonly username?: string;
  readonly password?: string;
  readonly webOrigin: string;
  readonly writeTimeoutMs?: number;
}

interface EnvironmentReader {
  get(name: string): string | undefined;
}

export function resolveSmtpVerificationMailOptions(
  environment: EnvironmentReader,
): SmtpVerificationMailOptions {
  const applicationEnvironment = environment.get("APP_ENV") ?? "development";
  const security = environment.get("SMTP_SECURITY") ?? "plain";
  if (security !== "plain" && security !== "tls") {
    throw new Error("SMTP_SECURITY must be plain or tls.");
  }
  const username = environment.get("SMTP_USERNAME") || undefined;
  const password = environment.get("SMTP_PASSWORD") || undefined;
  return {
    environment: applicationEnvironment,
    from: environment.get("SMTP_FROM") ?? "hello@kinship.local",
    host: environment.get("SMTP_HOST") ?? "127.0.0.1",
    ...(password === undefined ? {} : { password }),
    port: Number(environment.get("SMTP_PORT") ?? "1025"),
    security,
    ...(username === undefined ? {} : { username }),
    webOrigin: environment.get("PUBLIC_WEB_ORIGIN") ??
      "http://127.0.0.1:4321",
  };
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

interface SmtpConnection {
  close(): void;
  read(buffer: Uint8Array): Promise<number | null>;
  write(buffer: Uint8Array): Promise<number>;
}

type SmtpConnector = (
  security: "plain" | "tls",
  host: string,
  port: number,
) => Promise<SmtpConnection>;

const connectSmtp: SmtpConnector = (security, host, port) =>
  security === "tls"
    ? Deno.connectTls({ hostname: host, port })
    : Deno.connect({ hostname: host, port, transport: "tcp" });

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

export function buildPasswordResetMessage(
  options: Pick<SmtpVerificationMailOptions, "from" | "webOrigin">,
  message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  },
): string {
  const resetUrl = new URL("/auth/reset-password", options.webOrigin);
  resetUrl.searchParams.set("token", message.token);
  return [
    `From: Kinship <${safeHeader(options.from)}>`,
    `To: ${safeHeader(message.email)}`,
    "Subject: Reset your Kinship password",
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    "Use this single-use link to reset your Kinship password:",
    resetUrl.toString(),
    "",
    `This link expires at ${message.expiresAt.toISOString()}.`,
    "If you did not request this, you can ignore this email.",
  ].join("\r\n");
}

export function buildInvitationMessage(
  options: Pick<SmtpVerificationMailOptions, "from" | "webOrigin">,
  message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
    readonly workspaceName: string;
  },
): string {
  const invitationUrl = new URL(
    `/invite/${encodeURIComponent(message.token)}`,
    options.webOrigin,
  );
  return [
    `From: Kinship <${safeHeader(options.from)}>`,
    `To: ${safeHeader(message.email)}`,
    `Subject: Join ${safeHeader(message.workspaceName)} on Kinship`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    `You were invited to join ${message.workspaceName} on Kinship:`,
    invitationUrl.toString(),
    "",
    `This single-use link expires at ${message.expiresAt.toISOString()}.`,
    "If you did not expect this invitation, you can ignore this email.",
  ].join("\r\n");
}

async function readReply(
  connection: SmtpConnection,
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
  connection: SmtpConnection,
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

  constructor(
    private readonly options: SmtpVerificationMailOptions,
    private readonly connect: SmtpConnector = connectSmtp,
  ) {
    const security = options.security ?? "plain";
    if (security === "plain") {
      plainSmtpPolicy(options.environment, options.host);
    } else if (security !== "tls") {
      throw new Error("SMTP_SECURITY must be plain or tls.");
    }
    if ((options.username === undefined) !== (options.password === undefined)) {
      throw new Error(
        "SMTP_USERNAME and SMTP_PASSWORD must be configured together.",
      );
    }
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
    await this.#send(
      message.email,
      buildVerificationMessage(this.options, message),
    );
  }

  async sendPasswordReset(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void> {
    await this.#send(
      message.email,
      buildPasswordResetMessage(this.options, message),
    );
  }

  async sendInvitation(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
    readonly workspaceName: string;
  }): Promise<void> {
    await this.#send(
      message.email,
      buildInvitationMessage(this.options, message),
    );
  }

  async #send(email: string, content: string): Promise<void> {
    const pendingConnection = this.connect(
      this.options.security ?? "plain",
      this.options.host,
      this.options.port,
    );
    let connection: SmtpConnection;
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
      if (this.options.username !== undefined) {
        await command(connection, "AUTH LOGIN", [334], this.#timeouts);
        await command(
          connection,
          encoder.encode(this.options.username).toBase64(),
          [334],
          this.#timeouts,
        );
        await command(
          connection,
          encoder.encode(this.options.password ?? "").toBase64(),
          [235],
          this.#timeouts,
        );
      }
      await command(
        connection,
        `MAIL FROM:<${safeHeader(this.options.from)}>`,
        [250],
        this.#timeouts,
      );
      await command(
        connection,
        `RCPT TO:<${safeHeader(email)}>`,
        [250, 251],
        this.#timeouts,
      );
      await command(connection, "DATA", [354], this.#timeouts);
      const body = content.replaceAll("\r\n.", "\r\n..");
      await command(connection, `${body}\r\n.`, [250], this.#timeouts);
      await command(connection, "QUIT", [221], this.#timeouts);
    } finally {
      connection.close();
    }
  }
}
