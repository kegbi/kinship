import { type APIRequestContext, expect } from "@playwright/test";
import { mailOrigin } from "./env.ts";

/*
 * Mail capture through the test Compose project's Mailpit. Every helper polls
 * Mailpit's search for messages addressed to `email` until it finds what it
 * needs.
 */

/**
 * Reads one message's text and returns the token it carries, or `previous`
 * when it carries none of interest. Messages are read in Mailpit's search
 * order, so the last matching message wins unless `stopOnToken` is set.
 */
export type TokenReader = (
  text: string,
  previous: string | undefined,
) => string | undefined;

const tokenLink = /https?:\/\/\S+\?token=\S+/;

/** The token of any `?token=` browser link. */
export const linkToken: TokenReader = (text, previous) => {
  const link = text.match(tokenLink)?.[0];
  if (!link) return previous;
  const candidate = new URL(link).searchParams.get("token");
  return candidate ? candidate : previous;
};

/** The token of the email-verification browser link. */
export const verifyEmailLinkToken: TokenReader = (text, previous) => {
  const link = text.match(tokenLink)?.[0];
  if (link && new URL(link).pathname === "/auth/verify-email") {
    return new URL(link).searchParams.get("token") ?? undefined;
  }
  return previous;
};

/** Whatever follows the first `token=` in the text. */
export const bareToken: TokenReader = (text, previous) =>
  text.match(/token=([^\s]+)/)?.[1] ?? previous;

/**
 * The token of the first `?token=` browser link to `path` other than
 * `exclude`; use with `stopOnToken`.
 */
export function pathLinkToken(path: string, exclude?: string): TokenReader {
  return (text, previous) => {
    const link = text.match(tokenLink)?.[0];
    if (!link) return previous;
    const url = new URL(link);
    if (url.pathname === path) {
      const candidate = url.searchParams.get("token") ?? undefined;
      if (candidate && candidate !== exclude) return candidate;
    }
    return previous;
  };
}

export interface MailTokenOptions {
  /** Stop reading a search's messages once one yields a token. */
  readonly stopOnToken?: boolean;
}

/** Polls Mailpit until `read` finds a token in a message to `email`. */
export async function mailToken(
  request: APIRequestContext,
  email: string,
  read: TokenReader,
  options: MailTokenOptions = {},
): Promise<string> {
  let token: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    for (const message of body.messages ?? []) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      const content = await detail.json() as { Text?: string };
      token = read(content.Text ?? "", token);
      if (options.stopOnToken && token) break;
    }
    return token;
  }).toBeTruthy();
  return token!;
}

/**
 * Polls Mailpit until a message to `email` matches `pattern` and returns the
 * text of the last such message.
 */
export async function mailText(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
): Promise<string> {
  let text: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    for (const message of body.messages ?? []) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      const content = await detail.json() as { Text?: string };
      if (content.Text && pattern.test(content.Text)) text = content.Text;
    }
    return text;
  }).toBeTruthy();
  return text!;
}
