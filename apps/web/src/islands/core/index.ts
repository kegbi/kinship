/**
 * The island kit (ADR 0006, GAP-026): what every React island builds on.
 *
 * - `useApi`, `useLatestRequest`, and `settle` call the generated client and
 *   answer `{ status, data?, problem? }`, aborting on unmount and dropping
 *   stale answers.
 * - `useContractForm` is react-hook-form over a contract schema, with
 *   `applyProblem` for a refused submission.
 * - `useDocumentEvent` listens to the document events vanilla surfaces send.
 * - `toast` writes to the application's one toast region.
 * - `mountIsland` and `IslandRoot` mount an island and mark it ready.
 * - `LoadMore` is GAP-023's paging control.
 */

export {
  type ApiCall,
  type ApiState,
  type ApiStatus,
  settle,
  type Settled,
  useApi,
  useLatestRequest,
} from "./api.ts";
export {
  type ContractForm,
  type ContractFormOptions,
  problemFieldName,
  useContractForm,
} from "./contract-form.ts";
export { useDocumentEvent } from "./document-event.ts";
export { LOADING_LABEL, LoadMore } from "./load-more.tsx";
export { IslandRoot, mountIsland } from "./mount.tsx";
export { toast, type ToastTone } from "./toast.ts";
