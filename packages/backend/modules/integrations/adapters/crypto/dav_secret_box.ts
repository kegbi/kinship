export interface DavEncryptionKeyset {
  readonly activeKeyId: string;
  readonly keys: ReadonlyMap<string, Uint8Array>;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-")
    .replaceAll("/", "_").replaceAll("=", "");
}

function decode(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded), (item) => item.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function validate(keyset: DavEncryptionKeyset): DavEncryptionKeyset {
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyset.activeKeyId)) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEYSET is invalid.");
  }
  for (const [id, key] of keyset.keys) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32) {
      throw new Error("INTEGRATIONS_ENCRYPTION_KEYSET is invalid.");
    }
  }
  if (!keyset.keys.has(keyset.activeKeyId)) {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEYSET active key is missing.");
  }
  return keyset;
}

export function decodeDavEncryptionKeyset(value: string): DavEncryptionKeyset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("INTEGRATIONS_ENCRYPTION_KEYSET must be valid JSON.");
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    !("activeKeyId" in parsed) || !("keys" in parsed) ||
    typeof parsed.activeKeyId !== "string" ||
    typeof parsed.keys !== "object" || parsed.keys === null ||
    Array.isArray(parsed.keys)
  ) throw new Error("INTEGRATIONS_ENCRYPTION_KEYSET is invalid.");
  return validate({
    activeKeyId: parsed.activeKeyId,
    keys: new Map(
      Object.entries(parsed.keys).map(([id, encoded]) => {
        const key = typeof encoded === "string" ? decode(encoded) : undefined;
        if (key?.length !== 32) {
          throw new Error(
            "INTEGRATIONS_ENCRYPTION_KEYSET keys must be 32 base64url bytes.",
          );
        }
        return [id, key] as const;
      }),
    ),
  });
}

export class AesGcmDavSecretBox {
  readonly #keyset: DavEncryptionKeyset;

  constructor(keyset: DavEncryptionKeyset) {
    this.#keyset = validate(keyset);
  }

  async seal(secret: string): Promise<string> {
    const id = this.#keyset.activeKeyId;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(this.#keyset.keys.get(id)!).buffer,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    const cipher = await crypto.subtle.encrypt(
      {
        additionalData: this.#aad(id),
        iv: new Uint8Array(iv).buffer,
        name: "AES-GCM",
      },
      key,
      new TextEncoder().encode(secret),
    );
    return `v1.${id}.${base64Url(iv)}.${base64Url(new Uint8Array(cipher))}`;
  }

  async open(value: string): Promise<string> {
    const [version, id, rawIv, rawCipher, extra] = value.split(".");
    const iv = rawIv ? decode(rawIv) : undefined;
    const cipher = rawCipher ? decode(rawCipher) : undefined;
    const bytes = id ? this.#keyset.keys.get(id) : undefined;
    if (
      version !== "v1" || extra || !id || iv?.length !== 12 || !cipher || !bytes
    ) {
      throw new Error("DAV credential is unavailable.");
    }
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(bytes).buffer,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      return new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            additionalData: this.#aad(id),
            iv: new Uint8Array(iv).buffer,
            name: "AES-GCM",
          },
          key,
          new Uint8Array(cipher).buffer,
        ),
      );
    } catch {
      throw new Error("DAV credential is unavailable.");
    }
  }

  #aad(id: string): ArrayBuffer {
    return new TextEncoder().encode(`kinship.integrations.dav.v1.${id}`).buffer;
  }
}
