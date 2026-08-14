export function registrationMessage(code: string): string {
  if (code === "duplicate_email") {
    return "An account already uses that email address.";
  }
  if (code === "registration_failed") {
    return "Nothing was created. Please try again.";
  }
  return "Registration is temporarily unavailable. Please try again.";
}
