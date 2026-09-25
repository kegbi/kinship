/**
 * Calling the API from an island.
 *
 * The vanilla modules wrapped every generated-client call in
 * `.catch(() => undefined)` and then branched on `result?.ok`, which folded
 * "the server refused" and "the server was never reached" into one shape and
 * left each module to invent its own guard against a slow answer overwriting a
 * newer one. An island asks here instead. Every call settles to one of three
 * answers — `ready` with its data, `problem` with the RFC 9457 body, or
 * `unavailable` when nothing came back — and only the latest request an owner
 * made may land: starting another, or unmounting, aborts the one before and
 * drops whatever it answers later.
 *
 * The generated client does not take an `AbortSignal` today, so aborting
 * cannot cancel the fetch itself; it guarantees the answer is ignored. A call
 * that can pass the signal on receives it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApiResult,
  ProblemDetails,
} from "../../../../../packages/contracts/generated/auth-client.ts";

/** One generated-client call, given the signal that retires it. */
export type ApiCall<T> = (signal: AbortSignal) => Promise<ApiResult<T>>;

export type ApiStatus =
  | "idle"
  | "loading"
  | "ready"
  | "problem"
  | "unavailable";

/** Where one call stands: `data` when ready, `problem` when refused. */
export interface ApiState<T> {
  readonly status: ApiStatus;
  readonly data?: T;
  readonly problem?: ProblemDetails;
}

/** The answer a call settled to; never `idle` or `loading`. */
export type Settled<T> = ApiState<T> & {
  readonly status: "ready" | "problem" | "unavailable";
};

/**
 * Runs one call to its settled answer. It never rejects. A call nothing will
 * retire, such as a save the reader started, needs no signal.
 */
export async function settle<T>(
  call: ApiCall<T>,
  signal: AbortSignal = new AbortController().signal,
): Promise<Settled<T>> {
  try {
    const result = await call(signal);
    return result.ok
      ? { data: result.value, status: "ready" }
      : { problem: result.problem, status: "problem" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * An imperative request slot for work an event starts, such as a refresh or a
 * page of more rows. The returned function resolves `undefined` when a newer
 * request replaced this one or the owner unmounted, so the caller applies only
 * an answer that is still the latest.
 */
export function useLatestRequest(): <T>(
  call: ApiCall<T>,
) => Promise<Settled<T> | undefined> {
  const latest = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const slot = latest;
    return () => slot.current?.abort();
  }, []);
  return useCallback(async <T>(call: ApiCall<T>) => {
    latest.current?.abort();
    const controller = new AbortController();
    latest.current = controller;
    const answer = await settle(call, controller.signal);
    return controller.signal.aborted ? undefined : answer;
  }, []);
}

/**
 * Loads what `call` answers for as long as the component shows it.
 *
 * `call` should be stable (a `useCallback`), because a new function is a new
 * request. `undefined` keeps the state `idle` until a call is supplied, which
 * is how a surface defers a load until it is first needed. `reload` asks
 * again; the previous answer is dropped if it arrives late.
 */
export function useApi<T>(
  call: ApiCall<T> | undefined,
): ApiState<T> & { readonly reload: () => void } {
  const [generation, setGeneration] = useState(0);
  const [settled, setSettled] = useState<
    {
      readonly call: ApiCall<T>;
      readonly generation: number;
      readonly state: Settled<T>;
    } | undefined
  >(undefined);
  useEffect(() => {
    if (!call) return;
    const controller = new AbortController();
    void settle(call, controller.signal).then((state) => {
      if (!controller.signal.aborted) {
        setSettled({ call, generation, state });
      }
    });
    return () => controller.abort();
  }, [call, generation]);
  const reload = useCallback(() => setGeneration((value) => value + 1), []);
  if (!call) return { reload, status: "idle" };
  const current = settled?.call === call && settled.generation === generation
    ? settled.state
    : { status: "loading" as const };
  return { ...current, reload };
}
