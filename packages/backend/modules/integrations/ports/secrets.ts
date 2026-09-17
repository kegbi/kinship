/**
 * How a subscription's remote password is kept.
 *
 * The use case seals a password on the way in and opens it on the way out and
 * never learns which cipher or which keyset is behind either, so the stored
 * ciphertext can be re-keyed without a use case changing.
 */

export interface DavSecretBox {
  open(value: string): Promise<string>;
  seal(value: string): Promise<string>;
}
