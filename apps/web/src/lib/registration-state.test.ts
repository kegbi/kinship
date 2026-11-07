import { registrationMessage } from "./registration-state.ts";

import { describe, expect, it } from "vitest";

describe("registration state", () => {
  it("maps safe API outcomes to useful visible copy", () => {
    expect(registrationMessage("registration_failed")).toMatch(
      /nothing was created/i,
    );
    expect(registrationMessage("unknown")).not.toMatch(/stack|database|token/i);
  });

  it("[AUD-A1] never says that an address is already registered", () => {
    expect(registrationMessage("duplicate_email")).toBe(
      registrationMessage("unknown"),
    );
    expect(registrationMessage("duplicate_email")).not.toMatch(/already/i);
  });
});
