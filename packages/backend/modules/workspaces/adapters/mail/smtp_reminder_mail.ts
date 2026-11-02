/**
 * Reminder email over the deployment's SMTP transport (PLANNING-003).
 *
 * Planning owns when a reminder is due and what it says; this adapter owns
 * what the email looks like and how the answer of an SMTP server maps to the
 * provider outcomes planning reasons about. A message the server never took is
 * `transient`, or `rejected` when it refused it permanently. A message that was
 * written but never answered may have been delivered, so it is `ambiguous`,
 * and because SMTP cannot be asked afterwards, reconciling it stays ambiguous:
 * the worker never sends it again.
 *
 * Every email names the reminder, its body snapshot, and an absolute link to
 * the person's workspace built from the configured public origin. When the
 * reminder's date is known, the email names it and says how far ahead it is,
 * so an advance notice never reads as the day itself, and points at the
 * workspace reminder rules that set advance notices. It carries no token,
 * credential, or anything beyond what the reminder already says.
 */

import {
  safeHeader,
  SmtpDeliveryError,
  SmtpMailTransport,
  type SmtpVerificationMailOptions,
} from "./smtp_verification_mail.ts";

/** One reminder in an email. */
export interface ReminderMailItem {
  readonly body: string;
  /** How many days before its date this notice is sent; 0 or absent: on it. */
  readonly leadDays?: number;
  /** The reminder's own date (`YYYY-MM-DD`), when known. */
  readonly occursOn?: string;
  readonly personId?: string;
  readonly title: string;
}

/** One reminder email: a single reminder, or a digest when dated. */
export interface ReminderMailMessage {
  readonly digestDate?: string;
  readonly idempotencyKey: string;
  readonly items: readonly ReminderMailItem[];
  readonly to: string;
}

/** What the SMTP server's answer means for the reminder that was sent. */
export type ReminderMailResult =
  | { readonly receipt: string; readonly status: "confirmed" }
  | {
    readonly code: string;
    readonly status: "ambiguous" | "rejected" | "transient";
  };

type ReminderMailOptions = Pick<
  SmtpVerificationMailOptions,
  "from" | "webOrigin"
>;

const BOUNDARY = "kinship-reminder-part";

