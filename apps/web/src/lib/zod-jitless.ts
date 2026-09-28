/**
 * Zod for the browser: JIT-less (REL-069).
 *
 * The web build and the web unit suite resolve every bare `zod` import,
 * including the contract schemas', to this module, so it runs before any
 * module can build a schema. Zod's JIT object parser probes for `eval` with
 * `new Function` as soon as an object schema is built; the gateway's CSP has
 * no 'unsafe-eval', and Firefox reports the caught probe as a violation.
 * JIT-less parsing gives the same results. The API keeps the JIT: it has no
 * CSP, and it imports Zod directly.
 */

import { z } from "zod/v4";

z.config({ jitless: true });

export * from "zod/v4";
export { z };
export default z;
