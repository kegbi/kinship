/** Sequential bulk deletion through the existing single-person API. */
import {
  deletePerson,
  getPersonDeletionImpact,
  type PeopleBulkItemResult,
  type PeopleBulkResult,
  type PersonDeletionImpact,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { settle } from "../../../islands/core/index.ts";

export interface DeletionPreview {
  readonly personId: string;
  readonly impact?: PersonDeletionImpact["impact"];
  readonly failure?: PeopleBulkItemResult;
}

function failure(personId: string, status?: number): PeopleBulkItemResult {
  return {
    personId,
    outcome: "failed",
    code: status === 401 || status === 403
      ? "forbidden"
      : status === 404
      ? "not_found"
      : status === 409
      ? "stale"
      : "unavailable",
  };
}

/** Read only: snapshots are retained until the member explicitly confirms. */
export async function previewDeletionSelection(
  personIds: readonly string[],
  workspaceId: string,
  signal: AbortSignal,
  progress: (completed: number) => void,
): Promise<readonly DeletionPreview[]> {
  const previews: DeletionPreview[] = [];
  let forbidden = false;
  for (const personId of personIds) {
    if (signal.aborted) break;
    if (forbidden) {
      previews.push({ personId, failure: { personId, outcome: "skipped" } });
      continue;
    }
    const answer = await settle(() =>
      getPersonDeletionImpact(personId, workspaceId)
    );
    if (signal.aborted) break;
    if (answer.status === "ready") {
      previews.push({ personId, impact: answer.data!.impact });
    } else {
      const item = failure(personId, answer.problem?.status);
      forbidden = item.code === "forbidden";
      previews.push({ personId, failure: item });
    }
    progress(previews.length);
  }
  return previews;
}

/** Every delete uses exactly the previewed revision; stale people fail safely. */
export async function deleteSelection(
  previews: readonly DeletionPreview[],
  workspaceId: string,
): Promise<Pick<PeopleBulkResult, "results" | "summary">> {
  const results: PeopleBulkItemResult[] = [];
  let forbidden = false;
  for (const preview of previews) {
    const { personId, impact } = preview;
    if (forbidden) {
      results.push({ personId, outcome: "skipped" });
      continue;
    }
    if (preview.failure) {
      results.push(preview.failure);
      forbidden = preview.failure.code === "forbidden";
      continue;
    }
    const answer = await settle(() =>
      deletePerson(personId, {
        confirmation: impact!.confirmation,
        expectedUpdatedAt: impact!.person.updatedAt,
      }, workspaceId)
    );
    const result: PeopleBulkItemResult = answer.status === "ready"
      ? { personId, outcome: "done" }
      : failure(personId, answer.problem?.status);
    forbidden = result.code === "forbidden";
    results.push(result);
  }
  const summary = { done: 0, failed: 0, skipped: 0, unchanged: 0 };
  for (const result of results) summary[result.outcome] += 1;
  return { results, summary };
}
