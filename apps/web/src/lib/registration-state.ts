/**
 * What a refused registration says. There is no "already registered" answer
 * (SECA-02): the API never tells a caller whether an address has an account,
 * so the page has nothing to say about it either.
 */
export function registrationMessage(code: string): string {
  if (code === "registration_failed") {
    return "Nothing was created. Please try again.";
  }
  return "Registration is temporarily unavailable. Please try again.";
}
