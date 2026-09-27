import { describe, expect, it } from "vitest";
import type { LegalDocument } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  CHECKING,
  complianceReducer,
  documentTitle,
  initialCompliance,
  safeNext,
} from "./compliance.ts";

const document = { documentType: "terms", id: "d" } as LegalDocument;

describe("GOVERNANCE-001 legal review state", () => {
  it("reviews one version and holds each action in flight", () => {
    const review = complianceReducer(
      complianceReducer(initialCompliance, {
        confirmed: true,
        type: "confirm",
      }),
      { document, type: "review" },
    );
    expect(review).toMatchObject({
      confirmed: false,
      document,
      status: "Review the exact version before continuing.",
    });
    const accepting = complianceReducer(review, {
      accepting: true,
      type: "accepting",
    });
    expect(accepting.status).toBe("Recording acceptance…");
    expect(
      complianceReducer(accepting, { accepting: false, type: "accepting" }),
    )
      .toMatchObject({ accepting: false, status: "Recording acceptance…" });
    const declining = complianceReducer(review, {
      declining: true,
      type: "declining",
    });
    expect(declining.status).toBe("Leaving the protected workspace…");
    expect(
      complianceReducer(declining, { declining: false, type: "declining" }),
    )
      .toMatchObject({ declining: false });
    expect(complianceReducer(declining, { type: "decline-failed" }))
      .toMatchObject({
        declining: false,
        status: "Sign-out could not be completed. Try again.",
      });
    expect(complianceReducer(review, { type: "checking" })).toMatchObject({
      document: undefined,
      status: CHECKING,
    });
    expect(complianceReducer(review, { message: "m", type: "status" }).status)
      .toBe("m");
  });

  it("names each document and continues only to a protected path", () => {
    expect(documentTitle(document)).toBe("Terms of service");
    expect(documentTitle({ ...document, documentType: "privacy" })).toBe(
      "Privacy policy",
    );
    expect(
      documentTitle({ ...document, documentType: "cookies" as "terms" }),
    ).toBe("Required policy");
    expect(safeNext("?next=%2Fapp")).toBe("/app");
    expect(safeNext("?next=%2Fapp%2Fpeople")).toBe("/app/people");
    expect(safeNext("?next=%2Fapp%2Fcompliance%2Fx")).toBe("/app");
    expect(safeNext("?next=https%3A%2F%2Fevil.example")).toBe("/app");
  });
});
