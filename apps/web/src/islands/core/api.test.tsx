// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ApiResult,
  ProblemDetails,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { type ApiCall, settle, useApi, useLatestRequest } from "./api.ts";

const problem: ProblemDetails = {
  code: "gift_conflict",
  detail: "That gift changed.",
  status: 409,
  title: "Conflict",
  type: "https://kinship.test/problems/gift_conflict",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("GAP-026 settle", () => {
  const signal = new AbortController().signal;

  it("answers ready, problem, or unavailable instead of throwing", async () => {
    expect(await settle(() => Promise.resolve({ ok: true, value: 1 }), signal))
      .toEqual({ data: 1, status: "ready" });
    expect(
      await settle(() => Promise.resolve({ ok: false, problem }), signal),
    ).toEqual({ problem, status: "problem" });
    expect(
      await settle(() => Promise.reject(new Error("offline")), signal),
    ).toEqual({ status: "unavailable" });
  });

  it("hands the call the signal it can abort with", async () => {
    let seen: AbortSignal | undefined;
    await settle((given) => {
      seen = given;
      return Promise.resolve({ ok: true, value: "x" });
    }, signal);
    expect(seen).toBe(signal);
  });
});

describe("GAP-026 useLatestRequest", () => {
  it("lands only the latest request and aborts the one it replaces", async () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = deferred<ApiResult<string>>();
    const second = deferred<ApiResult<string>>();
    const signals: AbortSignal[] = [];
    const call =
      (answer: Promise<ApiResult<string>>): ApiCall<string> => (signal) => {
        signals.push(signal);
        return answer;
      };
    const firstRun = result.current(call(first.promise));
    const secondRun = result.current(call(second.promise));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    first.resolve({ ok: true, value: "stale" });
    second.resolve({ ok: true, value: "fresh" });
    expect(await firstRun).toBeUndefined();
    expect(await secondRun).toEqual({ data: "fresh", status: "ready" });
  });

  it("drops an answer that arrives after unmount", async () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const pending = deferred<ApiResult<string>>();
    let signal: AbortSignal | undefined;
    const run = result.current((given) => {
      signal = given;
      return pending.promise;
    });
    unmount();
    expect(signal?.aborted).toBe(true);
    pending.resolve({ ok: true, value: "late" });
    expect(await run).toBeUndefined();
  });

  it("keeps one stable request function across renders", () => {
    const { rerender, result } = renderHook(() => useLatestRequest());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("GAP-026 useApi", () => {
  it("moves from loading to the settled answer", async () => {
    const pending = deferred<ApiResult<string[]>>();
    const call: ApiCall<string[]> = () => pending.promise;
    const { result } = renderHook(() => useApi(call));
    expect(result.current.status).toBe("loading");
    await act(async () => {
      pending.resolve({ ok: true, value: ["a"] });
      await pending.promise;
    });
    expect(result.current).toMatchObject({ data: ["a"], status: "ready" });
  });

  it("reports a problem and an unreachable API without rejecting", async () => {
    const answers: Array<() => Promise<ApiResult<number>>> = [
      () => Promise.resolve({ ok: false, problem }),
      () => Promise.reject(new Error("offline")),
    ];
    const call: ApiCall<number> = () => answers.shift()!();
    const { result } = renderHook(() => useApi(call));
    await waitFor(() => expect(result.current.status).toBe("problem"));
    expect(result.current.problem).toBe(problem);
    act(() => result.current.reload());
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("drops a stale answer when a reload overtakes it", async () => {
    const first = deferred<ApiResult<string>>();
    const second = deferred<ApiResult<string>>();
    const answers = [first.promise, second.promise];
    const call: ApiCall<string> = () => answers.shift()!;
    const { result } = renderHook(() => useApi(call));
    act(() => result.current.reload());
    await act(async () => {
      second.resolve({ ok: true, value: "fresh" });
      await second.promise;
    });
    await act(async () => {
      first.resolve({ ok: true, value: "stale" });
      await first.promise;
    });
    expect(result.current).toMatchObject({ data: "fresh", status: "ready" });
  });

  it("aborts the request in flight on unmount", () => {
    let signal: AbortSignal | undefined;
    const call: ApiCall<string> = (given) => {
      signal = given;
      return new Promise(() => undefined);
    };
    const { unmount } = renderHook(() => useApi(call));
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("stays idle without a call and starts when one arrives", async () => {
    const call: ApiCall<string> = () =>
      Promise.resolve({ ok: true, value: "now" });
    const { rerender, result } = renderHook(
      ({ current }: { current: ApiCall<string> | undefined }) =>
        useApi(current),
      { initialProps: { current: undefined as ApiCall<string> | undefined } },
    );
    expect(result.current.status).toBe("idle");
    rerender({ current: call });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
});
