import { describe, expect, it } from "vitest";
import {
  focusRequest,
  initialRegion,
  loadingRegion,
  settleRegion,
} from "./regions.ts";

describe("GAP-033 Today regions", () => {
  it("settles only a waiting region, keeping the last good value on failure", () => {
    const waiting = initialRegion<string>();
    expect(waiting).toEqual({ status: "loading" });
    const ready = settleRegion(waiting, "first");
    expect(ready).toEqual({ status: "ready", value: "first" });
    expect(settleRegion(ready, "ignored")).toBe(ready);
    const again = loadingRegion(ready);
    expect(again).toEqual({ status: "loading", value: "first" });
    expect(loadingRegion(again)).toBe(again);
    expect(settleRegion(again, undefined)).toEqual({
      status: "failed",
      value: "first",
    });
  });

  it("makes every focus request fresh and keeps the last one without a target", () => {
    const first = focusRequest(undefined, "state");
    expect(first).toEqual({ sequence: 1, target: "state" });
    const second = focusRequest(first, "state");
    expect(second).toEqual({ sequence: 2, target: "state" });
    expect(focusRequest(second, undefined)).toBe(second);
  });
});
