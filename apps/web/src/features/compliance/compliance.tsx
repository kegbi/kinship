/**
 * The required legal review (GAP-033): the exact document version a member
 * must accept before entering the workspace, as one island over the page
 * `pages/app/compliance.astro` drew.
 *
 * One read slot checks the requirements. Accept stays disabled until the
 * reader confirms reviewing this exact version; once accepted, or when an
 * acceptance is refused, the requirements are read again, and the review
 * continues to the protected path it was asked for once none remain.
 * Declining signs out and follows only the destination the server names.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import {
  acceptLegalDocument,
  getLegalRequirements,
  signOut,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../islands/core/index.ts";
import {
  clearSessionCache,
  readActiveWorkspace,
} from "../../lib/workspace-context.ts";
import { browserNavigate, type Navigate } from "../settings/shared/context.ts";
import {
  complianceReducer,
  documentTitle,
  initialCompliance,
  safeNext,
} from "./compliance.ts";

export const COMPLIANCE_ISLAND = "compliance-review";

export function ComplianceReview(
  props: { readonly navigate: Navigate; readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(complianceReducer, initialCompliance);
  const request = useLatestRequest();
  const accepting = useRef(false);
  const settled = useRef(props.onSettled);
  const { navigate } = props;

  const refresh = async () => {
    dispatch({ type: "checking" });
    const answer = await request(() =>
      getLegalRequirements(readActiveWorkspace())
    );
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: "Required legal documents cannot be confirmed. Try again.",
        type: "status",
      });
      return;
    }
    const next = answer.data.documents[0];
    if (!next) {
      navigate(safeNext(globalThis.location.search));
      return;
    }
    dispatch({ document: next, type: "review" });
  };

  const first = useEffectEvent(refresh);
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  const accept = async () => {
    const document = state.document;
    if (accepting.current || !state.confirmed || !document) return;
    accepting.current = true;
    dispatch({ accepting: true, type: "accepting" });
    const result = await settle(() =>
      acceptLegalDocument(document.id, readActiveWorkspace())
    );
    if (result.status !== "ready") {
      dispatch({
        message: result.problem?.status === 409
          ? "A newer version is required. Loading it now…"
          : result.problem?.detail ??
            "Acceptance could not be recorded. Try again.",
        type: "status",
      });
    }
    accepting.current = false;
    dispatch({ accepting: false, type: "accepting" });
    await refresh();
  };

  const decline = async () => {
    if (state.declining) return;
    dispatch({ declining: true, type: "declining" });
    const result = await settle(() => signOut());
    if (result.status !== "ready" || !result.data) {
      dispatch({ type: "decline-failed" });
      return;
    }
    dispatch({ declining: false, type: "declining" });
    clearSessionCache();
    navigate(result.data.next);
  };

  const { document } = state;
  return (
    <>
      <p
        aria-live="polite"
        className="section-state"
        data-compliance-state=""
        role="status"
      >
        {state.status}
      </p>
      <section data-compliance-review="" hidden={!document}>
        <p className="eyebrow" data-compliance-kind="">
          {document ? "Required legal review" : ""}
        </p>
        <h1 data-compliance-title="">
          {document ? documentTitle(document) : "Required legal review"}
        </h1>
        <p data-compliance-version="">
          {document ? `Version ${document.version}` : ""}
        </p>
        <article className="legal-document" data-compliance-content="">
          {document?.content}
        </article>
        <label className="checkbox-row">
          <input
            checked={state.confirmed}
            data-compliance-confirm=""
            onChange={(event) =>
              dispatch({
                confirmed: event.currentTarget.checked,
                type: "confirm",
              })}
            type="checkbox"
          />{" "}
          I have reviewed and accept this exact version.
        </label>
        <div className={formActionsVariants()}>
          <button
            className={buttonVariants()}
            data-compliance-accept=""
            disabled={!state.confirmed || state.accepting}
            onClick={() => void accept()}
            type="button"
          >
            Accept and continue
          </button>
          <button
            data-compliance-decline=""
            disabled={state.declining}
            onClick={() => void decline()}
            type="button"
          >
            Not now
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * Mounts the review over the page `compliance.astro` drew and resolves,
 * once its first read has settled, with the function that unmounts it.
 */
export function mountCompliance(
  root: ParentNode = document,
  navigate: Navigate = browserNavigate,
): Promise<() => void> {
  const container = root.querySelector<HTMLElement>("[data-compliance-page]");
  if (!container) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      container,
      COMPLIANCE_ISLAND,
      <ComplianceReview
        navigate={navigate}
        onSettled={() => resolve(unmount)}
      />,
    );
  });
}
