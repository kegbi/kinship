/**
 * How a token's secret is minted and checked.
 *
 * The use case never sees a hashing algorithm, a cost parameter, or a random
 * source: it asks for a secret and its hash together, stores the hash, and
 * later asks whether a presented secret matches one. Keeping that behind a
 * port is what lets the algorithm be replaced without a use case changing, and
 * what keeps the comparison constant-time wherever the adapter says it is.
 */

export interface ApiTokenSecrets {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
  matches(raw: string, hash: string): Promise<boolean>;
}
