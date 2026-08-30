import {
  acceptLegalDocument,
  getLegalRequirements,
  getPublicLegalDocument,
  type LegalDocument,
  signOut,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  ACTIVE_WORKSPACE_KEY,
  clearSessionCache,
} from "./workspace-context.ts";

type Navigate = (path: string) => void;
const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

function selectedWorkspace(): string | undefined {
  return sessionStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? undefined;
}

function safeNext(): string {
  const requested = new URLSearchParams(globalThis.location.search).get("next");
  return (requested === "/app" || requested?.startsWith("/app/")) &&
      !requested.startsWith("/app/compliance")
    ? requested
    : "/app";
}

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
        new Date(result.value.document.publishedAt).toLocaleDateString()
      }`
      : ""
  }`;
  content.textContent = result.value.document.content;
  state.textContent = "";
}

interface ComplianceElements {
  readonly accept: HTMLButtonElement;
  readonly confirm: HTMLInputElement;
  readonly content: HTMLElement;
  readonly decline: HTMLButtonElement;
  readonly kind: HTMLElement;
  readonly review: HTMLElement;
  readonly state: HTMLElement;
  readonly title: HTMLElement;
  readonly version: HTMLElement;
}

function complianceElements(): ComplianceElements | undefined {
  const accept = document.querySelector<HTMLButtonElement>(
    "[data-compliance-accept]",
  );
  const confirm = document.querySelector<HTMLInputElement>(
    "[data-compliance-confirm]",
  );
  const content = document.querySelector<HTMLElement>(
    "[data-compliance-content]",
  );
  const decline = document.querySelector<HTMLButtonElement>(
    "[data-compliance-decline]",
  );
  const kind = document.querySelector<HTMLElement>("[data-compliance-kind]");
  const review = document.querySelector<HTMLElement>(
    "[data-compliance-review]",
  );
  const state = document.querySelector<HTMLElement>(
    "[data-compliance-state]",
  );
  const title = document.querySelector<HTMLElement>(
    "[data-compliance-title]",
  );
  const version = document.querySelector<HTMLElement>(
    "[data-compliance-version]",
  );
  return accept && confirm && content && decline && kind && review && state &&
      title && version
    ? { accept, confirm, content, decline, kind, review, state, title, version }
    : undefined;
}

function renderDocument(elements: ComplianceElements, document: LegalDocument) {
  elements.kind.textContent = "Required legal review";
  elements.title.textContent = document.documentType === "terms"
    ? "Terms of service"
    : document.documentType === "privacy"
    ? "Privacy policy"
    : "Required policy";
  elements.version.textContent = `Version ${document.version}`;
  elements.content.textContent = document.content;
  elements.confirm.checked = false;
  elements.accept.disabled = true;
  elements.accept.dataset.documentId = document.id;
  elements.review.hidden = false;
  elements.state.textContent = "Review the exact version before continuing.";
}

export async function mountCompliance(
  navigate: Navigate = browserNavigate,
): Promise<void> {
  const elements = complianceElements();
  if (!elements) return;
  let accepting = false;
  const refresh = async (): Promise<void> => {
    elements.review.hidden = true;
    elements.state.textContent = "Checking required legal documents…";
    const result = await getLegalRequirements(selectedWorkspace()).catch(() =>
      undefined
    );
    if (!result?.ok) {
      elements.state.textContent =
        "Required legal documents cannot be confirmed. Try again.";
      return;
    }
    const next = result.value.documents[0];
    if (!next) {
      navigate(safeNext());
      return;
    }
    renderDocument(elements, next);
  };

  elements.confirm.addEventListener("change", () => {
    elements.accept.disabled = !elements.confirm.checked || accepting;
  });
  elements.accept.addEventListener("click", async () => {
    if (accepting || !elements.confirm.checked) return;
    const documentId = elements.accept.dataset.documentId;
    if (!documentId) return;
    accepting = true;
    elements.accept.disabled = true;
    elements.state.textContent = "Recording acceptance…";
    const result = await acceptLegalDocument(
      documentId,
      selectedWorkspace(),
    ).catch(() => undefined);
    accepting = false;
    if (!result?.ok) {
      elements.state.textContent = result?.problem.status === 409
        ? "A newer version is required. Loading it now…"
        : result?.problem.detail ??
          "Acceptance could not be recorded. Try again.";
      await refresh();
      return;
    }
    await refresh();
  });
  elements.decline.addEventListener("click", async () => {
    elements.decline.disabled = true;
    elements.state.textContent = "Leaving the protected workspace…";
    const result = await signOut().catch(() => undefined);
    elements.decline.disabled = false;
    if (result?.ok) {
      clearSessionCache();
      navigate(result.value.next);
    } else {elements.state.textContent =
        "Sign-out could not be completed. Try again.";}
  });
  await refresh();
}
