import { registrationMessage } from "./registration-state.ts";

import { describe, expect, it } from "vitest";

describe("registration state", () => {
  it("maps safe API outcomes to useful visible copy", () => {
    expect(registrationMessage("duplicate_email")).toMatch(/already uses/i);
    expect(registrationMessage("registration_failed")).toMatch(
      /nothing was created/i,
    );
    expect(registrationMessage("unknown")).not.toMatch(/stack|database|token/i);
  });
});
