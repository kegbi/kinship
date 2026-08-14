import { isHealthResponse } from "../../../../packages/contracts/health.ts";

export type ApiReadinessState =
  | { readonly kind: "ready"; readonly message: "API ready" }
  | {
    readonly kind: "unavailable";
    readonly message: "API temporarily unavailable";
  };

const UNAVAILABLE_STATE: ApiReadinessState = {
  kind: "unavailable",
  message: "API temporarily unavailable",
};

export async function checkApiReadiness(
  fetcher: typeof fetch = fetch,
): Promise<ApiReadinessState> {
  try {
    const response = await fetcher("/api/v1/health", {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return UNAVAILABLE_STATE;
    }

    const body: unknown = await response.json();
    if (!isHealthResponse(body)) {
      return UNAVAILABLE_STATE;
    }

    return { kind: "ready", message: "API ready" };
  } catch {
    return UNAVAILABLE_STATE;
  }
}
