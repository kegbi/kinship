/**
 * Registration and email verification, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { request } from "./request.ts";
import type { ApplicationEntry, RegistrationInput } from "./types.ts";

export function register(
  input: RegistrationInput,
): Promise<ApiResult<{ readonly status: "verification-required" }>> {
  return request("/api/v1/registrations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function retryVerificationDelivery(
  email: string,
): Promise<ApiResult<{ readonly status: "accepted" }>> {
  return request("/api/v1/email-verification-deliveries", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyEmail(
  token: string,
): Promise<
  ApiResult<
    { readonly status: "verified"; readonly next: "/app" | "/invite/continue" }
  >
> {
  return request("/api/v1/email-verifications", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export function consumeApplicationEntry(): Promise<
  ApiResult<ApplicationEntry>
> {
  return request("/api/v1/application-entry", { method: "POST" });
}