/** One line of text, with every line break folded to a space. */
function line(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

/** How many UTF-8 bytes one RFC 2047 `B` word carries within 75 characters. */
const ENCODED_WORD_BYTES = 45;

/** The longest subject kept; the rest is cut at a character boundary. */
const MAXIMUM_SUBJECT_CHARACTERS = 300;

/**
 * A header value, folded onto continuation lines as RFC 2047 encoded words
 * when it is not ASCII. Each word is at most 75 characters and holds whole
 * characters only, so every line stays far below the 998-character limit and
 * a word never splits a character between two decodings.
 */
function headerText(value: string): string {
  const characters = [...line(value)];
  const text = characters.length > MAXIMUM_SUBJECT_CHARACTERS
    ? `${characters.slice(0, MAXIMUM_SUBJECT_CHARACTERS - 1).join("")}…`
    : characters.join("");
  if (/^[\x20-\x7e]*$/.test(text)) return safeHeader(text);
  const encoder = new TextEncoder();
  const words: string[] = [];
  let bytes: number[] = [];
  for (const character of text) {
    const encoded = [...encoder.encode(character)];
    if (bytes.length + encoded.length > ENCODED_WORD_BYTES) {
      words.push(new Uint8Array(bytes).toBase64());
      bytes = [];
    }
    bytes.push(...encoded);
  }
  if (bytes.length > 0) words.push(new Uint8Array(bytes).toBase64());
  return words.map((word) => `=?UTF-8?B?${word}?=`).join("\r\n ");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** The message identifier the idempotency key names, on the sender's domain. */
function messageId(options: ReminderMailOptions, key: string): string {
  const local = key.replaceAll(/[^A-Za-z0-9-]+/g, ".").slice(0, 120) ||
    "reminder";
  return `${local}@${options.from.split("@")[1]}`;
}

function personLink(
  options: ReminderMailOptions,
  item: ReminderMailItem,
): string | undefined {
  return item.personId
    ? new URL(
      `/app/people/${encodeURIComponent(item.personId)}`,
      options.webOrigin,
    ).toString()
    : undefined;
}

/** Where a workspace's advance-notice rules are changed. */
function reminderRulesLink(options: ReminderMailOptions): string {
  return new URL(
    "/app/settings/personalization?section=reminder-rules",
    options.webOrigin,
  ).toString();
}

/** When a reminder falls, in long and short form, and how far away it is. */
interface ReminderWhen {
  readonly ahead: boolean;
  readonly long: string;
  readonly relative: string;
  readonly short: string;
}

function calendarDate(
  occursOn: string,
  format: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("en-US", { ...format, timeZone: "UTC" })
    .format(new Date(`${occursOn}T12:00:00Z`));
}

/** An item's date, or nothing when it has none it can name. */
function whenOf(item: ReminderMailItem): ReminderWhen | undefined {
  const occursOn = item.occursOn;
  if (!occursOn || !/^\d{4}-\d{2}-\d{2}$/.test(occursOn)) return undefined;
  if (Number.isNaN(Date.parse(`${occursOn}T12:00:00Z`))) return undefined;
  const days = Math.max(0, Math.trunc(item.leadDays ?? 0));
  return {
    ahead: days > 0,
    long: calendarDate(occursOn, {
      day: "numeric",
      month: "long",
      weekday: "long",
      year: "numeric",
    }),
    relative: days === 0
      ? "today"
      : days === 1
      ? "tomorrow"
      : `in ${days} days`,
    short: calendarDate(occursOn, { day: "numeric", month: "long" }),
  };
}

/** A body part, base64-encoded in lines a mail server keeps intact. */
function part(contentType: string, content: string): string {
  const encoded = new TextEncoder().encode(content).toBase64();
  return [
    `--${BOUNDARY}`,
    `Content-Type: ${contentType}; charset=utf-8`,
    "Content-Transfer-Encoding: base64",
    "",
    ...(encoded.match(/.{1,76}/g) ?? []),
  ].join("\r\n");
}

export function buildReminderMessage(
  options: ReminderMailOptions,
  message: ReminderMailMessage,
): string {
  const items = message.items.map((item) => {
    const when = whenOf(item);
    return {
      body: line(item.body),
      link: personLink(options, item),
      title: line(item.title) || "Reminder",
      when,
      whenLine: when ? `When: ${when.long} (${when.relative})` : undefined,
    };
  });
  const digest = message.digestDate !== undefined;
  const first = items[0];
  const subject = digest
    ? `Your Kinship reminders for ${message.digestDate}`
    : `Reminder: ${first?.title ?? "Reminder"}${
      first?.when
        ? first.when.ahead
          ? ` - ${first.when.relative}, on ${first.when.short}`
          : " - today"
        : ""
    }`;
  const intro = digest
    ? `You have ${items.length} ${
      items.length === 1 ? "reminder" : "reminders"
    } due.`
    : first?.when?.ahead
    ? `Advance notice: this is coming up ${first.when.relative}.`
    : first?.when
    ? "A Kinship reminder is due today."
    : "A Kinship reminder is due.";
  const rules = items.some((item) => item.when?.ahead)
    ? {
      link: reminderRulesLink(options),
      text: "Advance notices follow your workspace reminder rules.",
    }
    : undefined;
  const text = [
    intro,
    "",
    ...items.flatMap((item) => [
      digest ? `- ${item.title}` : item.title,
      ...(item.whenLine ? [item.whenLine] : []),
      ...(item.body ? [item.body] : []),
      ...(item.link ? [`Open in Kinship: ${item.link}`] : []),
      "",
    ]),
    ...(rules ? [`${rules.text} Change them: ${rules.link}`] : []),
  ].join("\r\n");
  const html = [
    "<!doctype html>",
    `<html><body><p>${escapeHtml(intro)}</p><ul>`,
    ...items.map((item) =>
      `<li><strong>${escapeHtml(item.title)}</strong>${
        item.whenLine ? `<br>${escapeHtml(item.whenLine)}` : ""
      }${item.body ? `<br>${escapeHtml(item.body)}` : ""}${
        item.link
          ? `<br><a href="${escapeHtml(item.link)}">Open in Kinship</a>`
          : ""
      }</li>`
    ),
    "</ul>",
    ...(rules
      ? [
        `<p>${escapeHtml(rules.text)} <a href="${
          escapeHtml(rules.link)
        }">Change them</a></p>`,
      ]
      : []),
    "</body></html>",
  ].join("\r\n");
  return [
    `From: Kinship <${safeHeader(options.from)}>`,
    `To: ${safeHeader(message.to)}`,
    `Subject: ${headerText(subject)}`,
    `Message-ID: <${messageId(options, message.idempotencyKey)}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${BOUNDARY}"`,
    "",
    part("text/plain", text),
    part("text/html", html),
    `--${BOUNDARY}--`,
  ].join("\r\n");
}

/**
 * The origin reminder links are built from, refused at configuration load
 * when it is not an absolute HTTP(S) origin: a worker that could not link to a
 * person would otherwise find out one email at a time.
 */
function reminderOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_WEB_ORIGIN must be an absolute http(s) origin.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("PUBLIC_WEB_ORIGIN must be an absolute http(s) origin.");
  }
  return url.origin;
}

export class SmtpReminderMail {
  readonly #transport: SmtpMailTransport;

  constructor(
    private readonly options: SmtpVerificationMailOptions,
    connect?: ConstructorParameters<typeof SmtpMailTransport>[1],
  ) {
    reminderOrigin(options.webOrigin);
    this.#transport = new SmtpMailTransport(options, connect);
  }

  async send(message: ReminderMailMessage): Promise<ReminderMailResult> {
    let content: string;
    try {
      content = buildReminderMessage(this.options, message);
    } catch {
      // Nothing left the process: a message that cannot be built is a
      // permanent failure to fix, never an attempt that may have landed.
      return { code: "reminder-mail-invalid", status: "rejected" };
    }
    try {
      await this.#transport.send(message.to, content);
    } catch (error) {
      const stage = error instanceof SmtpDeliveryError
        ? error.stage
        : "unconfirmed";
      if (stage === "unconfirmed") {
        return { code: "smtp-unconfirmed", status: "ambiguous" };
      }
      if (stage === "refused") {
        return error instanceof SmtpDeliveryError && error.permanent
          ? { code: "smtp-rejected", status: "rejected" }
          : { code: "smtp-unavailable", status: "transient" };
      }
    }
    return {
      receipt: `smtp:${messageId(this.options, message.idempotencyKey)}`,
      status: "confirmed",
    };
  }

  /** SMTP cannot say what became of an earlier message, so this never can. */
  reconcile(_command: {
    readonly idempotencyKey: string;
  }): Promise<ReminderMailResult> {
    return Promise.resolve({
      code: "smtp-unreconcilable",
      status: "ambiguous",
    });
  }
}
