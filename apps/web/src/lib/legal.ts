/**
 * The public privacy and terms pages' document (GAP-033). A public page
 * ships no React, so this helper only reads the published version and sets
 * the text of the elements the page drew; it creates none. The protected
 * required legal review is an island (`features/compliance/`).
 */

import { formatInstant } from "./time-presentation.ts";
import { getPublicLegalDocument } from "../../../../packages/contracts/generated/auth-client.ts";

export async function mountPublicLegal(
  documentType: "privacy" | "terms",
): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-legal-state]");
  const title = document.querySelector<HTMLElement>("[data-legal-title]");
  const version = document.querySelector<HTMLElement>("[data-legal-version]");
  const content = document.querySelector<HTMLElement>("[data-legal-content]");
  if (!state || !title || !version || !content) return;
  const result = await getPublicLegalDocument(documentType).catch(() =>
    undefined
  );
  if (!result?.ok) {
    state.textContent = "This legal document is temporarily unavailable.";
    return;
  }
  title.textContent = documentType === "terms"
    ? "Terms of service"
    : "Privacy policy";
  version.textContent = `Version ${result.value.document.version}${
    result.value.document.publishedAt
      ? ` · Published ${
        formatInstant(result.value.document.publishedAt, {
          locale: "en",
          effectiveTimezone: "UTC",
        })
      }`
      : ""
  }`;
  content.textContent = result.value.document.content;
  state.textContent = "";
}
