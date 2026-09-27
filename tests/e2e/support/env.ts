/**
 * The E2E origins and the shared test password. Product actions use the one
 * public gateway origin, never a private API origin.
 */
export const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
export const mailOrigin = process.env.TEST_MAIL_ORIGIN ??
  "http://127.0.0.1:18025";
export const password = "correct horse battery staple";
