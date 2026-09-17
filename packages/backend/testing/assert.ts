/**
 * The assertions every backend and API unit test shares.
 *
 * Before this package sixty-nine test modules each opened with their own
 * `function assert(condition, message)`, and five of them added a private
 * `assertEquals` that compared `JSON.stringify` output. The copies had drifted
 * — one took a `boolean` instead of `unknown`, one wrapped the throw in a
 * block, one carried a third `message` parameter — so a reader could not tell
 * whether a difference was deliberate. They are declared once here.
 *
 * `assertEquals` keeps the comparison the copies performed: JSON text. That is
 * deliberately not structural equality. JSON text treats an `undefined`
 * property as absent, renders a `Date` as its ISO string, and makes key order
 * significant, and the migrated call sites lean on all three — a use case that
 * returns `{ amount: undefined }` is asserted against `{}`, and a result object
 * is asserted against a literal written in the same declaration order. A
 * structural comparison would reject expectations that pass today, so the text
 * comparison stays and `assert_test.ts` pins each of those three behaviours.
 *
 * This module is test-only support: it imports nothing, reads no environment,
 * and never reaches into a unit's private code.
 */

/**
 * Fails with `message` unless `condition` holds.
 *
 * The return type narrows `condition` for the code that follows, which is what
 * lets a test assert a discriminated status and then read the branch's fields.
 */
export function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

/** Renders a value the way `assertEquals` compares it. */
function rendered(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/**
 * Fails unless `actual` and `expected` render to the same JSON text.
 *
 * Both parameters are `unknown` on purpose: four of the five copies this
 * replaces were untyped, so constraining the pair to one type parameter would
 * reject call sites that compile today.
 */
export function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  const left = rendered(actual);
  const right = rendered(expected);
  if (left === right) return;
  const detail = `Expected ${right}, received ${left}`;
  throw new Error(message === undefined ? detail : `${message}: ${detail}`);
}

/**
 * Runs `work` and fails unless it throws. Returns what was thrown, so a caller
 * that cares about the error can go on inspecting it. Use `assertRejects` when
 * the call under test returns a promise.
 */
export function assertThrows(work: () => void, message: string): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

/**
 * Runs `work` and fails unless it throws or rejects. Returns what was thrown,
 * so a caller that cares about the error can go on inspecting it.
 */
export async function assertRejects(
  work: () => unknown,
  message: string,
): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

/** Fails unless `response.status` is `expected`, naming what arrived. */
export function assertStatus(
  response: { readonly status: number },
  expected: number,
  message?: string,
): void {
  if (response.status === expected) return;
  const detail = `expected status ${expected}, received ${response.status}`;
  throw new Error(message === undefined ? detail : `${message}: ${detail}`);
}
