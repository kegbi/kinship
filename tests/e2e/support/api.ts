import { type APIRequestContext, expect } from "@playwright/test";
import { origin, password } from "./env.ts";
import {
  mailToken,
  type MailTokenOptions,
  type TokenReader,
  verifyEmailLinkToken,
} from "./mail.ts";

/* API fixtures: account and person setup through the public gateway. */

export interface Registration {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly workspaceName: string;
}

/** Registers a first workspace owner; expects the API's 202. */
export async function register(
  request: APIRequestContext,
  registration: Registration,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: { ...registration, password },
  })).status()).toBe(202);
}

/**
 * Verifies `email` with the token `read` finds in its mail; expects the API's
 * 200.
 */
export async function verifyEmail(
  request: APIRequestContext,
  email: string,
  read: TokenReader = verifyEmailLinkToken,
  options: MailTokenOptions = {},
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await mailToken(request, email, read, options) },
  })).status()).toBe(200);
}

/** Registers and verifies a first workspace owner through the API. */
export async function registerVerified(
  request: APIRequestContext,
  registration: Registration,
  read: TokenReader = verifyEmailLinkToken,
  options: MailTokenOptions = {},
): Promise<void> {
  await register(request, registration);
  await verifyEmail(request, registration.email, read, options);
}

export interface PersonName {
  readonly givenName: string;
  readonly familyName?: string;
}

/**
 * Creates a person in the session's active workspace through the API and
 * returns its id; expects the API's 201. `request` is the signed-in page's
 * `page.request`.
 */
export async function createPerson(
  request: APIRequestContext,
  name: PersonName,
): Promise<string> {
  const response = await request.post(`${origin}/api/v1/people`, {
    data: { ...name, isPartial: false },
    headers: { origin },
  });
  expect(response.status()).toBe(201);
  return (await response.json() as { person: { id: string } }).person.id;
}
