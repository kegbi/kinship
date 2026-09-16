/**
 * Time contracts.
 *
 * Application code never reads ambient time: it takes a `Clock` and asks it.
 * Before the kernel, twenty-five dependency objects each spelled the same
 * `{ now(): Date }` shape out by hand, so this module is where the contract
 * lives now. It stays a contract — the concrete clock is built at a
 * composition root, which is the only place allowed to touch the machine.
 */

/**
 * A point in time as the canonical schema stores it: an RFC 3339 timestamp in
 * UTC. Revision columns render six fractional digits, which is what optimistic
 * concurrency compares, so treat the string as opaque and never reformat one
 * that came out of the database.
 */
export type Instant = string;

/** The only source of "now" application and domain code may use. */
export interface Clock {
  now(): Date;
}
