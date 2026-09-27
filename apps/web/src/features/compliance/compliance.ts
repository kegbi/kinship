/**
 * The required legal review's state (GAP-033): the document version the
 * member must accept, whether they confirmed reviewing it, and which of
 * accepting or declining is in flight. A pure reducer with the words the
 * page shows; `compliance.tsx` renders it.
 */

import type { LegalDocument } from "../../../../../packages/contracts/generated/auth-client.ts";

export interface ComplianceState {
  readonly document: LegalDocument | undefined;
  readonly status: string;
  readonly confirmed: boolean;
  readonly accepting: boolean;
  readonly declining: boolean;
}

export type ComplianceAction =
  | { readonly type: "checking" }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "review"; readonly document: LegalDocument }
  | { readonly type: "confirm"; readonly confirmed: boolean }
  | { readonly type: "accepting"; readonly accepting: boolean }
  | { readonly type: "declining"; readonly declining: boolean }
  | { readonly type: "decline-failed" };

export const CHECKING = "Checking required legal documents…";

export const initialCompliance: ComplianceState = {
  accepting: false,
  confirmed: false,
  declining: false,
  document: undefined,
  status: CHECKING,
};

export function complianceReducer(
  state: ComplianceState,
  action: ComplianceAction,
): ComplianceState {
  switch (action.type) {
    case "checking":
      return { ...state, document: undefined, status: CHECKING };
    case "status":
      return { ...state, status: action.message };
    case "review":
      return {
        ...state,
        confirmed: false,
        document: action.document,
        status: "Review the exact version before continuing.",
      };
    case "confirm":
      return { ...state, confirmed: action.confirmed };
    case "accepting":
      return {
        ...state,
        accepting: action.accepting,
        ...(action.accepting ? { status: "Recording acceptance…" } : {}),
      };
    case "declining":
      return {
        ...state,
        declining: action.declining,
        ...(action.declining
          ? { status: "Leaving the protected workspace…" }
          : {}),
      };
    case "decline-failed":
      return {
        ...state,
        declining: false,
        status: "Sign-out could not be completed. Try again.",
      };
  }
}

/** A document's title as the review names it. */
export function documentTitle(document: LegalDocument): string {
  return document.documentType === "terms"
    ? "Terms of service"
    : document.documentType === "privacy"
    ? "Privacy policy"
    : "Required policy";
}

/**
 * Where the review continues once nothing is left to accept: the protected
 * path `next` names, or Today when it names anything else, including the
 * review itself.
 */
export function safeNext(search: string): string {
  const requested = new URLSearchParams(search).get("next");
  return (requested === "/app" || requested?.startsWith("/app/")) &&
      !requested.startsWith("/app/compliance")
    ? requested
    : "/app";
}
