export interface HealthResponse {
  readonly status: "healthy";
  readonly readiness: "ready";
}

export const HEALTH_RESPONSE: Readonly<HealthResponse> = Object.freeze({
  status: "healthy",
  readiness: "ready",
});

export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 &&
    candidate.status === HEALTH_RESPONSE.status &&
    candidate.readiness === HEALTH_RESPONSE.readiness;
}
