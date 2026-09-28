import { afterEach, describe, expect, it } from "vitest";

/*
 * REL-069: the gateway's CSP has no 'unsafe-eval', and Zod's JIT object
 * parser probes for it with `new Function` the moment an object schema is
 * built, then compiles every object it parses. Firefox reports the caught
 * probe as a violation. The web bundle resolves `zod` to a module that turns
 * the JIT off before any contract schema module can build a schema, so the
 * browser never evaluates code: not while the schemas load, not while they
 * parse.
 */

const RealFunction = globalThis.Function;

afterEach(() => {
  globalThis.Function = RealFunction;
});

/** Counts every `new Function(...)` from here on. */
function countEvaluations(): { readonly count: () => number } {
  let evaluations = 0;
  globalThis.Function = new Proxy(RealFunction, {
    construct(target, args, newTarget) {
      evaluations += 1;
      return Reflect.construct(target, args, newTarget);
    },
  });
  return { count: () => evaluations };
}

const personId = "00000000-0000-4000-8000-000000000001";

describe("REL-069 Zod in the web bundle", () => {
  it("builds and parses the contract schemas without evaluating code", async () => {
    const evaluations = countEvaluations();
    const { z } = await import("zod");
    const { peopleBulkInput, peopleDirectoryPage } = await import(
      "../../../../packages/contracts/schemas/people.ts"
    );

    expect(z.config().jitless).toBe(true);
    expect(
      peopleBulkInput.safeParse({ action: "archive", personIds: [personId] })
        .success,
    ).toBe(true);
    expect(peopleBulkInput.safeParse({ action: "tag", personIds: [] }).success)
      .toBe(false);
    expect(
      peopleDirectoryPage.parse({
        lifecycle: "active",
        people: [{
          givenName: "Ada",
          id: personId,
          isPartial: false,
          isStarred: true,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }).people[0]?.givenName,
    ).toBe("Ada");
    expect(evaluations.count()).toBe(0);
  });
});
