import type { AuthenticationResponseEqualizer } from "../../packages/backend/modules/workspaces/public.ts";

export const DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS = 250;
export const MIN_AUTHENTICATION_RESPONSE_FLOOR_MS = 100;
export const MAX_AUTHENTICATION_RESPONSE_FLOOR_MS = 2_000;

export interface AuthenticationResponseTiming {
  nowMilliseconds(): number;
  wait(milliseconds: number): Promise<void>;
}

export function resolveAuthenticationResponseFloor(
  value: string | undefined,
): number {
  if (value === undefined) return DEFAULT_AUTHENTICATION_RESPONSE_FLOOR_MS;
  const milliseconds = Number(value);
  if (
    !Number.isInteger(milliseconds) ||
    milliseconds < MIN_AUTHENTICATION_RESPONSE_FLOOR_MS ||
    milliseconds > MAX_AUTHENTICATION_RESPONSE_FLOOR_MS
  ) {
    throw new Error(
      `AUTH_MINIMUM_RESPONSE_MS must be an integer between ${MIN_AUTHENTICATION_RESPONSE_FLOOR_MS} and ${MAX_AUTHENTICATION_RESPONSE_FLOOR_MS}.`,
    );
  }
  return milliseconds;
}

export function createAuthenticationResponseEqualizer(
  minimumMilliseconds: number,
  timing: AuthenticationResponseTiming = {
    nowMilliseconds: () => performance.now(),
    wait: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  },
): AuthenticationResponseEqualizer {
  if (
    !Number.isInteger(minimumMilliseconds) ||
    minimumMilliseconds < MIN_AUTHENTICATION_RESPONSE_FLOOR_MS ||
    minimumMilliseconds > MAX_AUTHENTICATION_RESPONSE_FLOOR_MS
  ) {
    throw new Error("Authentication response floor is outside safe bounds.");
  }
  return {
    async run<T>(work: () => Promise<T>): Promise<T> {
      const startedAt = timing.nowMilliseconds();
      try {
        return await work();
      } finally {
        const remaining = minimumMilliseconds -
          (timing.nowMilliseconds() - startedAt);
        if (remaining > 0) await timing.wait(remaining);
      }
    },
  };
}
